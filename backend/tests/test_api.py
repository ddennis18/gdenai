from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pymupdf
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.store import SESSIONS, Session, delete_idle_sessions


class FakeEmbedder:
    def encode(self, text: str, normalize_embeddings: bool = True) -> list[float]:
        return [float(len(text)), float(text.lower().count("biology"))]


class FakeCompletions:
    last_kwargs: dict = {}

    async def create(self, **kwargs):
        self.last_kwargs = kwargs
        if kwargs.get("stream"):
            return FakeStream()
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="Study answer"))])


class FakeStream:
    def __aiter__(self):
        return self._chunks()

    async def _chunks(self):
        for text in ("Study ", "answer"):
            yield SimpleNamespace(
                choices=[SimpleNamespace(delta=SimpleNamespace(content=text))]
            )


class FakeLlm:
    completions = FakeCompletions()
    chat = SimpleNamespace(completions=completions)


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
        assert missing.json()["error"] == "session_expired"


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
        response = api.post(
            "/documents",
            headers={"X-Session-Id": session_id},
            files={"file": ("notes.txt", b"notes", "text/plain")},
        )
        assert response.status_code == 201
        session = SESSIONS[session_id]
        first_active = session.last_active

        response = api.post("/query", headers={"X-Session-Id": session_id}, json={"question": "biology"})
        assert response.status_code == 200
        assert SESSIONS[session_id].last_active >= first_active


def test_documents_can_be_listed_and_deleted(client: TestClient) -> None:
    with client as api:
        upload = api.post(
            "/documents",
            headers={"X-Session-Id": "document-actions"},
            files={"file": ("notes.txt", b"notes", "text/plain")},
        )
        document_id = upload.json()["id"]
        listed = api.get("/documents", headers={"X-Session-Id": "document-actions"})
        assert listed.status_code == 200
        assert listed.json()[0]["id"] == document_id

        deleted = api.delete(
            f"/documents/{document_id}",
            headers={"X-Session-Id": "document-actions"},
        )
        assert deleted.status_code == 200
        assert api.get("/documents", headers={"X-Session-Id": "document-actions"}).json() == []


def test_session_can_be_deleted_and_then_expires(client: TestClient) -> None:
    with client as api:
        api.post(
            "/documents",
            headers={"X-Session-Id": "delete-session"},
            files={"file": ("notes.txt", b"notes", "text/plain")},
        )
        response = api.delete("/session", headers={"X-Session-Id": "delete-session"})
        assert response.status_code == 200
        expired = api.get("/documents", headers={"X-Session-Id": "delete-session"})
        assert expired.status_code == 404
        assert expired.json()["error"] == "session_expired"


def test_unknown_session_returns_session_expired(client: TestClient) -> None:
    with client as api:
        for method, path in [
            (api.get, "/documents"),
            (api.delete, "/session"),
            (api.delete, "/documents/unknown"),
        ]:
            response = method(path, headers={"X-Session-Id": "unknown"})
            assert response.status_code == 404
            assert response.json()["error"] == "session_expired"


def test_idle_sessions_are_removed_by_ttl_cleanup() -> None:
    session_id = "stale-session"
    SESSIONS[session_id] = Session(
        last_active=datetime.now(timezone.utc) - timedelta(minutes=46)
    )
    delete_idle_sessions(45)
    assert session_id not in SESSIONS


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


def test_chat_streams_tokens_sources_and_done(client: TestClient) -> None:
    with client as api:
        upload = api.post(
            "/documents",
            headers={"X-Session-Id": "chat"},
            files={"file": ("notes.txt", b"biology notes", "text/plain")},
        )
        response = api.post(
            "/chat",
            headers={"X-Session-Id": "chat"},
            json={"question": "What is biology?"},
        )
        assert response.status_code == 200
        events = [
            __import__("json").loads(line.removeprefix("data: "))
            for line in response.text.splitlines()
            if line.startswith("data: ")
        ]
        assert [event["type"] for event in events] == ["token", "token", "sources", "done"]
        assert events[0]["text"] == "Study "
        assert events[2]["sources"][0]["doc_id"] == upload.json()["id"]


def test_chat_filters_documents_and_keeps_last_four_history(client: TestClient) -> None:
    with client as api:
        first = api.post(
            "/documents",
            headers={"X-Session-Id": "chat-filter"},
            files={"file": ("first.txt", b"biology first", "text/plain")},
        ).json()["id"]
        api.post(
            "/documents",
            headers={"X-Session-Id": "chat-filter"},
            files={"file": ("second.txt", b"biology second", "text/plain")},
        )
        history = [{"role": "user", "content": str(number)} for number in range(6)]
        response = api.post(
            "/chat",
            headers={"X-Session-Id": "chat-filter"},
            json={"question": "biology", "document_ids": [first], "history": history},
        )
        assert response.status_code == 200
        messages = FakeLlm.completions.last_kwargs["messages"]
        assert [message["content"] for message in messages[1:5]] == ["2", "3", "4", "5"]
        assert f"[first.txt, page 1]" in messages[-1]["content"]
        assert "second.txt" not in messages[-1]["content"]


def test_chat_not_found_skips_provider(client: TestClient) -> None:
    with client as api:
        api.post(
            "/documents",
            headers={"X-Session-Id": "chat-not-found"},
            files={"file": ("notes.txt", b"biology notes", "text/plain")},
        )
        FakeLlm.completions.last_kwargs = {}
        response = api.post(
            "/chat",
            headers={"X-Session-Id": "chat-not-found"},
            json={"question": "biology", "document_ids": ["missing"]},
        )
        assert response.status_code == 200
        assert "not found in your documents" in response.text
        assert FakeLlm.completions.last_kwargs == {}