"""Local Document Intelligence & RAG Engine with multi-format extraction and exact citations."""
from __future__ import annotations

import csv
import math
import re
import sqlite3
import uuid
import zipfile
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from backend.core.config import DOCUMENTS_DIR
from backend.core.security import SecurityGatekeeper, sanitize_filename

try:
    from pypdf import PdfReader  # type: ignore
except ImportError:  # pragma: no cover
    PdfReader = None

try:
    import docx  # type: ignore
except ImportError:  # pragma: no cover
    docx = None

try:
    import openpyxl  # type: ignore
except ImportError:  # pragma: no cover
    openpyxl = None


@dataclass
class ExtractedChunk:
    page_or_row: str
    content: str


def _tokenize(text: str) -> list[str]:
    return [tok for tok in re.findall(r"[a-z0-9_]{2,}", text.lower())]


def _extract_xlsx_chunks(file_path: Path) -> list[ExtractedChunk]:
    chunks: list[ExtractedChunk] = []
    if openpyxl is not None:
        wb = openpyxl.load_workbook(str(file_path), data_only=True)
        for sheet in wb.sheetnames:
            ws = wb[sheet]
            for idx, row in enumerate(ws.iter_rows(values_only=True), start=1):
                vals = [str(v).strip() for v in row if v is not None and str(v).strip()]
                if vals:
                    chunks.append(ExtractedChunk(page_or_row=f"{sheet} Row {idx}", content=" | ".join(vals)))
        return chunks

    with zipfile.ZipFile(file_path, "r") as zf:
        shared_strings: list[str] = []
        if "xl/sharedStrings.xml" in zf.namelist():
            root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in root.iter():
                if si.tag.endswith("}si"):
                    parts = [t.text or "" for t in si.iter() if t.tag.endswith("}t")]
                    shared_strings.append("".join(parts))
        sheet_names = sorted(n for n in zf.namelist() if n.startswith("xl/worksheets/sheet") and n.endswith(".xml"))
        for s_idx, s_name in enumerate(sheet_names, start=1):
            root = ET.fromstring(zf.read(s_name))
            for r_idx, row in enumerate(root.iter(), start=1):
                if not row.tag.endswith("}row"):
                    continue
                row_vals: list[str] = []
                for cell in row:
                    cell_type = cell.attrib.get("t", "")
                    val = ""
                    for child in cell:
                        if child.tag.endswith("}v") and child.text:
                            if cell_type == "s" and child.text.isdigit():
                                idx_val = int(child.text)
                                val = shared_strings[idx_val] if idx_val < len(shared_strings) else child.text
                            else:
                                val = child.text
                        elif child.tag.endswith("}is"):
                            val = "".join(t.text or "" for t in child.iter() if t.tag.endswith("}t"))
                    if val.strip():
                        row_vals.append(val.strip())
                if row_vals:
                    chunks.append(ExtractedChunk(page_or_row=f"Sheet{s_idx} Row {r_idx}", content=" | ".join(row_vals)))
    return chunks


def extract_document_segments(file_path: Path) -> tuple[list[ExtractedChunk], int, str]:
    suffix = file_path.suffix.lower()

    if suffix in (".txt", ".md", ".py", ".js", ".ts", ".json", ".sql", ".html", ".css"):
        text = file_path.read_text(encoding="utf-8", errors="replace")
        lines = text.splitlines()
        chunks: list[ExtractedChunk] = []
        step = 30
        for start in range(0, max(1, len(lines)), step):
            block = "\n".join(lines[start : start + step]).strip()
            if block:
                end = min(len(lines), start + step)
                chunks.append(ExtractedChunk(page_or_row=f"Lines {start + 1}-{end}", content=block))
        return chunks, 1, "text/plain"

    if suffix == ".csv":
        chunks = []
        with file_path.open("r", encoding="utf-8", errors="replace", newline="") as fh:
            reader = csv.reader(fh)
            for idx, row in enumerate(reader, start=1):
                cleaned = [c.strip() for c in row if c.strip()]
                if cleaned:
                    chunks.append(ExtractedChunk(page_or_row=f"CSV Row {idx}", content=" | ".join(cleaned)))
        return chunks, 1, "text/csv"

    if suffix == ".xlsx":
        chunks = _extract_xlsx_chunks(file_path)
        return chunks, max(1, len(chunks)), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    if suffix == ".docx":
        if docx is not None:
            document = docx.Document(str(file_path))
            paras = [p.text.strip() for p in document.paragraphs if p.text.strip()]
        else:
            with zipfile.ZipFile(file_path, "r") as zf:
                root = ET.fromstring(zf.read("word/document.xml"))
                paras = []
                for p in root.iter():
                    if p.tag.endswith("}p"):
                        txt = "".join(t.text or "" for t in p.iter() if t.tag.endswith("}t")).strip()
                        if txt:
                            paras.append(txt)
        chunks = []
        for idx in range(0, max(1, len(paras)), 6):
            block = "\n".join(paras[idx : idx + 6]).strip()
            if block:
                chunks.append(ExtractedChunk(page_or_row=f"Section {idx // 6 + 1}", content=block))
        return chunks, max(1, len(chunks)), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

    if suffix == ".pdf":
        chunks = []
        if PdfReader is not None:
            reader = PdfReader(str(file_path))
            for idx, page in enumerate(reader.pages, start=1):
                txt = (page.extract_text() or "").strip()
                if txt:
                    chunks.append(ExtractedChunk(page_or_row=f"Page {idx}", content=txt))
            return chunks, max(1, len(reader.pages)), "application/pdf"
        raw = file_path.read_bytes().decode("latin-1", errors="ignore")
        literals = re.findall(r"\(([^()]{2,240})\)\s*Tj", raw)
        extracted = "\n".join(s.replace(r"\(", "(").replace(r"\)", ")") for s in literals).strip()
        if not extracted:
            extracted = "\n".join(re.findall(r"[A-Za-z0-9@._:,/\-\s]{6,}", raw)[:120]).strip()
        if extracted:
            chunks.append(ExtractedChunk(page_or_row="Page 1", content=extracted))
        return chunks, 1, "application/pdf"

    raise ValueError(f"Unsupported document extension: '{suffix}'")


