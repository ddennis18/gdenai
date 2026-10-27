from typing import Literal

from pydantic import BaseModel, Field


class DocumentResponse(BaseModel):
    id: str
    filename: str
    pages: int
    chunks: int


class QueryRequest(BaseModel):
    question: str = Field(min_length=1)
    top_k: int = Field(default=4, ge=1, le=10)


class Source(BaseModel):
    document_id: str
    filename: str
    page: int
    score: float


class QueryResponse(BaseModel):
    answer: str
    sources: list[Source]


class ChatHistoryTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    question: str = Field(min_length=1)
    document_ids: list[str] | None = None
    history: list[ChatHistoryTurn] | None = None


class ChatSource(BaseModel):
    doc_id: str
    filename: str
    page: int
    snippet: str


class ErrorResponse(BaseModel):
    error: str
    message: str