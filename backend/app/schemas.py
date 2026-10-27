from typing import Literal

from pydantic import BaseModel, Field, model_validator


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


class QuizRequest(BaseModel):
    document_id: str = Field(min_length=1)
    num_questions: int = Field(ge=1, le=20)


class QuizQuestion(BaseModel):
    question: str = Field(min_length=1)
    options: list[str] = Field(min_length=4, max_length=4)
    answer: str = Field(min_length=1)
    explanation: str = Field(min_length=1)
    source_page: int = Field(ge=1)

    @model_validator(mode="after")
    def validate_answer(self) -> "QuizQuestion":
        if self.answer not in self.options:
            raise ValueError("answer must match one of the options")
        return self


class ErrorResponse(BaseModel):
    error: str
    message: str