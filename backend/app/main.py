from contextlib import asynccontextmanager
from dataclasses import dataclass
import asyncio
import json
import math
import time
from pathlib import Path
from typing import Any, Protocol
from uuid import uuid4

import httpx
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from openai import AsyncOpenAI, RateLimitError
from pydantic import TypeAdapter, ValidationError

from .config import Settings
from .dependencies import get_existing_session, get_session
from .documents import SUPPORTED_EXTENSIONS, chunk_pages, extract_pages
from .prompts import QUIZ_SYSTEM_PROMPT, SYSTEM_PROMPT
from .schemas import (
    ChatRequest,
    ChatSource,
    DocumentResponse,
    ErrorResponse,
    QueryRequest,
    QueryResponse,
    QuizQuestion,
    QuizRequest,
    Source,
)
from .store import SESSIONS, Session, StoredDocument, delete_idle_sessions


class Embedder(Protocol):
    def encode(self, text: str, normalize_embeddings: bool = True) -> Any: ...


class ChatClient(Protocol):
    @property
    def chat(self) -> Any: ...


# --- REPLACED: Lightweight Hugging Face Inference API Embedder ---
class HFInferenceEmbedder:
    def __init__(self, api_token: str, model_name: str):
        self.api_url = f"https://api-inference.huggingface.co/models/{model_name}"
        self.headers = {"Authorization": f"Bearer {api_token}"}

    def encode(self, text: str, normalize_embeddings: bool = True) -> list[float]:
        # We use a retry loop to handle HF free-tier rate limits (429) and model loading (503)
        with httpx.Client(timeout=30.0) as client:
            for attempt in range(5):
                try:
                    response = client.post(
                        self.api_url,
                        headers=self.headers,
                        json={"inputs": text, "options": {"wait_for_model": True}}
                    )
                    if response.status_code == 503:
                        time.sleep(2)
                        continue
                    if response.status_code == 429:
                        time.sleep(2)
                        continue
                    
                    response.raise_for_status()
                    data = response.json()
                    
                    # Handle HF API returning nested lists vs flat lists
                    embedding = data[0] if isinstance(data[0], list) else data
                    
                    if normalize_embeddings:
                        norm = math.sqrt(sum(x*x for x in embedding))
                        if norm > 0:
                            embedding = [x / norm for x in embedding]
                    return embedding
                    
                except httpx.HTTPError as exc:
                    if attempt == 4:
                        raise RuntimeError(f"Failed to get embeddings from HF: {exc}")
                    time.sleep(2)
        return []


@dataclass
class Runtime:
    embedder: Embedder
    llm: ChatClient
    model: str
    top_k: int
    similarity_threshold: float


MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
MAX_DOCUMENTS_PER_SESSION = 5


