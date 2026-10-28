from datetime import datetime, timezone

from fastapi import Header, HTTPException

from .store import SESSIONS, Session


def get_session(x_session_id: str | None = Header(default=None)) -> Session:
    session_id = _session_id(x_session_id)
    session = SESSIONS.setdefault(session_id, Session())
    session.last_active = datetime.now(timezone.utc)
    return session


def get_existing_session(x_session_id: str | None = Header(default=None)) -> Session:
    session_id = _session_id(x_session_id)
    session = SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "session_expired",
                "message": "Session not found or expired",
            },
        )
    session.last_active = datetime.now(timezone.utc)
    return session


def _session_id(x_session_id: str | None) -> str:
    if not x_session_id or not x_session_id.strip():
        raise HTTPException(
            status_code=400,
            detail={
                "error": "missing_session_id",
                "message": "X-Session-Id header is required",
            },
        )
    return x_session_id.strip()