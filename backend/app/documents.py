from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

import pymupdf
from docx import Document


SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".txt"}


@dataclass(frozen=True)
class PageText:
    page: int
    text: str


def extract_pages(filename: str, data: bytes) -> list[PageText]:
    suffix = Path(filename).suffix.lower()
    if suffix == ".pdf":
        with pymupdf.open(stream=data, filetype="pdf") as pdf:
            return [PageText(page.number + 1, page.get_text("text").strip()) for page in pdf]
    if suffix == ".docx":
        document = Document(BytesIO(data))
        text = "\n".join(paragraph.text for paragraph in document.paragraphs).strip()
        return [PageText(1, text)]
    if suffix == ".txt":
        return [PageText(1, data.decode("utf-8", errors="replace").strip())]
    raise ValueError("Only PDF, DOCX, and TXT files are supported")


def chunk_pages(pages: list[PageText], size: int = 500, overlap: int = 50) -> list[PageText]:
    chunks: list[PageText] = []
    step = size - overlap
    for page in pages:
        words = page.text.split()
        for start in range(0, len(words), step):
            chunk = " ".join(words[start : start + size])
            if chunk:
                chunks.append(PageText(page.page, chunk))
            if start + size >= len(words):
                break
    return chunks