def create_app(
    embedder: Embedder | None = None,
    llm: ChatClient | None = None,
    settings: Settings | None = None,
) -> FastAPI:

    loaded_settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Use the new lightweight embedder
        loaded_embedder = embedder or HFInferenceEmbedder(
            api_token=loaded_settings.hf_token,
            model_name=loaded_settings.embedding_model
        )
        loaded_llm = llm or _create_llm_client(loaded_settings)
        app.state.runtime = Runtime(
            loaded_embedder,
            loaded_llm,
            loaded_settings.llm_model,
            loaded_settings.top_k,
            loaded_settings.similarity_threshold,
        )
        cleanup_task = asyncio.create_task(_cleanup_loop(loaded_settings.session_ttl_minutes))
        try:
            yield
        finally:
            cleanup_task.cancel()
            await asyncio.gather(cleanup_task, return_exceptions=True)

    app = FastAPI(title="AI Study Assistant", lifespan=lifespan)

    allowed_origins = [
        url.strip() for url in loaded_settings.frontend_url.split(",") if url.strip()
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(HTTPException)
    async def http_error_handler(_, exc: HTTPException) -> JSONResponse:
        code = exc.detail.get("error", "http_error") if isinstance(exc.detail, dict) else "http_error"
        message = exc.detail.get("message", "Request failed") if isinstance(exc.detail, dict) else str(exc.detail)
        return JSONResponse(
            content=ErrorResponse(error=code, message=message).model_dump(),
            status_code=exc.status_code,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            content=ErrorResponse(
                error="validation_error", message=str(exc.errors())
            ).model_dump(),
            status_code=422,
        )

    @app.exception_handler(Exception)
    async def unexpected_error_handler(_, __: Exception) -> JSONResponse:
        return JSONResponse(
            content=ErrorResponse(error="internal_error", message="Internal server error").model_dump(),
            status_code=500,
        )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/documents", response_model=DocumentResponse, status_code=201)
    async def upload_document(
        file: UploadFile = File(...),
        session: Session = Depends(get_session),
    ) -> DocumentResponse:
        filename = file.filename or ""
        if Path(filename).suffix.lower() not in SUPPORTED_EXTENSIONS:
            raise HTTPException(
                415,
                {"error": "unsupported_file_type", "message": "Only PDF, DOCX, and TXT files are supported"},
            )
        if len(session.docs) and len({document.document_id for document in session.docs}) >= MAX_DOCUMENTS_PER_SESSION:
            raise HTTPException(
                413,
                {"error": "document_limit_exceeded", "message": "A session can contain at most 5 documents"},
            )

        data = await file.read(MAX_DOCUMENT_BYTES + 1)
        if len(data) > MAX_DOCUMENT_BYTES:
            raise HTTPException(
                413,
                {"error": "file_too_large", "message": "Document must be 10 MB or smaller"},
            )
        try:
            pages = extract_pages(filename, data)
        except Exception as exc:
            raise HTTPException(
                422,
                {"error": "document_extraction_failed", "message": f"Could not extract document text: {exc}"},
            ) from exc
        if not any(page.text for page in pages):
            raise HTTPException(
                422,
                {"error": "no_extractable_text", "message": "The document contains no extractable text"},
            )

        chunks = chunk_pages(pages)
        if not chunks:
            raise HTTPException(
                422,
                {"error": "no_extractable_text", "message": "The document contains no extractable text"},
            )

        document_id = str(uuid4())
        
        # --- NOTE: We are calling the HF API sequentially here. 
        # For a demo, this takes ~1-2 seconds per chunk. 
        embeddings = []
        for chunk in chunks:
            emb = await asyncio.to_thread(_vector(app).encode, chunk.text, normalize_embeddings=True)
            embeddings.append(emb)

        documents = [
            StoredDocument(document_id, filename, chunk.text, chunk.page, embedding)
            for chunk, embedding in zip(chunks, embeddings)
        ]
        session.add(documents, embeddings)
        return DocumentResponse(
            id=document_id,
            filename=filename,
            pages=len(pages),
            chunks=len(chunks),
        )

    @app.get("/documents", response_model=list[DocumentResponse])
    async def list_documents(
        session: Session = Depends(get_existing_session),
    ) -> list[DocumentResponse]:
        return [
            DocumentResponse(id=document_id, filename=filename, pages=pages, chunks=chunks)
            for document_id, filename, pages, chunks in session.documents()
        ]

    @app.delete("/documents/{document_id}")
    async def delete_document(
        document_id: str,
        session: Session = Depends(get_existing_session),
    ) -> dict[str, str]:
        if not session.delete_document(document_id):
            raise HTTPException(
                404,
                {"error": "document_not_found", "message": "Document not found"},
            )
        return {"id": document_id, "status": "deleted"}

    @app.delete("/session")
    async def delete_session(
        session: Session = Depends(get_existing_session),
    ) -> dict[str, str]:
        for session_id, stored_session in list(SESSIONS.items()):
            if stored_session is session:
                del SESSIONS[session_id]
                break
        return {"status": "deleted"}

    @app.post("/query", response_model=QueryResponse)
    async def query(
        request: QueryRequest,
        session: Session = Depends(get_existing_session),
    ) -> QueryResponse:
        runtime = _runtime(app)
        query_emb = await asyncio.to_thread(runtime.embedder.encode, request.question, normalize_embeddings=True)
        matches = session.search(
            list(query_emb),
            request.top_k,
        )
        if not matches:
            raise HTTPException(404, {"error": "no_documents", "message": "No documents found for this session"})

        context = "\n\n".join(
            f"[{document.filename}, page {document.page}]\n{document.text}"
            for document, _ in matches
        )
        completion = await runtime.llm.chat.completions.create(
            model=runtime.model,
            temperature=0.2,
            messages=[
                {"role": "system", "content": "Answer using only the supplied study documents. Say when the answer is not present."},
                {"role": "user", "content": f"Study documents:\n{context}\n\nQuestion: {request.question}"},
            ],
        )
        answer = completion.choices[0].message.content or ""
        return QueryResponse(
            answer=answer,
            sources=[
                Source(
                    document_id=document.document_id,
                    filename=document.filename,
                    page=document.page,
                    score=score,
                )
                for document, score in matches
            ],
        )

    @app.post("/chat")
    async def chat(
        request: ChatRequest,
        session: Session = Depends(get_existing_session),
    ) -> StreamingResponse:
        runtime = _runtime(app)
        query_emb = await asyncio.to_thread(runtime.embedder.encode, request.question, normalize_embeddings=True)
        matches = session.search(
            list(query_emb),
            runtime.top_k,
            set(request.document_ids) if request.document_ids is not None else None,
            runtime.similarity_threshold,
        )
        if not matches:
            return StreamingResponse(
                _not_found_events(),
                media_type="text/event-stream",
            )

        context = "\n\n".join(
            f"{number}. [{document.filename}, page {document.page}]\n{document.text}"
            for number, (document, _) in enumerate(matches, start=1)
        )
        messages: list[dict[str, str]] = [{"role": "system", "content": SYSTEM_PROMPT}]
        messages.extend(
            {"role": turn.role, "content": turn.content}
            for turn in (request.history or [])[-4:]
        )
        messages.append(
            {
                "role": "user",
                "content": f"Context:\n{context}\n\nQuestion: {request.question}",
            }
        )
        stream = await _start_chat_stream(runtime, messages)
        
        return StreamingResponse(
            _chat_events(stream, matches),
            media_type="text/event-stream",
            headers={"X-Accel-Buffering": "no"},
        )

    @app.post("/quiz", response_model=list[QuizQuestion])
    async def quiz(
        request: QuizRequest,
        session: Session = Depends(get_existing_session),
    ) -> list[QuizQuestion]:
        chunks = session.sample_document_chunks(request.document_id, request.num_questions)
        if not chunks:
            raise HTTPException(
                404,
                {"error": "document_not_found", "message": "Document not found"},
            )

        context = "\n\n".join(
            f"[{document.filename}, page {document.page}]\n{document.text}"
            for document in chunks
        )
        messages = [
            {"role": "system", "content": QUIZ_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Create {request.num_questions} multiple-choice questions from these excerpts. "
                    f"Return a JSON array only.\n\n{context}"
                ),
            },
        ]
        for attempt in range(2):
            try:
                completion = await _start_quiz_completion(app, messages)
            except HTTPException:
                raise
            except Exception as exc:
                raise HTTPException(
                    502,
                    {"error": "provider_error", "message": "The LLM provider request failed"},
                ) from exc
            try:
                payload = json.loads(completion.choices[0].message.content or "")
                questions = TypeAdapter(list[QuizQuestion]).validate_python(payload)
                if len(questions) != request.num_questions:
                    raise ValueError("The LLM returned the wrong number of questions")
                return questions
            except (
                json.JSONDecodeError,
                ValidationError,
                TypeError,
                ValueError,
                IndexError,
                AttributeError,
            ) as exc:
                if attempt == 1:
                    raise HTTPException(
                        502,
                        {"error": "invalid_quiz_response", "message": "The LLM returned invalid quiz JSON"},
                    ) from exc
        raise RuntimeError("unreachable")

    return app


