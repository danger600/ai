"""Private Career & CV Intelligence Module: local extraction, versioning, offline JD matching, PDF export, and strict privacy gate."""
from __future__ import annotations

import json
import re
import sqlite3
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from backend.core.config import CV_DIR, EXPORTS_DIR
from backend.core.security import SecurityGatekeeper, SecurityViolationError, sanitize_filename

try:
    from pypdf import PdfReader  # type: ignore
except ImportError:  # pragma: no cover
    PdfReader = None

try:
    import docx  # type: ignore
except ImportError:  # pragma: no cover
    docx = None

try:
    from reportlab.lib.pagesizes import LETTER  # type: ignore
    from reportlab.pdfgen import canvas as rl_canvas  # type: ignore
except ImportError:  # pragma: no cover
    LETTER = None
    rl_canvas = None


@dataclass
class JDComparisonResult:
    match_percent: int
    matched_skills: list[str]
    missing_keywords: list[str]
    recommendations: list[str]
    verified_projects: list[str]


def extract_cv_text(file_path: Path) -> str:
    """Locally extract text from PDF, DOCX, TXT, or MD without sending data externally."""
    if not file_path.exists():
        raise FileNotFoundError(f"CV file not found: {file_path}")
    suffix = file_path.suffix.lower()

    if suffix in (".txt", ".md"):
        return file_path.read_text(encoding="utf-8", errors="replace").strip()

    if suffix == ".docx":
        if docx is not None:
            document = docx.Document(str(file_path))
            lines = [p.text.strip() for p in document.paragraphs if p.text.strip()]
            return "\n".join(lines)
        with zipfile.ZipFile(file_path, "r") as zf:
            xml_bytes = zf.read("word/document.xml")
            root = ET.fromstring(xml_bytes)
            texts = [el.text for el in root.iter() if el.tag.endswith("}t") and el.text]
            return " ".join(texts).strip()

    if suffix == ".pdf":
        if PdfReader is not None:
            reader = PdfReader(str(file_path))
            pages = [page.extract_text() or "" for page in reader.pages]
            return "\n".join(p.strip() for p in pages if p.strip())
        raw = file_path.read_bytes().decode("latin-1", errors="ignore")
        literals = re.findall(r"\(([^()]{2,200})\)\s*Tj", raw)
        if literals:
            return "\n".join(s.replace(r"\(", "(").replace(r"\)", ")") for s in literals).strip()
        readable = re.findall(r"[A-Za-z0-9@._:,/\-\s]{6,}", raw)
        return "\n".join(line.strip() for line in readable[:120]).strip()

    raise ValueError(f"Unsupported CV format '{suffix}'. Supported: .pdf, .docx, .txt, .md")


