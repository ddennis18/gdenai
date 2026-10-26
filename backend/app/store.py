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

    def search(self, query_embedding: list[float], limit: int) -> list[tuple[StoredDocument, float]]:
        if self.index is None or not self.docs:
            return []
        distances, indices = self.index.search(
            np.asarray([query_embedding], dtype="float32"), min(limit, len(self.docs))
        )
        return [
            (self.docs[int(index)], float(distance))
            for distance, index in zip(distances[0], indices[0])
            if index >= 0
        ]


SESSIONS: dict[str, Session] = {}