def _create_llm_client(settings: Settings) -> AsyncOpenAI:
    return AsyncOpenAI(
        api_key=settings.llm_api_key,
        base_url=settings.llm_base_url,
    )


def _runtime(app: FastAPI) -> Runtime:
    return app.state.runtime


def _vector(app: FastAPI) -> Embedder:
    return _runtime(app).embedder


async def _start_chat_stream(runtime: Runtime, messages: list[dict[str, str]]) -> Any:
    for attempt in range(3):
        try:
            return await runtime.llm.chat.completions.create(
                model=runtime.model,
                messages=messages,
                stream=True,
            )
        except RateLimitError as exc:
            if attempt == 2:
                raise HTTPException(
                    429,
                    {"error": "rate_limited", "message": "The LLM provider rate limit was exceeded"},
                ) from exc
            await asyncio.sleep(0.25 * (2**attempt))
        except Exception as exc:
            raise HTTPException(
                502,
                {"error": "provider_error", "message": "The LLM provider request failed"},
            ) from exc
    raise RuntimeError("unreachable")


async def _start_quiz_completion(app: FastAPI, messages: list[dict[str, str]]) -> Any:
    runtime = _runtime(app)
    return await runtime.llm.chat.completions.create(
        model=runtime.model,
        messages=messages,
        temperature=0.3,
    )


async def _chat_events(stream: Any, matches: list[tuple[StoredDocument, float]]):
    try:
        async for chunk in stream:
            text = chunk.choices[0].delta.content
            if text:
                yield _sse({"type": "token", "text": text})
    except Exception:
        return
    yield _sse(
        {
            "type": "sources",
            "sources": [
                {
                    "doc_id": document.document_id,
                    "filename": document.filename,
                    "page": document.page,
                    "snippet": document.text[:240],
                }
                for document, _ in matches
            ],
        }
    )
    yield _sse({"type": "done"})


async def _not_found_events():
    yield _sse({"type": "token", "text": "not found in your documents"})
    yield _sse({"type": "sources", "sources": []})
    yield _sse({"type": "done"})


def _sse(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


async def _cleanup_loop(ttl_minutes: int) -> None:
    while True:
        await asyncio.sleep(60)
        delete_idle_sessions(ttl_minutes)


app = create_app()