class LocalRAGEngine:
    def __init__(self, conn: sqlite3.Connection, gatekeeper: SecurityGatekeeper) -> None:
        self.conn = conn
        self.gatekeeper = gatekeeper

    def ingest_file(self, source_path: Path) -> dict[str, Any]:
        if not source_path.exists():
            raise FileNotFoundError(f"File not found: {source_path}")
        DOCUMENTS_DIR.mkdir(parents=True, exist_ok=True)
        safe_name = sanitize_filename(source_path.name)
        stored_path = self.gatekeeper.validate_safe_path(DOCUMENTS_DIR, safe_name)
        stored_path.write_bytes(source_path.read_bytes())

        chunks, page_count, mime_type = extract_document_segments(stored_path)
        doc_id = f"doc-{uuid.uuid4().hex[:8]}"
        summary = chunks[0].content[:240] if chunks else "No extractable text found."

        self.conn.execute(
            """
            INSERT INTO documents (id, filename, mime_type, size_bytes, page_count, summary, local_only)
            VALUES (?, ?, ?, ?, ?, ?, 1)
            """,
            (doc_id, safe_name, mime_type, stored_path.stat().st_size, page_count, summary),
        )

        for idx, chunk in enumerate(chunks):
            top_keywords = [w for w, _ in Counter(_tokenize(chunk.content)).most_common(12)]
            self.conn.execute(
                """
                INSERT INTO document_chunks (id, document_id, chunk_index, page_or_row, content, keywords)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (f"chk-{uuid.uuid4().hex[:10]}", doc_id, idx, chunk.page_or_row, chunk.content, ",".join(top_keywords)),
            )

        self.conn.commit()
        self.gatekeeper.log_audit("document_ingested", "user", safe_name, "allowed", f"chunks={len(chunks)}")
        return self.get_document(doc_id)

    def list_documents(self) -> list[dict[str, Any]]:
        rows = self.conn.execute("SELECT * FROM documents ORDER BY created_at DESC").fetchall()
        return [dict(r) for r in rows]

    def get_document(self, doc_id: str) -> dict[str, Any]:
        row = self.conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
        if not row:
            raise LookupError(f"Document '{doc_id}' not found.")
        chunks = self.conn.execute(
            "SELECT id, chunk_index, page_or_row, content FROM document_chunks WHERE document_id = ? ORDER BY chunk_index ASC",
            (doc_id,),
        ).fetchall()
        result = dict(row)
        result["chunks"] = [dict(c) for c in chunks]
        return result

    def delete_document(self, doc_id: str) -> None:
        row = self.conn.execute("SELECT filename FROM documents WHERE id = ?", (doc_id,)).fetchone()
        if row:
            safe_file = DOCUMENTS_DIR / sanitize_filename(row["filename"])
            if safe_file.exists():
                safe_file.unlink()
        self.conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
        self.conn.commit()

    def search_chunks(self, query: str, limit: int = 5) -> list[dict[str, Any]]:
        q_tokens = _tokenize(query)
        if not q_tokens:
            return []
        rows = self.conn.execute(
            """
            SELECT dc.id, dc.document_id, dc.page_or_row, dc.content, d.filename
            FROM document_chunks dc
            JOIN documents d ON d.id = dc.document_id
            """
        ).fetchall()
        if not rows:
            return []

        doc_freq: Counter[str] = Counter()
        chunk_tokens_list: list[list[str]] = []
        for r in rows:
            toks = _tokenize(r["content"])
            chunk_tokens_list.append(toks)
            for unique_tok in set(toks):
                doc_freq[unique_tok] += 1

        total_docs = len(rows)
        scored: list[tuple[float, dict[str, Any]]] = []
        for row, toks in zip(rows, chunk_tokens_list):
            tf = Counter(toks)
            score = 0.0
            for qt in q_tokens:
                if qt in tf:
                    idf = math.log((1 + total_docs) / (1 + doc_freq[qt])) + 1.0
                    score += (1.0 + math.log(tf[qt])) * idf
            if query.lower() in row["content"].lower():
                score += 2.5
            if score > 0:
                scored.append(
                    (
                        round(score, 4),
                        {
                            "chunk_id": row["id"],
                            "document_id": row["document_id"],
                            "filename": row["filename"],
                            "citation": f"[{row['filename']} | {row['page_or_row']}]",
                            "page_or_row": row["page_or_row"],
                            "excerpt": row["content"],
                            "score": round(score, 4),
                        },
                    )
                )

        scored.sort(key=lambda item: item[0], reverse=True)
        return [item[1] for item in scored[:limit]]