def _write_pure_python_pdf(text: str, dest: Path) -> Path:
    """Write a valid minimal PDF 1.4 file with pure Python stdlib when reportlab is unavailable."""
    lines = []
    for raw_line in text.splitlines():
        stripped = raw_line.strip()
        if not stripped:
            lines.append("")
            continue
        while len(stripped) > 84:
            split_idx = stripped.rfind(" ", 0, 84)
            if split_idx <= 0:
                split_idx = 84
            lines.append(stripped[:split_idx])
            stripped = stripped[split_idx:].lstrip()
        lines.append(stripped)

    pages_lines: list[list[str]] = []
    chunk_size = 44
    for i in range(0, max(1, len(lines)), chunk_size):
        pages_lines.append(lines[i : i + chunk_size])

    def esc(s: str) -> str:
        safe = s.encode("latin-1", errors="replace").decode("latin-1")
        return safe.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    objects: list[bytes] = []
    # Obj 1: Catalog, Obj 2: Pages, Obj 3: Font
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    page_obj_nums = [4 + idx * 2 for idx in range(len(pages_lines))]
    kids = " ".join(f"{n} 0 R" for n in page_obj_nums)
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {len(pages_lines)} >>".encode("ascii"))
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

    for idx, p_lines in enumerate(pages_lines):
        page_num = 4 + idx * 2
        content_num = page_num + 1
        stream_parts = ["BT", "/F1 11 Tf", "50 750 Td", "15 TL"]
        for line in p_lines:
            stream_parts.append(f"({esc(line)}) Tj T*")
        stream_parts.append("ET")
        stream_bytes = "\n".join(stream_parts).encode("latin-1")
        page_dict = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 3 0 R >> >> /Contents {content_num} 0 R >>"
        ).encode("ascii")
        content_dict = f"<< /Length {len(stream_bytes)} >>\nstream\n".encode("ascii") + stream_bytes + b"\nendstream"
        objects.append(page_dict)
        objects.append(content_dict)

    pdf_chunks: list[bytes] = [b"%PDF-1.4\n"]
    offsets: list[int] = [0]
    for obj_id, obj_body in enumerate(objects, start=1):
        offsets.append(sum(len(c) for c in pdf_chunks))
        pdf_chunks.append(f"{obj_id} 0 obj\n".encode("ascii") + obj_body + b"\nendobj\n")

    xref_pos = sum(len(c) for c in pdf_chunks)
    xref_lines = [f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n"]
    for off in offsets[1:]:
        xref_lines.append(f"{off:010d} 00000 n \n")
    trailer = f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n"
    pdf_chunks.append("".join(xref_lines).encode("ascii"))
    pdf_chunks.append(trailer.encode("ascii"))

    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(b"".join(pdf_chunks))
    return dest


class CVManager:
    def __init__(self, conn: sqlite3.Connection, gatekeeper: SecurityGatekeeper) -> None:
        self.conn = conn
        self.gatekeeper = gatekeeper

    def get_primary_cv(self) -> dict[str, Any]:
        row = self.conn.execute("SELECT * FROM cv_profiles WHERE id = 'remy-primary-cv'").fetchone()
        if not row:
            raise LookupError("Primary CV profile is not initialized.")
        data = dict(row)
        data["skills"] = json.loads(data["skills_json"])
        data["projects"] = json.loads(data["projects_json"])
        data["private_locked"] = not self.gatekeeper.is_permission_granted("cv.external_ai")
        return data

    def update_cv_raw_text(self, raw_text: str, skills: list[str] | None = None) -> dict[str, Any]:
        if skills is not None:
            self.conn.execute(
                "UPDATE cv_profiles SET raw_text = ?, skills_json = ?, updated_at = datetime('now') WHERE id = 'remy-primary-cv'",
                (raw_text.strip(), json.dumps(skills)),
            )
        else:
            self.conn.execute(
                "UPDATE cv_profiles SET raw_text = ?, updated_at = datetime('now') WHERE id = 'remy-primary-cv'",
                (raw_text.strip(),),
            )
        self.conn.commit()
        self.gatekeeper.log_audit("cv_updated", "user", "remy-primary-cv", "allowed")
        return self.get_primary_cv()

    def import_cv_file(self, source_path: Path) -> dict[str, Any]:
        CV_DIR.mkdir(parents=True, exist_ok=True)
        safe_name = sanitize_filename(source_path.name)
        dest = self.gatekeeper.validate_safe_path(CV_DIR, safe_name)
        text = extract_cv_text(source_path)
        dest.write_bytes(source_path.read_bytes())
        return self.create_version(version_label=f"Imported: {safe_name}", target_role="", raw_text=text, notes="Local file import")

    def list_versions(self) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT * FROM cv_versions WHERE cv_id = 'remy-primary-cv' ORDER BY created_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]

    def create_version(self, version_label: str, target_role: str, raw_text: str, notes: str = "") -> dict[str, Any]:
        ver_id = f"cv-{uuid.uuid4().hex[:8]}"
        self.conn.execute(
            """
            INSERT INTO cv_versions (id, cv_id, version_label, target_role, raw_text, notes)
            VALUES (?, 'remy-primary-cv', ?, ?, ?, ?)
            """,
            (ver_id, version_label.strip(), target_role.strip(), raw_text.strip(), notes.strip()),
        )
        self.conn.execute(
            "UPDATE cv_profiles SET raw_text = ?, updated_at = datetime('now') WHERE id = 'remy-primary-cv'",
            (raw_text.strip(),),
        )
        self.conn.commit()
        self.gatekeeper.log_audit("cv_version_created", "user", ver_id, "allowed", version_label)
        row = self.conn.execute("SELECT * FROM cv_versions WHERE id = ?", (ver_id,)).fetchone()
        return dict(row)

    def restore_version(self, version_id: str) -> dict[str, Any]:
        row = self.conn.execute("SELECT * FROM cv_versions WHERE id = ?", (version_id,)).fetchone()
        if not row:
            raise LookupError(f"CV version '{version_id}' not found.")
        self.conn.execute(
            "UPDATE cv_profiles SET raw_text = ?, updated_at = datetime('now') WHERE id = 'remy-primary-cv'",
            (row["raw_text"],),
        )
        self.conn.commit()
        self.gatekeeper.log_audit("cv_version_restored", "user", version_id, "allowed")
        return self.get_primary_cv()

    def compare_with_job_description(self, job_description: str) -> JDComparisonResult:
        """Purely offline deterministic CV vs Job Description skill matcher. Never leaks data externally."""
        cv = self.get_primary_cv()
        jd_lower = job_description.lower()
        cv_skills: list[str] = cv["skills"]
        projects: list[dict[str, str]] = cv["projects"]

        matched: list[str] = []
        for skill in cv_skills:
            tokens = [t for t in re.split(r"[\s./]+", skill.lower()) if len(t) > 1]
            if skill.lower() in jd_lower or any(re.search(rf"\b{re.escape(t)}\b", jd_lower) for t in tokens):
                matched.append(skill)

        common_tech_keywords = [
            "python", "react", "node.js", "express", "javascript", "typescript", "html5", "css3",
            "mongodb", "mysql", "supabase", "postgresql", "sql", "rest", "api", "git", "github",
            "docker", "linux", "testing", "pytest", "fastapi", "django", "blockchain", "security",
        ]
        jd_detected = [kw for kw in common_tech_keywords if re.search(rf"\b{re.escape(kw)}\b", jd_lower)]
        cv_lower = cv["raw_text"].lower()
        missing = [kw for kw in jd_detected if kw not in cv_lower]

        denominator = max(1, len(set(matched)) + len(missing))
        score = min(100, round((len(set(matched)) / denominator) * 100)) if (matched or missing) else 0

        recommendations: list[str] = []
        if missing:
            recommendations.append(f"Prepare concrete study notes or portfolio demos covering: {', '.join(missing)}.")
        if projects:
            recommendations.append(
                f"Highlight verified projects in interviews: {', '.join(p['name'] for p in projects)}."
            )
        recommendations.append("Keep all stated facts aligned strictly with verified education (EAV KIVUMU TSS) and April 2026 internship (ICT SMART SOLUTION).")

        return JDComparisonResult(
            match_percent=score,
            matched_skills=matched,
            missing_keywords=missing,
            recommendations=recommendations,
            verified_projects=[p["name"] for p in projects],
        )

    def require_external_ai_approval(self, actor: str = "career_agent") -> dict[str, Any]:
        """Privacy gate: refuses external AI prompt access to CV unless cv.external_ai is explicitly granted."""
        strict_row = self.conn.execute("SELECT value FROM app_settings WHERE key = 'strict_local_mode'").fetchone()
        if strict_row and strict_row[0] == "true":
            self.gatekeeper.log_audit("cv_external_blocked", actor, "remy-primary-cv", "denied", "Strict Local-Only Mode active")
            raise SecurityViolationError("Strict Local-Only Mode blocks external AI transmission of private CV.")
        self.gatekeeper.require_permission("cv.external_ai", actor=actor, target="remy-primary-cv")
        return self.get_primary_cv()

    def build_career_action_prompt(self, action: str, job_description: str = "") -> list[dict[str, str]]:
        cv = self.require_external_ai_approval()
        strict_rules = (
            "CRITICAL AUTHENTICITY RULE: Use ONLY verified facts below. "
            "Do NOT invent internship duties, job titles, employment history, academic grades, certificates, or awards.\n\n"
            f"Verified CV:\n{cv['raw_text']}"
        )
        task_map = {
            "skills_analysis": "Analyze technical strengths and suggest realistic next learning steps.",
            "optimize": "Suggest clearer ATS phrasing and structure for the verified CV without inventing experience.",
            "cover_letter": f"Draft a professional cover letter strictly using verified details for:\n{job_description}",
            "interview_questions": f"Generate technical interview questions tailored to verified skills and this role:\n{job_description}",
            "portfolio": "Recommend how to showcase the 4 verified projects clearly on GitHub (https://github.com/danger600).",
        }
        instruction = task_map.get(action, "Provide truthful career guidance based strictly on the verified CV.")
        return [
            {"role": "system", "content": strict_rules},
            {"role": "user", "content": instruction},
        ]

    def export_cv_pdf(self, filename: str = "Remy_Nsanzimana_CV.pdf") -> Path:
        cv = self.get_primary_cv()
        safe_name = sanitize_filename(filename if filename.lower().endswith(".pdf") else f"{filename}.pdf")
        dest = self.gatekeeper.validate_safe_path(EXPORTS_DIR, safe_name)

        if rl_canvas is not None and LETTER is not None:
            c = rl_canvas.Canvas(str(dest), pagesize=LETTER)
            width, height = LETTER
            y = height - 54
            c.setFont("Helvetica-Bold", 15)
            c.drawString(50, y, cv["full_name"])
            y -= 18
            c.setFont("Helvetica", 10)
            c.drawString(50, y, f"{cv['location']} | {cv['github_url']}")
            y -= 24
            for line in cv["raw_text"].splitlines():
                if y < 54:
                    c.showPage()
                    y = height - 54
                    c.setFont("Helvetica", 10)
                c.drawString(50, y, line[:95])
                y -= 14
            c.save()
        else:
            _write_pure_python_pdf(cv["raw_text"], dest)

        self.gatekeeper.log_audit("cv_pdf_exported", "user", str(dest.name), "allowed")
        return dest
