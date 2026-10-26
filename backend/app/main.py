from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol
from uuid import uuid4

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from openai import AsyncOpenAI
from sentence_transformers import SentenceTransformer

from .config import Settings
from .dependencies import get_session
from .documents import SUPPORTED_EXTENSIONS, chunk_pages, extract_pages
from .schemas import DocumentResponse, ErrorResponse, QueryRequest, QueryResponse, Source
from .store import Session, StoredDocument


class Embedder(Protocol):
    def encode(self, text: str, normalize_embeddings: bool = True) -> Any: ...


class ChatClient(Protocol):
    @property
    def chat(self) -> Any: ...


@dataclass
class Runtime:
    embedder: Embedder
    llm: ChatClient
    model: str


MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
MAX_DOCUMENTS_PER_SESSION = 5


def create_app(
    embedder: Embedder | None = None,
    llm: ChatClient | None = None,
    settings: Settings | None = None,
) -> FastAPI:

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        loaded_settings = settings or Settings()
        loaded_embedder = embedder or SentenceTransformer(
            loaded_settings.embedding_model
        )
        loaded_llm = llm or _create_llm_client(loaded_settings)
        app.state.runtime = Runtime(loaded_embedder, loaded_llm, loaded_settings.llm_model)
        yield

    app = FastAPI(title="AI Study Assistant", lifespan=lifespan)

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
        documents = [
            StoredDocument(document_id, filename, chunk.text, chunk.page)
            for chunk in chunks
        ]
        embeddings = [
            list(_vector(app).encode(chunk.text, normalize_embeddings=True))
            for chunk in chunks
        ]
        session.add(documents, embeddings)
        return DocumentResponse(
            id=document_id,
            filename=filename,
            pages=len(pages),
            chunks=len(chunks),
        )

    @app.post("/query", response_model=QueryResponse)
    async def query(
        request: QueryRequest,
        session: Session = Depends(get_session),
    ) -> QueryResponse:
        runtime = _runtime(app)
        matches = session.search(
            list(runtime.embedder.encode(request.question, normalize_embeddings=True)),
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


app = create_app()