from types import SimpleNamespace

import pymupdf
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.store import SESSIONS


class FakeEmbedder:
    def encode(self, text: str, normalize_embeddings: bool = True) -> list[float]:
        return [float(len(text)), float(text.lower().count("biology"))]


class FakeCompletions:
    async def create(self, **kwargs):
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="Study answer"))])


class FakeLlm:
    chat = SimpleNamespace(completions=FakeCompletions())


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("LLM_MODEL", "test-model")
    return TestClient(
        create_app(
            FakeEmbedder(),
            FakeLlm(),
            Settings(
                llm_base_url="https://test.invalid/v1",
                llm_api_key="test-key",
                llm_model="test-model",
            ),
        )
    )


def test_documents_are_isolated_by_session(client: TestClient) -> None:
    with client as api:
        response = api.post(
            "/documents",
            headers={"X-Session-Id": "one"},
            files={"file": ("notes.txt", b"biology notes", "text/plain")},
        )
        assert response.status_code == 201
        missing = api.post("/query", headers={"X-Session-Id": "two"}, json={"question": "biology"})
        assert missing.status_code == 404
        assert missing.json()["error"] == "no_documents"


def test_query_returns_answer_and_sources(client: TestClient) -> None:
    with client as api:
        api.post(
            "/documents",
            headers={"X-Session-Id": "one"},
            files={"file": ("notes.txt", b"biology notes", "text/plain")},
        )
        response = api.post("/query", headers={"X-Session-Id": "one"}, json={"question": "biology"})
        assert response.status_code == 200
        assert response.json()["answer"] == "Study answer"
        assert response.json()["sources"][0]["filename"] == "notes.txt"


def test_missing_session_id_uses_error_shape(client: TestClient) -> None:
    with client as api:
        response = api.post("/query", json={"question": "biology"})
        assert response.status_code == 400
        assert response.json()["error"] == "missing_session_id"


def test_health_does_not_require_a_session(client: TestClient) -> None:
    with client as api:
        response = api.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


def test_session_is_created_and_activity_is_updated(client: TestClient) -> None:
    session_id = "activity-check"
    SESSIONS.pop(session_id, None)
    with client as api:
        response = api.post("/query", headers={"X-Session-Id": session_id}, json={"question": "biology"})
        assert response.status_code == 404
        session = SESSIONS[session_id]
        first_active = session.last_active

        response = api.post("/query", headers={"X-Session-Id": session_id}, json={"question": "biology"})
        assert response.status_code == 404
        assert SESSIONS[session_id].last_active >= first_active


def test_document_upload_returns_page_and_chunk_metadata(client: TestClient) -> None:
    with client as api:
        response = api.post(
            "/documents",
            headers={"X-Session-Id": "metadata"},
            files={"file": ("notes.txt", b"biology notes", "text/plain")},
        )
        assert response.status_code == 201
        assert response.json()["filename"] == "notes.txt"
        assert response.json()["pages"] == 1
        assert response.json()["chunks"] == 1
        assert response.json()["id"]


def test_unsupported_document_type_returns_415(client: TestClient) -> None:
    with client as api:
        response = api.post(
            "/documents",
            headers={"X-Session-Id": "unsupported"},
            files={"file": ("notes.png", b"not a supported document", "image/png")},
        )
        assert response.status_code == 415
        assert response.json()["error"] == "unsupported_file_type"


def test_oversized_document_returns_413(client: TestClient) -> None:
    with client as api:
        response = api.post(
            "/documents",
            headers={"X-Session-Id": "oversized"},
            files={"file": ("large.txt", b"x" * (10 * 1024 * 1024 + 1), "text/plain")},
        )
        assert response.status_code == 413
        assert response.json()["error"] == "file_too_large"


def test_blank_pdf_returns_clear_422(client: TestClient) -> None:
    pdf = pymupdf.open()
    pdf.new_page()
    pdf_bytes = pdf.tobytes()
    pdf.close()
    with client as api:
        response = api.post(
            "/documents",
            headers={"X-Session-Id": "blank-pdf"},
            files={"file": ("blank.pdf", pdf_bytes, "application/pdf")},
        )
        assert response.status_code == 422
        assert response.json()["error"] == "no_extractable_text"
        assert "no extractable text" in response.json()["message"]


def test_session_document_limit_returns_413(client: TestClient) -> None:
    with client as api:
        for document_number in range(5):
            response = api.post(
                "/documents",
                headers={"X-Session-Id": "document-limit"},
                files={"file": (f"notes-{document_number}.txt", b"notes", "text/plain")},
            )
            assert response.status_code == 201

        response = api.post(
            "/documents",
            headers={"X-Session-Id": "document-limit"},
            files={"file": ("notes-5.txt", b"notes", "text/plain")},
        )
        assert response.status_code == 413
        assert response.json()["error"] == "document_limit_exceeded"