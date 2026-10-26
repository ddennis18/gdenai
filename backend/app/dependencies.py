from datetime import datetime, timezone

from fastapi import Header, HTTPException

from .store import SESSIONS, Session


def get_session(x_session_id: str | None = Header(default=None)) -> Session:
    if not x_session_id or not x_session_id.strip():
        raise HTTPException(
            status_code=400,
            detail={
                "error": "missing_session_id",
                "message": "X-Session-Id header is required",
            },
        )

    session_id = x_session_id.strip()
    session = SESSIONS.setdefault(session_id, Session())
    session.last_active = datetime.now(timezone.utc)
    return session