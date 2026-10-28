from dataclasses import dataclass, field
from datetime import datetime, timezone

import faiss
import numpy as np


@dataclass(frozen=True)
class StoredDocument:
    document_id: str
    filename: str
    text: str
    page: int
    embedding: list[float]


@dataclass
class Session:
    docs: list[StoredDocument] = field(default_factory=list)
    index: faiss.Index | None = None
    last_active: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def add(self, documents: list[StoredDocument], embeddings: list[list[float]]) -> None:
        vectors = np.asarray(embeddings, dtype="float32")
        if self.index is None:
            self.index = faiss.IndexFlatIP(vectors.shape[1])
        self.index.add(vectors)
        self.docs.extend(documents)

    def delete_document(self, document_id: str) -> bool:
        if not any(document.document_id == document_id for document in self.docs):
            return False
        self.docs = [document for document in self.docs if document.document_id != document_id]
        if self.docs:
            vectors = np.asarray([document.embedding for document in self.docs], dtype="float32")
            self.index = faiss.IndexFlatIP(vectors.shape[1])
            self.index.add(vectors)
        else:
            self.index = None
        return True

    def documents(self) -> list[tuple[str, str, int, int]]:
        summaries: dict[str, tuple[str, set[int], int]] = {}
        for document in self.docs:
            if document.document_id not in summaries:
                summaries[document.document_id] = (document.filename, set(), 0)
            filename, pages, chunks = summaries[document.document_id]
            pages.add(document.page)
            summaries[document.document_id] = (filename, pages, chunks + 1)
        return [
            (document_id, filename, len(pages), chunks)
            for document_id, (filename, pages, chunks) in summaries.items()
        ]

    def sample_document_chunks(self, document_id: str, limit: int) -> list[StoredDocument]:
        chunks = [document for document in self.docs if document.document_id == document_id]
        if len(chunks) <= limit:
            return chunks
        positions = np.linspace(0, len(chunks) - 1, num=limit, dtype=int)
        return [chunks[int(position)] for position in positions]

    def search(
        self,
        query_embedding: list[float],
        limit: int,
        document_ids: set[str] | None = None,
        threshold: float = float("-inf"),
    ) -> list[tuple[StoredDocument, float]]:
        if self.index is None or not self.docs:
            return []
        distances, indices = self.index.search(
            np.asarray([query_embedding], dtype="float32"), len(self.docs)
        )
        matches = []
        for distance, index in zip(distances[0], indices[0]):
            if index < 0 or distance < threshold:
                continue
            document = self.docs[int(index)]
            if document_ids is None or document.document_id in document_ids:
                matches.append((document, float(distance)))
                if len(matches) == limit:
                    break
        return matches


SESSIONS: dict[str, Session] = {}


def delete_idle_sessions(ttl_minutes: int) -> None:
    cutoff = datetime.now(timezone.utc).timestamp() - ttl_minutes * 60
    expired = [
        session_id
        for session_id, session in SESSIONS.items()
        if session.last_active.timestamp() < cutoff
    ]
    for session_id in expired:
        del SESSIONS[session_id]