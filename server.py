#!/usr/bin/env python3
"""REMY THE GRIVER PRO — 100% Pure Python Backend HTTP/SSE Server.

Uses the modular Python backend under REMY-THE-GRIVER-PRO/backend/* for:
- SQLite persistence (19 normalized tables, WAL, foreign keys, integrity checks, backups)
- Hybrid AI orchestration: OpenAI Responses API (https://api.openai.com/v1/responses),
  Gemini Native REST SSE + Google Search Grounding + Interactions Media Studio, and Ollama
- 10-agent intent orchestrator & SecurityGatekeeper (RBAC, path traversal, SSRF, secret masking)
- Local RAG document extraction (PDF/DOCX/XLSX/CSV/MD/code) & TF-IDF citation search
- Private CV Vault, Memory Vault, Productivity Suite, GitHub Inspector, Isolated Python Sandbox
"""
from __future__ import annotations

import argparse
import base64
import email.parser
import email.policy
import io
import json
import mimetypes
import os
import platform
import queue
import re
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parent
PYTHON_PKG_DIR = ROOT_DIR / "REMY-THE-GRIVER-PRO"
if str(PYTHON_PKG_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_PKG_DIR))

from backend.agents.orchestrator import AGENTS, AgentOrchestrator
from backend.automation.plugin_manager import PluginManager
from backend.career.cv_manager import CVManager, extract_cv_text
from backend.core import config as py_config
from backend.core.ai_engine import (
    GEMINI_MODELS,
    OPENAI_MODELS,
    OPENAI_RESPONSES_URL,
    HybridAIEngine,
    format_ai_error_message,
)
from backend.core.context_builder import build_global_chat_context, build_local_fallback_reply
from backend.core.logging_setup import get_logger, mask_secrets
from backend.core.media_studio import PythonMediaStudio
from backend.core.security import SecurityGatekeeper, SecurityViolationError, sanitize_filename
from backend.database.db import create_backup, init_database
from backend.documents.rag_engine import LocalRAGEngine
from backend.integrations.dev_studio import DevStudioEngine
from backend.memory.memory_vault import MemoryVault
from backend.tools.productivity import ProductivityService, fetch_kigali_weather
from backend.tools.system_monitor import collect_system_telemetry
from backend.tools.web_research import WebResearchClient

# Load root .env if present without external dependency requirement
def _load_root_env() -> None:
    for env_path in (ROOT_DIR / ".env", PYTHON_PKG_DIR / ".env"):
        if not env_path.exists():
            continue
        for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            k, v = stripped.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k and k not in os.environ:
                os.environ[k] = v


_load_root_env()

STORAGE_DIR = ROOT_DIR / "storage"
DOCUMENTS_DIR = STORAGE_DIR / "documents"
CV_DIR = STORAGE_DIR / "cv"
EXPORTS_DIR = STORAGE_DIR / "exports"
BACKUPS_DIR = STORAGE_DIR / "backups"
LOGS_DIR = STORAGE_DIR / "logs"

# Align Python package storage directories to workspace root storage/
py_config.STORAGE_DIR = STORAGE_DIR
py_config.DOCUMENTS_DIR = DOCUMENTS_DIR
py_config.CV_DIR = CV_DIR
py_config.EXPORTS_DIR = EXPORTS_DIR
py_config.BACKUPS_DIR = BACKUPS_DIR
py_config.LOGS_DIR = LOGS_DIR
py_config.DB_PATH = STORAGE_DIR / "remy_griver_pro.db"

import backend.career.cv_manager as cv_mod
import backend.core.media_studio as media_mod
import backend.database.db as db_mod
import backend.documents.rag_engine as rag_mod

db_mod.BACKUPS_DIR = BACKUPS_DIR
db_mod.CV_DIR = CV_DIR
db_mod.DOCUMENTS_DIR = DOCUMENTS_DIR
db_mod.DB_PATH = py_config.DB_PATH
cv_mod.CV_DIR = CV_DIR
cv_mod.EXPORTS_DIR = EXPORTS_DIR
rag_mod.DOCUMENTS_DIR = DOCUMENTS_DIR
media_mod.EXPORTS_DIR = EXPORTS_DIR

LOGGER = get_logger("python_server", log_dir=LOGS_DIR)
SERVER_START_TIME = time.monotonic()
DB_LOCK = threading.RLock()
CONN: sqlite3.Connection | None = None

SENSITIVE_SCOPES_BY_AGENT: dict[str, list[str]] = {
    "main": [],
    "engineering": ["studio.vm_exec", "studio.sandbox_exec"],
    "research": ["research.web_search"],
    "documents": [],
    "career": ["cv.external_ai"],
    "productivity": [],
    "system": [],
    "education": [],
    "security": [],
    "planning": [],
}

AGENT_DESCRIPTIONS: dict[str, str] = {
    "main": "Primary conversational orchestrator managing context, Memory Vault, and direct answers.",
    "engineering": "Python 3.11+, SQL, React, debugging, refactoring, and automated unit testing.",
    "research": "Live web research separating verified source links from analytical synthesis.",
    "documents": "Local document parsing, chunk inspection, and citation-grounded RAG Q&A.",
    "career": "Private CV management, offline JD matching, and permission-gated career coaching.",
    "productivity": "Projects, task queues, quick notes, reminders, Kigali weather, and currency tools.",
    "system": "Host Python runtime telemetry, SQLite integrity, and AI provider probes.",
    "education": "Structured step-by-step tutoring across software and database fundamentals.",
    "security": "AppSec policy auditor, path traversal defense, SSRF checks, and secret masking.",
    "planning": "Milestone planning, schema architecture decomposition, and engineering roadmaps.",
}

ALLOWED_MODELS = {
    "gemini-4-hydrogen",
    "gemini-3.1-flash-lite",
    "gemini-4-carbon",
    "gemini-4-neon",
    "gpt-4o-mini",
    "gpt-4o",
    "gpt-4.1-mini",
}


def sanitize_model_name(model: str | None) -> str:
    if isinstance(model, str) and model.strip() in ALLOWED_MODELS:
        return model.strip()
    return "gemini-4-hydrogen"


def _seed_web_workspace(conn: sqlite3.Connection) -> None:
    """Ensure web workspace projects, sample tasks, notes, and starter memories exist."""
    if conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0] == 0:
        conn.executemany(
            """
            INSERT INTO projects (id, name, description, status, progress, stack, due_date)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    "proj-kivumu-campus",
                    "KIVUMU SMART CAMPUS",
                    "Campus operations and student digital workspace.",
                    "active",
                    78,
                    "React.js · Python · Database Design",
                    "2026-12-15",
                ),
                (
                    "proj-ububiko",
                    "UBUBIKO SMART",
                    "Structured inventory and smart storage management system.",
                    "active",
                    64,
                    "Python · MySQL · REST APIs",
                    "2026-12-20",
                ),
                (
                    "proj-griver",
                    "REMY THE GRIVER PRO",
                    "Pure Python personal AI & career intelligence architecture.",
                    "active",
                    94,
                    "Python 3.11 · SQLite · OpenAI Responses · Gemini",
                    "2026-11-30",
                ),
            ],
        )

    if conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0] == 0:
        conn.executemany(
            """
            INSERT INTO tasks (id, project_id, title, description, priority, status, due_date)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    "task-1",
                    "proj-griver",
                    "Verify SQLite backup & security audit rules",
                    "Run integrity checks and verify permission gatekeeper policies.",
                    "high",
                    "in_progress",
                    "2026-11-24",
                ),
                (
                    "task-2",
                    "proj-kivumu-campus",
                    "Prepare REST API schema documentation",
                    "Document endpoints and database foreign-key relations.",
                    "medium",
                    "todo",
                    "2026-11-28",
                ),
                (
                    "task-3",
                    "proj-ububiko",
                    "Review MySQL indexing on inventory queries",
                    "Benchmark query performance and validate input constraints.",
                    "medium",
                    "done",
                    "2026-11-22",
                ),
            ],
        )

    if conn.execute("SELECT COUNT(*) FROM notes").fetchone()[0] == 0:
        conn.execute(
            "INSERT INTO notes (id, title, content, category) VALUES (?, ?, ?, ?)",
            (
                "note-1",
                "Architecture Principles — Your Personal AI. Your Rules.",
                "1. Keep CV private unless explicit transmit approval is granted.\n"
                "2. Always validate paths and URLs through the central Python SecurityGatekeeper.\n"
                "3. Never execute unapproved system commands.",
                "architecture",
            ),
        )

    if conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0] == 0:
        conn.executemany(
            """
            INSERT INTO memories (id, title, content, category, approved, enabled, source)
            VALUES (?, ?, ?, ?, 1, 1, 'user')
            """,
            [
                (
                    "mem-1",
                    "Preferred Stack & Architecture",
                    "Remy builds full-stack projects with Python, React.js, Node.js, Express.js, MySQL/MongoDB/Supabase.",
                    "engineering",
                ),
                (
                    "mem-2",
                    "Personal Brand Identity",
                    "Project brand: REMY THE GRIVER PRO — Your Personal AI. Your Rules. Personal brand: BULL MAN.",
                    "identity",
                ),
            ],
        )

    conn.execute(
        "INSERT OR IGNORE INTO permissions (id, scope, description, granted) VALUES (?, ?, ?, ?)",
        ("perm-vm", "studio.vm_exec", "Allow isolated Developer Studio execution", 1),
    )
    conn.execute(
        "INSERT OR IGNORE INTO permissions (id, scope, description, granted) VALUES (?, ?, ?, ?)",
        ("perm-fs", "workspace.export", "Allow exporting PDF/ZIP bundles to downloads", 1),
    )
    conn.commit()


def init_server_runtime(db_path: Path | None = None) -> sqlite3.Connection:
    global CONN
    with DB_LOCK:
        target = db_path or py_config.DB_PATH
        CONN = init_database(target)
        _seed_web_workspace(CONN)
        return CONN


def get_db() -> sqlite3.Connection:
    if CONN is None:
        return init_server_runtime()
    return CONN


def _is_setting_enabled(conn: sqlite3.Connection, key: str) -> bool:
    row = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
    return bool(row and str(row[0]).lower() == "true")


def _describe_wmo_code(code: int) -> str:
    if code == 0:
        return "Clear sky"
    if code <= 3:
        return "Partly cloudy"
    if code <= 48:
        return "Foggy"
    if code <= 57:
        return "Drizzle"
    if code <= 67:
        return "Rain"
    if code <= 77:
        return "Snow"
    if code <= 82:
        return "Rain showers"
    if code >= 95:
        return "Thunderstorm"
    return "Variable conditions"


def _fetch_open_meteo_weather(city: str = "Kigali") -> dict[str, Any]:
    lat = -1.9441
    lon = 30.0619
    resolved_city = "Kigali"
    country = "Rwanda"

    if city.strip().lower() != "kigali":
        geo_url = (
            "https://geocoding-api.open-meteo.com/v1/search?name="
            + urllib.parse.quote(city.strip())
            + "&count=1&language=en&format=json"
        )
        req = urllib.request.Request(geo_url, headers={"User-Agent": "REMY-THE-GRIVER-PRO/1.0"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            geo = json.loads(resp.read().decode("utf-8"))
        results = geo.get("results") or []
        if not results:
            raise ValueError(f"City not found: {city}")
        lat = float(results[0]["latitude"])
        lon = float(results[0]["longitude"])
        resolved_city = str(results[0]["name"])
        country = str(results[0].get("country") or "")

    w_url = (
        f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
        "&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m"
        "&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=5"
    )
    req = urllib.request.Request(w_url, headers={"User-Agent": "REMY-THE-GRIVER-PRO/1.0"})
    with urllib.request.urlopen(req, timeout=8) as resp:
        w_data = json.loads(resp.read().decode("utf-8"))

    cur = w_data.get("current", {})
    daily_raw = w_data.get("daily", {})
    times = daily_raw.get("time", []) or []
    max_c = daily_raw.get("temperature_2m_max", []) or []
    min_c = daily_raw.get("temperature_2m_min", []) or []
    codes = daily_raw.get("weather_code", []) or []

    daily = [
        {
            "date": times[idx],
            "maxC": max_c[idx] if idx < len(max_c) else None,
            "minC": min_c[idx] if idx < len(min_c) else None,
            "code": codes[idx] if idx < len(codes) else 0,
        }
        for idx in range(len(times))
    ]
    w_code = int(cur.get("weather_code", 0) or 0)
    return {
        "city": resolved_city,
        "country": country,
        "latitude": lat,
        "longitude": lon,
        "temperatureC": cur.get("temperature_2m"),
        "apparentTemperatureC": cur.get("apparent_temperature"),
        "humidityPercent": cur.get("relative_humidity_2m"),
        "windSpeedKmh": cur.get("wind_speed_10m"),
        "weatherCode": w_code,
        "condition": _describe_wmo_code(w_code),
        "daily": daily,
    }


def _fetch_currency_rates(base: str = "USD") -> dict[str, Any]:
    clean_base = re.sub(r"[^A-Za-z]", "", base).upper()[:3] or "USD"
    url = f"https://open.er-api.com/v6/latest/{clean_base}"
    req = urllib.request.Request(url, headers={"User-Agent": "REMY-THE-GRIVER-PRO/1.0"})
    with urllib.request.urlopen(req, timeout=8) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    if data.get("result") != "success":
        raise RuntimeError("Currency provider returned unsuccessful status")
    return {
        "base": data.get("base_code", clean_base),
        "updatedAt": data.get("time_last_update_utc", ""),
        "rates": data.get("rates", {}),
    }


def _analyze_github_repository(gatekeeper: SecurityGatekeeper, repo_input: str) -> dict[str, Any]:
    clean = repo_input.strip()
    if clean.startswith(("http://", "https://")):
        safe_url = gatekeeper.validate_safe_url(clean)
        parsed = urllib.parse.urlparse(safe_url)
        host = (parsed.hostname or "").lower()
        if host not in ("github.com", "www.github.com"):
            raise ValueError("Only github.com repository URLs are accepted")
        clean = parsed.path.strip("/")

    parts = [p for p in clean.split("/") if p]
    if len(parts) < 2:
        raise ValueError('Provide a repository as "owner/repo" or "https://github.com/owner/repo"')
    owner = parts[0]
    repo = re.sub(r"\.git$", "", parts[1])
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "remy-the-griver-pro"}

    repo_url = f"https://api.github.com/repos/{urllib.parse.quote(owner)}/{urllib.parse.quote(repo)}"
    req = urllib.request.Request(repo_url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            repo_json = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        raise RuntimeError(f"GitHub repository lookup failed ({err.code}): {owner}/{repo}") from err

    contents_json: list[dict[str, Any]] = []
    try:
        c_req = urllib.request.Request(f"{repo_url}/contents", headers=headers)
        with urllib.request.urlopen(c_req, timeout=10) as resp:
            raw_contents = json.loads(resp.read().decode("utf-8"))
            if isinstance(raw_contents, list):
                contents_json = raw_contents[:40]
    except Exception:
        contents_json = []

    readme_snippet = ""
    try:
        r_req = urllib.request.Request(f"{repo_url}/readme", headers=headers)
        with urllib.request.urlopen(r_req, timeout=10) as resp:
            readme_json = json.loads(resp.read().decode("utf-8"))
            if readme_json.get("content") and readme_json.get("encoding") == "base64":
                readme_snippet = base64.b64decode(readme_json["content"]).decode("utf-8", errors="replace")[:1800]
    except Exception:
        readme_snippet = ""

    gatekeeper.log_audit("github_repo_analyzed", "developer_studio", f"{owner}/{repo}", "allowed", "Fetched public repository metadata")
    return {
        "owner": owner,
        "repo": repo,
        "fullName": repo_json.get("full_name", f"{owner}/{repo}"),
        "description": repo_json.get("description"),
        "stars": repo_json.get("stargazers_count", 0),
        "forks": repo_json.get("forks_count", 0),
        "language": repo_json.get("language"),
        "defaultBranch": repo_json.get("default_branch", "main"),
        "htmlUrl": repo_json.get("html_url", f"https://github.com/{owner}/{repo}"),
        "files": [
            {"path": f.get("path", ""), "type": f.get("type", "file"), "size": f.get("size")}
            for f in contents_json
        ],
        "readmeSnippet": readme_snippet,
    }


def _collect_web_telemetry(conn: sqlite3.Connection) -> dict[str, Any]:
    raw_tel = collect_system_telemetry(conn, py_config.DB_PATH, check_network=False)

    cpu_model = platform.processor() or "Python Runtime CPU"
    cpuinfo = Path("/proc/cpuinfo")
    if cpuinfo.exists():
        for line in cpuinfo.read_text(encoding="utf-8", errors="ignore").splitlines():
            if line.lower().startswith("model name") and ":" in line:
                cpu_model = line.split(":", 1)[1].strip()
                break

    rss_mb = 0.0
    proc_status = Path("/proc/self/status")
    if proc_status.exists():
        for line in proc_status.read_text(encoding="utf-8", errors="ignore").splitlines():
            if line.startswith("VmRSS:"):
                parts = line.split()
                if len(parts) >= 2 and parts[1].isdigit():
                    rss_mb = round(int(parts[1]) / 1024.0, 1)
                break

    db_raw = raw_tel["database"]
    tables = dict(db_raw["counts"])
    if "plugin_registry" in tables and "plugins" not in tables:
        tables["plugins"] = tables.pop("plugin_registry")

    ai_engine = HybridAIEngine()
    ollama_status = ai_engine.check_ollama(timeout_sec=0.8)
    gemini_status = ai_engine.check_gemini_cloud()
    openai_status = ai_engine.check_openai_responses()

    return {
        "telemetry": {
            "hostname": platform.node() or "localhost",
            "platform": f"{platform.system()} {platform.release()} ({platform.machine()})",
            "cpuModel": cpu_model,
            "cpuCores": os.cpu_count() or 1,
            "cpuUsagePercent": raw_tel["cpu_percent"],
            "ramTotalGb": raw_tel["ram_total_gb"],
            "ramUsedGb": raw_tel["ram_used_gb"],
            "ramUsagePercent": raw_tel["ram_percent"],
            "processRssMb": rss_mb,
            "uptimeSeconds": int(time.monotonic() - SERVER_START_TIME),
            "nodeVersion": f"Python {platform.python_version()}",
            "serverTimeIso": datetime.now(timezone.utc).isoformat(),
        },
        "dbHealth": {
            "integrity": db_raw["integrity"],
            "sizeBytes": db_raw["size_bytes"],
            "tables": tables,
        },
        "providers": {
            "gemini": {"available": gemini_status.available, "model": "gemini-4-hydrogen"},
            "openai": {
                "available": openai_status.available,
                "endpoint": OPENAI_RESPONSES_URL,
                "model": "gpt-4o-mini",
            },
            "ollama": {
                "available": ollama_status.available,
                "endpoint": ai_engine.config.ollama_base_url,
                "models": ollama_status.models,
                "error": None if ollama_status.available else ollama_status.details,
            },
        },
    }


def _build_python_bundle_zip() -> bytes:
    buf = io.BytesIO()
    skip_dirs = {"__pycache__", ".pytest_cache", ".venv", "venv", "node_modules", "storage", ".git"}
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for file_path in PYTHON_PKG_DIR.rglob("*"):
            if not file_path.is_file():
                continue
            rel = file_path.relative_to(PYTHON_PKG_DIR)
            if any(part in skip_dirs for part in rel.parts) or file_path.suffix == ".pyc":
                continue
            zf.write(file_path, arcname=f"REMY-THE-GRIVER-PRO/{rel.as_posix()}")
        if (ROOT_DIR / "server.py").exists():
            zf.write(ROOT_DIR / "server.py", arcname="REMY-THE-GRIVER-PRO/web_server.py")
    return buf.getvalue()


def _parse_multipart_file(content_type: str, body: bytes) -> tuple[str, str, bytes] | None:
    if "multipart/form-data" not in content_type.lower():
        return None
    raw_mime = b"Content-Type: " + content_type.encode("latin-1") + b"\r\nMIME-Version: 1.0\r\n\r\n" + body
    msg = email.parser.BytesParser(policy=email.policy.default).parsebytes(raw_mime)
    if not msg.is_multipart():
        return None
    for part in msg.iter_parts():
        filename = part.get_filename()
        if filename is not None:
            payload = part.get_payload(decode=True) or b""
            mime = part.get_content_type() or "application/octet-stream"
            return filename, mime, payload
    return None


def _run_python_sandbox_for_studio(conn: sqlite3.Connection, gatekeeper: SecurityGatekeeper, code: str) -> dict[str, Any]:
    started = time.monotonic()
    allowed = gatekeeper.is_permission_granted("studio.sandbox_exec") or gatekeeper.is_permission_granted("studio.vm_exec")
    if not allowed:
        gatekeeper.log_audit("python_sandbox_blocked", "security_gatekeeper", "studio.sandbox_exec", "denied", "Permission disabled by user")
        return {
            "allowed": False,
            "output": "",
            "error": "Execution blocked by Security Gatekeeper: studio.sandbox_exec / studio.vm_exec permission is disabled.",
            "durationMs": int((time.monotonic() - started) * 1000),
        }

    blocked_patterns = [
        r"\bimport\s+(subprocess|ctypes|socket|shutil)\b",
        r"\bfrom\s+(subprocess|ctypes|socket|shutil)\s+import\b",
        r"\bos\.(system|popen|exec|spawn|remove|unlink|rmdir)\b",
        r"\b__import__\s*\(",
        r"""\bopen\s*\(\s*['"]/""",
    ]
    for pat in blocked_patterns:
        if re.search(pat, code):
            gatekeeper.log_audit("python_sandbox_blocked", "security_gatekeeper", "ast_policy", "denied", f"Blocked: {pat}")
            return {
                "allowed": False,
                "output": "",
                "error": "Security Gatekeeper blocked restricted system/subprocess/filesystem call inside Python sandbox.",
                "durationMs": int((time.monotonic() - started) * 1000),
            }

    studio = DevStudioEngine(conn, gatekeeper)
    analysis = studio.analyze_python_code(code)
    if not analysis["valid_syntax"]:
        return {
            "allowed": True,
            "output": "",
            "error": analysis["error"],
            "durationMs": int((time.monotonic() - started) * 1000),
            "pythonVersion": f"Python {platform.python_version()} (-I)",
        }

    res = studio.run_isolated_python(code, timeout_sec=3.0)
    return {
        "allowed": True,
        "output": res.stdout.rstrip(),
        "error": res.stderr.strip() if res.stderr and res.stderr.strip() else None,
        "durationMs": int((time.monotonic() - started) * 1000),
        "pythonVersion": f"Python {platform.python_version()} (-I)",
    }


class RemyRequestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: object) -> None:
        return

    def _read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return b""
        return self.rfile.read(length)

    def _read_json(self) -> dict[str, Any]:
        raw = self._read_body()
        if not raw:
            return {}
        return dict(json.loads(raw.decode("utf-8")))

    def _send_json(self, status: int, data: Any) -> None:
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def _send_bytes(self, status: int, content_type: str, data: bytes, extra_headers: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _serve_static_dist(self, req_path: str) -> bool:
        dist_dir = ROOT_DIR / "dist"
        if not dist_dir.exists():
            return False
        clean = req_path.split("?", 1)[0].lstrip("/")
        candidate = (dist_dir / clean).resolve() if clean else (dist_dir / "index.html")
        if not candidate.exists() or candidate.is_dir() or dist_dir.resolve() not in candidate.parents and candidate != dist_dir.resolve():
            candidate = dist_dir / "index.html"
        if not candidate.exists():
            return False
        mime, _ = mimetypes.guess_type(str(candidate))
        self._send_bytes(HTTPStatus.OK, mime or "application/octet-stream", candidate.read_bytes())
        return True

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        try:
            if path == "/api/health":
                with DB_LOCK:
                    conn = get_db()
                    tel = _collect_web_telemetry(conn)
                ai = HybridAIEngine()
                self._send_json(
                    200,
                    {
                        "ok": True,
                        "product": "REMY THE GRIVER PRO",
                        "runtime": f"Python {platform.python_version()}",
                        "dbHealth": tel["dbHealth"],
                        "geminiConfigured": ai.check_gemini_cloud().available,
                        "openaiResponsesConfigured": ai.check_openai_responses().available,
                        "openaiResponsesUrl": OPENAI_RESPONSES_URL,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    },
                )
                return

            if path == "/api/bootstrap":
                with DB_LOCK:
                    conn = get_db()
                    user_row = conn.execute("SELECT * FROM users LIMIT 1").fetchone()
                    user = dict(user_row) if user_row else {}
                    settings_rows = conn.execute("SELECT key, value FROM app_settings").fetchall()
                    settings = {r["key"]: r["value"] for r in settings_rows}
                    conversations = [
                        dict(r) for r in conn.execute("SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 50").fetchall()
                    ]
                    permissions = [dict(r) for r in conn.execute("SELECT * FROM permissions ORDER BY id").fetchall()]
                    providers = [dict(r) for r in conn.execute("SELECT * FROM provider_configs ORDER BY priority ASC").fetchall()]

                hide_private = settings.get("hide_private_features") == "true"
                safe_user = (
                    {
                        "full_name": "Private Workspace",
                        "brand_name": "REMY THE GRIVER PRO",
                        "education": "",
                        "location": "",
                        "github_url": "",
                        "email": "",
                    }
                    if hide_private
                    else user
                )
                ai = HybridAIEngine()
                self._send_json(
                    200,
                    {
                        "user": safe_user,
                        "settings": settings,
                        "conversations": conversations,
                        "agents": [
                            {
                                "id": a.id,
                                "name": a.name,
                                "role": a.role,
                                "description": AGENT_DESCRIPTIONS.get(a.id, a.system_prompt),
                                "sensitiveScopes": SENSITIVE_SCOPES_BY_AGENT.get(a.id, []),
                            }
                            for a in AGENTS
                        ],
                        "permissions": permissions,
                        "providers": providers,
                        "geminiConfigured": ai.check_gemini_cloud().available or ai.check_openai_responses().available,
                    },
                )
                return

            if path == "/api/conversations":
                with DB_LOCK:
                    rows = [dict(r) for r in get_db().execute("SELECT * FROM conversations ORDER BY updated_at DESC").fetchall()]
                self._send_json(200, rows)
                return

            m_msgs = re.fullmatch(r"/api/conversations/([^/]+)/messages", path)
            if m_msgs:
                conv_id = urllib.parse.unquote(m_msgs.group(1))
                with DB_LOCK:
                    rows = [
                        dict(r)
                        for r in get_db()
                        .execute("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC", (conv_id,))
                        .fetchall()
                    ]
                self._send_json(200, rows)
                return

            if path == "/api/documents":
                with DB_LOCK:
                    rag = LocalRAGEngine(get_db(), SecurityGatekeeper(get_db()))
                    docs = rag.list_documents()
                self._send_json(200, docs)
                return

            m_chunks = re.fullmatch(r"/api/documents/([^/]+)/chunks", path)
            if m_chunks:
                doc_id = urllib.parse.unquote(m_chunks.group(1))
                with DB_LOCK:
                    rows = [
                        dict(r)
                        for r in get_db()
                        .execute("SELECT * FROM document_chunks WHERE document_id = ? ORDER BY chunk_index ASC", (doc_id,))
                        .fetchall()
                    ]
                self._send_json(200, rows)
                return

            if path == "/api/cv":
                with DB_LOCK:
                    conn = get_db()
                    gk = SecurityGatekeeper(conn)
                    cv_mgr = CVManager(conn, gk)
                    profile = dict(conn.execute("SELECT * FROM cv_profiles WHERE id = 'remy-primary-cv'").fetchone())
                    versions = cv_mgr.list_versions()
                    external_allowed = gk.is_permission_granted("cv.external_ai")
                self._send_json(200, {"profile": profile, "versions": versions, "externalAllowed": external_allowed})
                return

            if path == "/api/memories":
                with DB_LOCK:
                    conn = get_db()
                    mv = MemoryVault(conn, SecurityGatekeeper(conn))
                    self._send_json(200, {"memories": mv.list_memories(), "memoryEnabled": mv.is_memory_enabled()})
                return

            if path == "/api/productivity":
                with DB_LOCK:
                    conn = get_db()
                    prod = ProductivityService(conn)
                    projects = [dict(r) for r in conn.execute("SELECT * FROM projects ORDER BY created_at DESC").fetchall()]
                    tasks = prod.list_tasks()
                    notes = prod.list_notes()
                    reminders = prod.list_reminders()
                self._send_json(200, {"projects": projects, "tasks": tasks, "notes": notes, "reminders": reminders})
                return

            if path == "/api/productivity/weather":
                city = (query.get("city") or ["Kigali"])[0] or "Kigali"
                try:
                    self._send_json(200, _fetch_open_meteo_weather(city))
                except Exception as exc:
                    self._send_json(502, {"error": str(exc)})
                return

            if path == "/api/productivity/currency":
                base = (query.get("base") or ["USD"])[0] or "USD"
                try:
                    self._send_json(200, _fetch_currency_rates(base))
                except Exception as exc:
                    self._send_json(502, {"error": str(exc)})
                return

            if path == "/api/system/telemetry":
                with DB_LOCK:
                    tel = _collect_web_telemetry(get_db())
                self._send_json(200, tel)
                return

            if path == "/api/security/overview":
                with DB_LOCK:
                    conn = get_db()
                    permissions = [dict(r) for r in conn.execute("SELECT * FROM permissions ORDER BY id").fetchall()]
                    folders = [dict(r) for r in conn.execute("SELECT * FROM approved_folders ORDER BY added_at DESC").fetchall()]
                    apps = [dict(r) for r in conn.execute("SELECT * FROM approved_apps ORDER BY added_at DESC").fetchall()]
                    audit_logs = [dict(r) for r in conn.execute("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 60").fetchall()]
                backups = []
                if BACKUPS_DIR.exists():
                    backups = [
                        {"filename": p.name, "sizeBytes": p.stat().st_size}
                        for p in sorted(BACKUPS_DIR.iterdir(), reverse=True)
                        if p.is_file()
                    ]
                self._send_json(
                    200,
                    {
                        "permissions": permissions,
                        "folders": folders,
                        "apps": apps,
                        "auditLogs": audit_logs,
                        "backups": backups,
                    },
                )
                return

            if path == "/api/plugins":
                with DB_LOCK:
                    rows = [dict(r) for r in get_db().execute("SELECT * FROM plugin_registry ORDER BY id ASC").fetchall()]
                self._send_json(200, rows)
                return

            if path == "/api/export/windows-python-bundle":
                with DB_LOCK:
                    conn = get_db()
                    gk = SecurityGatekeeper(conn)
                    if not gk.is_permission_granted("workspace.export"):
                        self._send_json(403, {"error": "Workspace export permission is disabled in Security Center."})
                        return
                    zip_bytes = _build_python_bundle_zip()
                    gk.log_audit("python_bundle_exported", "user", "REMY-THE-GRIVER-PRO-Windows-Desktop.zip", "allowed", f"{len(zip_bytes)} bytes")
                self._send_bytes(
                    200,
                    "application/zip",
                    zip_bytes,
                    {"Content-Disposition": 'attachment; filename="REMY-THE-GRIVER-PRO-Windows-Desktop.zip"'},
                )
                return

            if not path.startswith("/api/") and self._serve_static_dist(path):
                return

            self._send_json(404, {"error": f"Endpoint not found: {path}"})
        except Exception as exc:
            LOGGER.exception("GET %s error: %s", path, exc)
            self._send_json(500, {"error": str(exc)})

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        try:
            if path == "/api/conversations":
                body = self._read_json()
                conv_id = f"conv-{uuid.uuid4().hex[:8]}"
                raw_title = str(body.get("title") or "").strip()
                title = raw_title[:120] if raw_title else "New Session"
                agent_id = str(body.get("agentId") or "auto")
                model = sanitize_model_name(body.get("model"))
                language = str(body.get("language") or "en")
                with DB_LOCK:
                    conn = get_db()
                    conn.execute(
                        "INSERT INTO conversations (id, title, agent_id, model, language) VALUES (?, ?, ?, ?, ?)",
                        (conv_id, title, agent_id, model, language),
                    )
                    conn.commit()
                    created = dict(conn.execute("SELECT * FROM conversations WHERE id = ?", (conv_id,)).fetchone())
                self._send_json(200, created)
                return

            if path == "/api/chat/stream":
                self._handle_chat_stream()
                return

            if path in ("/api/studio/run-python", "/api/studio/run-vm"):
                body = self._read_json()
                code = str(body.get("code") or "")
                if not code.strip():
                    self._send_json(400, {"error": "Code is required"})
                    return
                with DB_LOCK:
                    conn = get_db()
                    result = _run_python_sandbox_for_studio(conn, SecurityGatekeeper(conn), code)
                self._send_json(200, result)
                return

            if path == "/api/studio/analyze-github":
                body = self._read_json()
                repo_url = str(body.get("repoUrl") or "")
                with DB_LOCK:
                    conn = get_db()
                    gk = SecurityGatekeeper(conn)
                    try:
                        data = _analyze_github_repository(gk, repo_url)
                    except (SecurityViolationError, ValueError, RuntimeError) as exc:
                        self._send_json(400, {"error": str(exc)})
                        return
                self._send_json(200, data)
                return

            if path == "/api/studio/ai-assist":
                body = self._read_json()
                task = str(body.get("task") or "")
                code = str(body.get("code") or "")
                language = str(body.get("language") or "Python 3.11+")
                model = sanitize_model_name(body.get("model"))
                with DB_LOCK:
                    conn = get_db()
                    if _is_setting_enabled(conn, "strict_local_mode"):
                        SecurityGatekeeper(conn).log_audit("strict_local_blocked", "security_gatekeeper", "studio.ai_assist", "denied", "Strict Local Mode")
                        self._send_json(403, {"error": "Strict Local-Only Privacy Mode is active. Use the isolated local Python runner or disable Strict Local Mode in Settings."})
                        return
                ai = HybridAIEngine()
                try:
                    resp = ai.generate_text(
                        [
                            {
                                "role": "system",
                                "content": "You are the Software Engineering Agent in REMY THE GRIVER PRO. Write clean, idiomatic Python 3.11+ code by default unless another language is explicitly requested. Provide crisp, production-ready code, explanations, SQL schemas, READMEs, or pytest/unittest suites in Markdown.",
                            },
                            {
                                "role": "user",
                                "content": f"Task: {task}\nTarget Language/Stack: {language}\n\nInput Code / Context:\n{code}",
                            },
                        ],
                        model=model,
                        timeout_sec=20.0,
                    )
                    self._send_json(200, {"result": resp.text, "provider": resp.provider, "model": resp.model})
                except Exception as exc:
                    self._send_json(503, {"error": format_ai_error_message(exc)})
                return

            if path == "/api/media/generate-image":
                body = self._read_json()
                prompt = str(body.get("prompt") or "").strip()
                aspect_ratio = str(body.get("aspectRatio") or "1:1")
                if not prompt:
                    self._send_json(400, {"error": "Image prompt is required."})
                    return
                with DB_LOCK:
                    conn = get_db()
                    studio = PythonMediaStudio(conn, SecurityGatekeeper(conn))
                    try:
                        res = studio.generate_image(prompt, aspect_ratio=aspect_ratio)
                    except ValueError as exc:
                        self._send_json(400, {"error": str(exc)})
                        return
                    except Exception as exc:
                        msg = format_ai_error_message(exc)
                        code = 403 if "Strict Local" in msg else 503
                        self._send_json(code, {"error": msg})
                        return
                b64 = base64.b64encode(res.output_path.read_bytes()).decode("ascii")
                self._send_json(
                    200,
                    {
                        "model": res.model,
                        "aspectRatio": res.aspect_ratio,
                        "mimeType": res.mime_type,
                        "imageDataUrl": f"data:{res.mime_type};base64,{b64}",
                        "textNote": res.text_note,
                    },
                )
                return

            if path == "/api/media/generate-video":
                body = self._read_json()
                prompt = str(body.get("prompt") or "").strip()
                aspect_ratio = str(body.get("aspectRatio") or "16:9")
                duration = str(body.get("duration") or "8s")
                resolution = str(body.get("resolution") or "720p")
                if not prompt:
                    self._send_json(400, {"error": "Video prompt is required."})
                    return
                with DB_LOCK:
                    conn = get_db()
                    studio = PythonMediaStudio(conn, SecurityGatekeeper(conn))
                    try:
                        res = studio.generate_video(prompt, aspect_ratio=aspect_ratio, duration=duration, resolution=resolution)
                    except ValueError as exc:
                        self._send_json(400, {"error": str(exc)})
                        return
                    except Exception as exc:
                        msg = format_ai_error_message(exc)
                        code = 403 if "Strict Local" in msg else 503
                        self._send_json(code, {"error": msg})
                        return
                b64 = base64.b64encode(res.output_path.read_bytes()).decode("ascii")
                self._send_json(
                    200,
                    {
                        "model": res.model,
                        "aspectRatio": res.aspect_ratio,
                        "duration": duration,
                        "resolution": resolution,
                        "mimeType": res.mime_type,
                        "videoDataUrl": f"data:{res.mime_type};base64,{b64}",
                    },
                )
                return

            if path == "/api/documents/upload":
                ctype = self.headers.get("Content-Type", "")
                raw_body = self._read_body()
                parsed_file = _parse_multipart_file(ctype, raw_body)
                if not parsed_file:
                    self._send_json(400, {"error": "No file uploaded"})
                    return
                filename, _, file_bytes = parsed_file
                safe_name = sanitize_filename(filename)
                DOCUMENTS_DIR.mkdir(parents=True, exist_ok=True)
                tmp_path = DOCUMENTS_DIR / f".upload_{uuid.uuid4().hex[:6]}_{safe_name}"
                try:
                    tmp_path.write_bytes(file_bytes)
                    with DB_LOCK:
                        conn = get_db()
                        rag = LocalRAGEngine(conn, SecurityGatekeeper(conn))
                        doc = rag.ingest_file(tmp_path)
                        # Ensure filename matches original sanitized filename cleanly
                        conn.execute("UPDATE documents SET filename = ? WHERE id = ?", (safe_name, doc["id"]))
                        conn.commit()
                        doc = rag.get_document(doc["id"])
                    doc["chunkCount"] = len(doc.get("chunks", []))
                    self._send_json(200, doc)
                except Exception as exc:
                    self._send_json(500, {"error": str(exc)})
                finally:
                    tmp_path.unlink(missing_ok=True)
                return

            if path == "/api/documents/search":
                body = self._read_json()
                query_text = str(body.get("query") or "").strip()
                doc_id = body.get("documentId")
                if not query_text:
                    self._send_json(400, {"error": "Search query required"})
                    return
                with DB_LOCK:
                    conn = get_db()
                    rag = LocalRAGEngine(conn, SecurityGatekeeper(conn))
                    hits = rag.search_chunks(query_text, limit=12)
                if doc_id:
                    hits = [h for h in hits if h["document_id"] == doc_id]
                results = [
                    {
                        "chunkId": h["chunk_id"],
                        "filename": h["filename"],
                        "pageOrRow": h["page_or_row"],
                        "content": h["excerpt"],
                        "score": h["score"],
                    }
                    for h in hits[:6]
                ]
                self._send_json(200, {"results": results})
                return

            if path == "/api/documents/ask":
                body = self._read_json()
                question = str(body.get("question") or "").strip()
                doc_id = body.get("documentId")
                model = sanitize_model_name(body.get("model"))
                if not question:
                    self._send_json(400, {"error": "Question is required"})
                    return
                with DB_LOCK:
                    conn = get_db()
                    gk = SecurityGatekeeper(conn)
                    rag = LocalRAGEngine(conn, gk)
                    hits = rag.search_chunks(question, limit=12)
                    if doc_id:
                        hits = [h for h in hits if h["document_id"] == doc_id]
                    hits = hits[:5]
                    if not hits:
                        self._send_json(
                            200,
                            {
                                "answer": "No matching indexed document chunks were found locally for that query. Upload a document or refine your keywords.",
                                "citations": [],
                            },
                        )
                        return
                    if _is_setting_enabled(conn, "strict_local_mode"):
                        gk.log_audit("strict_local_blocked", "security_gatekeeper", "documents.ask", "denied", "Strict Local Mode")
                        self._send_json(
                            403,
                            {"error": "Strict Local-Only Privacy Mode is active. Use Local Offline Search on the left to query chunks without external AI."},
                        )
                        return

                context = "\n\n---\n\n".join(f"[Source: {c['filename']} | {c['page_or_row']}]\n{c['excerpt']}" for c in hits)
                ai = HybridAIEngine()
                try:
                    resp = ai.generate_text(
                        [
                            {
                                "role": "system",
                                "content": "Answer strictly based on the provided document excerpts. Cite each claim using [Source: filename | pageOrRow]. If the excerpts lack the answer, state that clearly.",
                            },
                            {"role": "user", "content": f"Document Context:\n{context}\n\nQuestion: {question}"},
                        ],
                        model=model,
                        timeout_sec=20.0,
                    )
                    self._send_json(
                        200,
                        {
                            "answer": resp.text,
                            "citations": [
                                {
                                    "filename": c["filename"],
                                    "pageOrRow": c["page_or_row"],
                                    "score": c["score"],
                                    "excerpt": c["excerpt"][:200],
                                }
                                for c in hits
                            ],
                        },
                    )
                except Exception as exc:
                    self._send_json(503, {"error": format_ai_error_message(exc)})
                return

            if path == "/api/cv/versions":
                body = self._read_json()
                label = str(body.get("versionLabel") or "").strip()
                target_role = str(body.get("targetRole") or "").strip()
                raw_text = str(body.get("rawText") or "").strip()
                notes = str(body.get("notes") or "").strip()
                if not label or not raw_text:
                    self._send_json(400, {"error": "Version label and CV content are required"})
                    return
                with DB_LOCK:
                    conn = get_db()
                    cv_mgr = CVManager(conn, SecurityGatekeeper(conn))
                    created = cv_mgr.create_version(label, target_role, raw_text, notes)
                self._send_json(200, created)
                return

            if path == "/api/cv/upload":
                ctype = self.headers.get("Content-Type", "")
                raw_body = self._read_body()
                parsed_file = _parse_multipart_file(ctype, raw_body)
                if not parsed_file:
                    self._send_json(400, {"error": "No CV file provided"})
                    return
                filename, _, file_bytes = parsed_file
                safe_name = sanitize_filename(filename)
                CV_DIR.mkdir(parents=True, exist_ok=True)
                tmp_path = CV_DIR / f".cv_{uuid.uuid4().hex[:6]}_{safe_name}"
                try:
                    tmp_path.write_bytes(file_bytes)
                    extracted = extract_cv_text(tmp_path)
                    with DB_LOCK:
                        conn = get_db()
                        gk = SecurityGatekeeper(conn)
                        cv_mgr = CVManager(conn, gk)
                        ver = cv_mgr.create_version(f"Imported: {safe_name}", "Uploaded Document", extracted, "Parsed locally in Python")
                        gk.log_audit("cv_file_parsed_locally", "user", safe_name, "allowed", "Parsed locally without external transmission")
                    self._send_json(200, {"id": ver["id"], "filename": safe_name, "rawText": extracted})
                except Exception as exc:
                    self._send_json(500, {"error": str(exc)})
                finally:
                    tmp_path.unlink(missing_ok=True)
                return

            if path == "/api/cv/compare-local":
                body = self._read_json()
                jd = str(body.get("jobDescription") or "")
                with DB_LOCK:
                    conn = get_db()
                    cv_mgr = CVManager(conn, SecurityGatekeeper(conn))
                    res = cv_mgr.compare_with_job_description(jd)
                    profile = cv_mgr.get_primary_cv()
                unused = [s for s in profile["skills"] if s not in res.matched_skills]
                self._send_json(
                    200,
                    {
                        "mode": "local_private_analysis",
                        "matchScorePercent": res.match_percent,
                        "matchedSkills": res.matched_skills,
                        "jdKeywordsFound": res.matched_skills + res.missing_keywords,
                        "gapsInCv": res.missing_keywords,
                        "unusedCvSkills": unused,
                    },
                )
                return

            if path == "/api/cv/ai-coach":
                body = self._read_json()
                mode = str(body.get("mode") or "optimize")
                jd = str(body.get("jobDescription") or "")
                model = sanitize_model_name(body.get("model"))
                with DB_LOCK:
                    conn = get_db()
                    cv_mgr = CVManager(conn, SecurityGatekeeper(conn))
                    try:
                        msgs = cv_mgr.build_career_action_prompt(
                            "interview_questions" if mode == "interview" else mode,
                            jd,
                        )
                    except SecurityViolationError as exc:
                        self._send_json(403, {"error": str(exc)})
                        return
                ai = HybridAIEngine()
                try:
                    resp = ai.generate_text(msgs, model=model, timeout_sec=20.0)
                    self._send_json(200, {"result": resp.text})
                except Exception as exc:
                    self._send_json(503, {"error": format_ai_error_message(exc)})
                return

            if path == "/api/memories":
                body = self._read_json()
                title = str(body.get("title") or "").strip()
                content = str(body.get("content") or "").strip()
                category = str(body.get("category") or "general").strip()
                approved = bool(body.get("approved", 1))
                if not title or not content:
                    self._send_json(400, {"error": "Title and content are required"})
                    return
                with DB_LOCK:
                    conn = get_db()
                    mv = MemoryVault(conn, SecurityGatekeeper(conn))
                    created = mv.add_memory(title, content, category=category, approved=approved)
                self._send_json(200, created)
                return

            if path == "/api/memories/toggle-global":
                body = self._read_json()
                enabled = bool(body.get("enabled"))
                with DB_LOCK:
                    conn = get_db()
                    mv = MemoryVault(conn, SecurityGatekeeper(conn))
                    mv.set_memory_enabled(enabled)
                self._send_json(200, {"ok": True, "memoryEnabled": enabled})
                return

            if path == "/api/productivity/tasks":
                body = self._read_json()
                title = str(body.get("title") or "").strip()
                if not title:
                    self._send_json(400, {"error": "Task title is required"})
                    return
                description = str(body.get("description") or "")
                priority = str(body.get("priority") or "medium")
                project_id = body.get("projectId")
                due_date = body.get("dueDate")
                with DB_LOCK:
                    conn = get_db()
                    task_id = f"task-{uuid.uuid4().hex[:8]}"
                    conn.execute(
                        "INSERT INTO tasks (id, project_id, title, description, priority, status, due_date) VALUES (?, ?, ?, ?, ?, 'todo', ?)",
                        (task_id, project_id, title, description, priority if priority in ("low", "medium", "high") else "medium", due_date),
                    )
                    conn.commit()
                    created = dict(conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone())
                self._send_json(200, created)
                return

            if path == "/api/productivity/notes":
                body = self._read_json()
                title = str(body.get("title") or "").strip()
                content = str(body.get("content") or "").strip()
                category = str(body.get("category") or "general")
                if not title or not content:
                    self._send_json(400, {"error": "Note title and content are required"})
                    return
                with DB_LOCK:
                    conn = get_db()
                    created = ProductivityService(conn).create_note(title, content, category)
                self._send_json(200, created)
                return

            if path == "/api/productivity/reminders":
                body = self._read_json()
                title = str(body.get("title") or "").strip()
                remind_at = str(body.get("remindAt") or "").strip()
                if not title or not remind_at:
                    self._send_json(400, {"error": "Reminder title and date/time are required"})
                    return
                with DB_LOCK:
                    conn = get_db()
                    created = ProductivityService(conn).create_reminder(title, remind_at)
                self._send_json(200, created)
                return

            if path == "/api/research/search":
                body = self._read_json()
                query_text = str(body.get("query") or "").strip()
                model = sanitize_model_name(body.get("model"))
                if not query_text:
                    self._send_json(400, {"error": "Research query is required"})
                    return
                with DB_LOCK:
                    conn = get_db()
                    gk = SecurityGatekeeper(conn)
                    if not gk.is_permission_granted("research.web_search"):
                        gk.log_audit("web_search_blocked", "security_gatekeeper", query_text, "denied", "Permission disabled")
                        self._send_json(403, {"error": "Web Search is disabled in Security Center permissions."})
                        return
                    if _is_setting_enabled(conn, "strict_local_mode"):
                        gk.log_audit("strict_local_blocked", "security_gatekeeper", "research.search", "denied", "Strict Local Mode")
                        self._send_json(403, {"error": "Strict Local-Only Privacy Mode is active. Outbound Web Research is blocked."})
                        return

                ai = HybridAIEngine()
                sources: list[dict[str, str]] = []
                summary = ""
                try:
                    if ai.check_gemini_cloud().available:
                        resp = ai.generate_text(
                            [
                                {
                                    "role": "system",
                                    "content": 'You are the Research Agent for REMY THE GRIVER PRO. Provide structured findings separated clearly into "Verified Sourced Facts" and "Analytical Synthesis". Never fabricate URLs or unverified claims.',
                                },
                                {"role": "user", "content": query_text},
                            ],
                            model=model if model.startswith("gemini-") else "gemini-4-hydrogen",
                            timeout_sec=20.0,
                            use_google_search=True,
                        )
                        summary = resp.text
                        with DB_LOCK:
                            gk = SecurityGatekeeper(get_db())
                            for s in resp.sources or []:
                                try:
                                    gk.validate_safe_url(s["uri"])
                                    sources.append(s)
                                except SecurityViolationError:
                                    continue
                    else:
                        with DB_LOCK:
                            conn = get_db()
                            client = WebResearchClient(conn, SecurityGatekeeper(conn))
                            wiki = client.search_wikipedia_and_ddg(query_text, limit=5)
                        sources = [{"title": s["title"], "uri": s["url"]} for s in wiki["verified_sources"]]
                        summary = "### Verified Sourced Facts\n\n" + "\n".join(
                            f"- **{s['title']}**: {s['snippet']} ({s['url']})" for s in wiki["verified_sources"]
                        )
                        if ai.check_openai_responses().available:
                            synth = ai.generate_text(
                                [
                                    {"role": "system", "content": "Synthesize strictly from the provided verified Wikipedia excerpts."},
                                    {"role": "user", "content": f"Query: {query_text}\n\nSources:\n{summary}"},
                                ],
                                model="gpt-4o-mini",
                                timeout_sec=15.0,
                            )
                            summary = synth.text
                    self._send_json(200, {"query": query_text, "summary": summary, "sources": sources})
                except Exception as exc:
                    self._send_json(503, {"error": format_ai_error_message(exc)})
                return

            if path == "/api/system/ollama-probe":
                body = self._read_json()
                endpoint = str(body.get("endpoint") or "http://127.0.0.1:11434").strip().rstrip("/")
                from dataclasses import replace

                cfg = replace(HybridAIEngine().config, ollama_base_url=endpoint)
                st = HybridAIEngine(cfg).check_ollama(timeout_sec=1.5)
                self._send_json(
                    200,
                    {
                        "available": st.available,
                        "endpoint": endpoint,
                        "models": st.models,
                        "error": None if st.available else st.details,
                    },
                )
                return

            if path == "/api/security/folders":
                body = self._read_json()
                folder_path = str(body.get("folderPath") or "").strip()
                access_level = str(body.get("accessLevel") or "read")
                if not folder_path:
                    self._send_json(400, {"error": "Folder path is required"})
                    return
                fld_id = f"fld-{uuid.uuid4().hex[:8]}"
                with DB_LOCK:
                    conn = get_db()
                    conn.execute("INSERT INTO approved_folders (id, folder_path, access_level) VALUES (?, ?, ?)", (fld_id, folder_path, access_level))
                    conn.commit()
                    SecurityGatekeeper(conn).log_audit("folder_approved", "user", folder_path, "allowed", f"Access: {access_level}")
                    created = dict(conn.execute("SELECT * FROM approved_folders WHERE id = ?", (fld_id,)).fetchone())
                self._send_json(200, created)
                return

            if path == "/api/security/apps":
                body = self._read_json()
                app_name = str(body.get("appName") or "").strip()
                exe_path = str(body.get("executablePath") or "").strip()
                if not app_name or not exe_path:
                    self._send_json(400, {"error": "Application name and path are required"})
                    return
                app_id = f"app-{uuid.uuid4().hex[:8]}"
                with DB_LOCK:
                    conn = get_db()
                    conn.execute("INSERT INTO approved_apps (id, app_name, executable_path, allowed) VALUES (?, ?, ?, 1)", (app_id, app_name, exe_path))
                    conn.commit()
                    SecurityGatekeeper(conn).log_audit("app_approved", "user", app_name, "allowed", exe_path)
                    created = dict(conn.execute("SELECT * FROM approved_apps WHERE id = ?", (app_id,)).fetchone())
                self._send_json(200, created)
                return

            if path == "/api/security/backup":
                with DB_LOCK:
                    conn = get_db()
                    dest = create_backup(conn, BACKUPS_DIR)
                    size_bytes = dest.stat().st_size
                    SecurityGatekeeper(conn).log_audit("sqlite_backup_created", "user", dest.name, "allowed", f"{size_bytes} bytes")
                self._send_json(200, {"filename": dest.name, "path": str(dest), "sizeBytes": size_bytes})
                return

            if path == "/api/security/mask-test":
                body = self._read_json()
                sample = str(body.get("sample") or "")
                self._send_json(200, {"masked": mask_secrets(sample)})
                return

            m_plug_run = re.fullmatch(r"/api/plugins/([^/]+)/run", path)
            if m_plug_run:
                plug_id = urllib.parse.unquote(m_plug_run.group(1))
                body = self._read_json()
                with DB_LOCK:
                    conn = get_db()
                    gk = SecurityGatekeeper(conn)
                    row = conn.execute("SELECT * FROM plugin_registry WHERE id = ?", (plug_id,)).fetchone()
                    if not row:
                        self._send_json(404, {"error": "Plugin not found"})
                        return
                    if not row["enabled"] or not row["approved"] or not gk.is_permission_granted("plugins.execute"):
                        gk.log_audit("plugin_exec_blocked", "security_gatekeeper", row["name"], "denied", "Disabled or permission revoked")
                        self._send_json(403, {"error": "Plugin execution denied: plugin must be approved, enabled, and plugins.execute granted."})
                        return
                try:
                    output = ""
                    if plug_id == "plug-kigali-brief":
                        weather = _fetch_open_meteo_weather("Kigali")
                        with DB_LOCK:
                            open_tasks = get_db().execute("SELECT title, priority FROM tasks WHERE status != 'done' LIMIT 5").fetchall()
                        task_lines = "\n".join(f"- [{t['priority']}] {t['title']}" for t in open_tasks)
                        output = f"Kigali Weather: {weather['temperatureC']}°C ({weather['condition']}), Humidity {weather['humidityPercent']}%.\nOpen Tasks ({len(open_tasks)}):\n{task_lines}"
                    elif plug_id == "plug-code-complexity":
                        code_in = str(body.get("input") or "def sample(x):\n    return x if x > 0 else 0\n")
                        with DB_LOCK:
                            analysis = DevStudioEngine(get_db(), SecurityGatekeeper(get_db())).analyze_python_code(code_in)
                        output = (
                            f"Lines of Code: {len(code_in.splitlines())}\n"
                            f"Functions: {analysis['functions']}\n"
                            f"Warnings: {analysis.get('warnings', [])}\n"
                            "Status: Isolated Python AST inspection complete."
                        )
                    else:
                        with DB_LOCK:
                            profile = CVManager(get_db(), SecurityGatekeeper(get_db())).get_primary_cv()
                        skills = profile["skills"]
                        output = f"Local CV Keyword Audit: {len(skills)} verified technical skill areas indexed locally ({', '.join(skills[:6])}...)."

                    with DB_LOCK:
                        conn = get_db()
                        conn.execute("UPDATE plugin_registry SET last_run = datetime('now'), last_status = 'success' WHERE id = ?", (plug_id,))
                        conn.commit()
                        SecurityGatekeeper(conn).log_audit("plugin_executed", "plugin_host", row["name"], "allowed", "Isolated Python plugin succeeded")
                    self._send_json(200, {"ok": True, "output": output})
                except Exception as exc:
                    with DB_LOCK:
                        get_db().execute("UPDATE plugin_registry SET last_run = datetime('now'), last_status = 'error' WHERE id = ?", (plug_id,))
                        get_db().commit()
                    self._send_json(500, {"error": str(exc)})
                return

            self._send_json(404, {"error": f"Endpoint not found: {path}"})
        except Exception as exc:
            LOGGER.exception("POST %s error: %s", path, exc)
            self._send_json(500, {"error": str(exc)})

    def do_PATCH(self) -> None:
        path = urllib.parse.urlparse(self.path).path
        try:
            body = self._read_json()

            if path == "/api/settings":
                with DB_LOCK:
                    conn = get_db()
                    for k, v in body.items():
                        if isinstance(v, str):
                            conn.execute(
                                "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))",
                                (k, v),
                            )
                    conn.commit()
                self._send_json(200, {"ok": True})
                return

            m_save = re.fullmatch(r"/api/conversations/([^/]+)/save", path)
            if m_save:
                conv_id = urllib.parse.unquote(m_save.group(1))
                saved = 1 if body.get("saved") else 0
                with DB_LOCK:
                    conn = get_db()
                    conn.execute("UPDATE conversations SET saved = ?, updated_at = datetime('now') WHERE id = ?", (saved, conv_id))
                    conn.commit()
                self._send_json(200, {"ok": True, "saved": bool(saved)})
                return

            if path == "/api/cv/privacy":
                allow_external = bool(body.get("allowExternal"))
                with DB_LOCK:
                    conn = get_db()
                    gk = SecurityGatekeeper(conn)
                    gk.set_permission("cv.external_ai", allow_external, actor="user")
                self._send_json(200, {"ok": True, "externalAllowed": allow_external})
                return

            m_mem = re.fullmatch(r"/api/memories/([^/]+)", path)
            if m_mem:
                mem_id = urllib.parse.unquote(m_mem.group(1))
                with DB_LOCK:
                    conn = get_db()
                    mv = MemoryVault(conn, SecurityGatekeeper(conn))
                    try:
                        updated = mv.update_memory(
                            mem_id,
                            title=body.get("title"),
                            content=body.get("content"),
                            approved=bool(body["approved"]) if "approved" in body else None,
                            enabled=bool(body["enabled"]) if "enabled" in body else None,
                        )
                    except LookupError:
                        self._send_json(404, {"error": "Memory not found"})
                        return
                self._send_json(200, updated)
                return

            m_task = re.fullmatch(r"/api/productivity/tasks/([^/]+)", path)
            if m_task:
                task_id = urllib.parse.unquote(m_task.group(1))
                with DB_LOCK:
                    conn = get_db()
                    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
                    if not row:
                        self._send_json(404, {"error": "Task not found"})
                        return
                    status = body.get("status") or row["status"]
                    priority = body.get("priority") or row["priority"]
                    title = body.get("title") or row["title"]
                    conn.execute("UPDATE tasks SET status = ?, priority = ?, title = ? WHERE id = ?", (status, priority, title, task_id))
                    conn.commit()
                    updated = dict(conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone())
                self._send_json(200, updated)
                return

            m_rem = re.fullmatch(r"/api/productivity/reminders/([^/]+)", path)
            if m_rem:
                rem_id = urllib.parse.unquote(m_rem.group(1))
                with DB_LOCK:
                    conn = get_db()
                    ProductivityService(conn).toggle_reminder(rem_id, bool(body.get("completed")))
                self._send_json(200, {"ok": True})
                return

            m_perm = re.fullmatch(r"/api/security/permissions/([^/]+)", path)
            if m_perm:
                scope = urllib.parse.unquote(m_perm.group(1))
                granted = bool(body.get("granted"))
                with DB_LOCK:
                    conn = get_db()
                    SecurityGatekeeper(conn).set_permission(scope, granted, actor="user")
                self._send_json(200, {"ok": True, "granted": granted})
                return

            m_plug = re.fullmatch(r"/api/plugins/([^/]+)/toggle", path)
            if m_plug:
                plug_id = urllib.parse.unquote(m_plug.group(1))
                enabled = bool(body.get("enabled"))
                approved = bool(body["approved"]) if "approved" in body else enabled
                with DB_LOCK:
                    conn = get_db()
                    pm = PluginManager(conn, SecurityGatekeeper(conn))
                    pm.set_plugin_state(plug_id, enabled=enabled, approved=approved)
                    row = dict(conn.execute("SELECT * FROM plugin_registry WHERE id = ?", (plug_id,)).fetchone())
                self._send_json(200, row)
                return

            self._send_json(404, {"error": f"Endpoint not found: {path}"})
        except Exception as exc:
            LOGGER.exception("PATCH %s error: %s", path, exc)
            self._send_json(500, {"error": str(exc)})

    def do_DELETE(self) -> None:
        path = urllib.parse.urlparse(self.path).path
        try:
            with DB_LOCK:
                conn = get_db()
                gk = SecurityGatekeeper(conn)

                if m := re.fullmatch(r"/api/conversations/([^/]+)", path):
                    conv_id = urllib.parse.unquote(m.group(1))
                    conn.execute("DELETE FROM conversations WHERE id = ?", (conv_id,))
                    conn.commit()
                    self._send_json(200, {"ok": True})
                    return

                if m := re.fullmatch(r"/api/documents/([^/]+)", path):
                    doc_id = urllib.parse.unquote(m.group(1))
                    LocalRAGEngine(conn, gk).delete_document(doc_id)
                    gk.log_audit("document_deleted", "user", doc_id, "info", "Removed document and chunks")
                    self._send_json(200, {"ok": True})
                    return

                if m := re.fullmatch(r"/api/memories/([^/]+)", path):
                    MemoryVault(conn, gk).delete_memory(urllib.parse.unquote(m.group(1)))
                    self._send_json(200, {"ok": True})
                    return

                if m := re.fullmatch(r"/api/productivity/tasks/([^/]+)", path):
                    ProductivityService(conn).delete_task(urllib.parse.unquote(m.group(1)))
                    self._send_json(200, {"ok": True})
                    return

                if m := re.fullmatch(r"/api/productivity/notes/([^/]+)", path):
                    ProductivityService(conn).delete_note(urllib.parse.unquote(m.group(1)))
                    self._send_json(200, {"ok": True})
                    return

                if m := re.fullmatch(r"/api/productivity/reminders/([^/]+)", path):
                    conn.execute("DELETE FROM reminders WHERE id = ?", (urllib.parse.unquote(m.group(1)),))
                    conn.commit()
                    self._send_json(200, {"ok": True})
                    return

                if m := re.fullmatch(r"/api/security/folders/([^/]+)", path):
                    fid = urllib.parse.unquote(m.group(1))
                    conn.execute("DELETE FROM approved_folders WHERE id = ?", (fid,))
                    conn.commit()
                    gk.log_audit("folder_revoked", "user", fid, "info", "Removed approved folder")
                    self._send_json(200, {"ok": True})
                    return

                if m := re.fullmatch(r"/api/security/apps/([^/]+)", path):
                    aid = urllib.parse.unquote(m.group(1))
                    conn.execute("DELETE FROM approved_apps WHERE id = ?", (aid,))
                    conn.commit()
                    gk.log_audit("app_revoked", "user", aid, "info", "Removed approved application")
                    self._send_json(200, {"ok": True})
                    return

            self._send_json(404, {"error": f"Endpoint not found: {path}"})
        except Exception as exc:
            LOGGER.exception("DELETE %s error: %s", path, exc)
            self._send_json(500, {"error": str(exc)})

    def _handle_chat_stream(self) -> None:
        body = self._read_json()
        prompt = str(body.get("prompt") or "").strip()
        if not prompt:
            self._send_json(400, {"error": "Prompt text is required."})
            return

        conv_id = body.get("conversationId")
        agent_id = str(body.get("agentId") or "auto")
        selected_model = sanitize_model_name(body.get("model"))
        language = str(body.get("language") or "en")
        include_memory = bool(body.get("includeMemory", True))
        include_cv = bool(body.get("includeCv", False))
        attached_doc_ids = body.get("attachedDocumentIds") or []
        replace_last_pair = bool(body.get("replaceLastPair", False))

        with DB_LOCK:
            conn = get_db()
            gk = SecurityGatekeeper(conn)
            mv = MemoryVault(conn, gk)
            rag = LocalRAGEngine(conn, gk)
            cv_mgr = CVManager(conn, gk)
            orch = AgentOrchestrator(gk)

            if not conv_id:
                conv_id = f"conv-{uuid.uuid4().hex[:8]}"
                auto_title = prompt[:64] + ("..." if len(prompt) > 64 else "")
                conn.execute(
                    "INSERT INTO conversations (id, title, agent_id, model, language) VALUES (?, ?, ?, ?, ?)",
                    (conv_id, auto_title, agent_id, selected_model, language),
                )
            else:
                existing = conn.execute("SELECT id, title FROM conversations WHERE id = ?", (conv_id,)).fetchone()
                auto_title = prompt[:64] + ("..." if len(prompt) > 64 else "")
                if not existing:
                    conn.execute(
                        "INSERT INTO conversations (id, title, agent_id, model, language) VALUES (?, ?, ?, ?, ?)",
                        (conv_id, auto_title, agent_id, selected_model, language),
                    )
                elif existing["title"] == "New Session":
                    conn.execute("UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?", (auto_title, conv_id))

            if replace_last_pair:
                last_msgs = conn.execute(
                    "SELECT id FROM messages WHERE conversation_id = ? ORDER BY rowid DESC LIMIT 2", (conv_id,)
                ).fetchall()
                for m in last_msgs:
                    conn.execute("DELETE FROM messages WHERE id = ?", (m["id"],))

            user_msg_id = f"msg-{uuid.uuid4().hex[:8]}"
            conn.execute("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'user', ?)", (user_msg_id, conv_id, prompt))
            conn.commit()

            agent_profile, routing_reason = orch.route(prompt, agent_id)
            hide_private = _is_setting_enabled(conn, "hide_private_features")
            strict_local = _is_setting_enabled(conn, "strict_local_mode")

            bundle = build_global_chat_context(
                conn=conn,
                gatekeeper=gk,
                memory_vault=mv,
                rag_engine=rag,
                cv_manager=cv_mgr,
                conversation_id=conv_id,
                prompt=prompt,
                agent_system_prompt=agent_profile.system_prompt,
                language=language,
                include_memory=include_memory,
                include_cv=include_cv,
                hide_private=hide_private,
            )

            citations: list[dict[str, str]] = []
            if isinstance(attached_doc_ids, list) and attached_doc_ids:
                attached_hits = [h for h in rag.search_chunks(prompt, limit=12) if h["document_id"] in attached_doc_ids][:4]
                if attached_hits:
                    attached_txt = "\n".join(f"{h['citation']} {h['excerpt'][:450]}" for h in attached_hits)
                    bundle.messages[0]["content"] += f"\n\nATTACHED DOCUMENTS:\n{attached_txt}"
                    citations = [
                        {"filename": h["filename"], "pageOrRow": h["page_or_row"], "excerpt": h["excerpt"][:160]}
                        for h in attached_hits
                    ]
            if not citations and bundle.rag_hits:
                citations = [
                    {"filename": h["filename"], "pageOrRow": h["page_or_row"], "excerpt": h["excerpt"][:160]}
                    for h in bundle.rag_hits
                ]

        # Begin SSE response
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()

        def write_sse(event_name: str, payload: Any) -> bool:
            try:
                block = f"event: {event_name}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")
                self.wfile.write(block)
                self.wfile.flush()
                return True
            except OSError:
                return False

        write_sse(
            "meta",
            {
                "conversationId": conv_id,
                "userMessageId": user_msg_id,
                "agent": {"id": agent_profile.id, "name": agent_profile.name, "role": agent_profile.role},
                "routingReason": routing_reason,
                "model": selected_model,
                "cvBlockedByPolicy": bundle.cv_blocked_by_policy,
                "citations": citations,
            },
        )

        if strict_local:
            with DB_LOCK:
                conn = get_db()
                SecurityGatekeeper(conn).log_audit("strict_local_blocked", "security_gatekeeper", "chat_stream", "denied", "Strict Local Mode")
            local_reply = build_local_fallback_reply(
                prompt,
                agent_profile.name,
                bundle,
                "Strict Local-Only Privacy Mode is active. Delivered full local knowledge + verified workspace context.",
            )
            write_sse("chunk", {"text": local_reply})
            asst_id = f"msg-{uuid.uuid4().hex[:8]}"
            with DB_LOCK:
                conn = get_db()
                conn.execute(
                    "INSERT INTO messages (id, conversation_id, role, content, agent_id, model, tokens_used, citations_json) VALUES (?, ?, 'assistant', ?, ?, ?, 0, ?)",
                    (asst_id, conv_id, local_reply, agent_profile.id, "local-context-only", json.dumps(citations) if citations else None),
                )
                conn.commit()
            write_sse("done", {"assistantMessageId": asst_id, "tokensUsed": 0, "cancelled": False})
            return

        ai = HybridAIEngine()
        providers = ai.detect_providers()
        if not providers["cloud"].available and not providers["local"].available:
            local_reply = build_local_fallback_reply(
                prompt,
                agent_profile.name,
                bundle,
                "No cloud API key or local Ollama server configured. Delivered comprehensive Python local knowledge + workspace context.",
            )
            write_sse("chunk", {"text": local_reply})
            asst_id = f"msg-{uuid.uuid4().hex[:8]}"
            with DB_LOCK:
                conn = get_db()
                conn.execute(
                    "INSERT INTO messages (id, conversation_id, role, content, agent_id, model, tokens_used, citations_json) VALUES (?, ?, 'assistant', ?, ?, ?, 0, ?)",
                    (asst_id, conv_id, local_reply, agent_profile.id, "local-knowledge", json.dumps(citations) if citations else None),
                )
                conn.commit()
            write_sse("done", {"assistantMessageId": asst_id, "tokensUsed": 0, "cancelled": False})
            return

        event_q: queue.Queue[tuple[str, Any]] = queue.Queue()
        cancel_ev = threading.Event()
        has_live_chunk = threading.Event()
        fast_draft_sent = False

        def worker() -> None:
            try:
                res = ai.stream_chat(
                    messages=bundle.messages,
                    model=selected_model,
                    cancel_event=cancel_ev,
                    on_chunk=lambda txt: (has_live_chunk.set(), event_q.put(("chunk", txt))),
                    first_token_timeout_sec=16.0,
                )
                event_q.put(("finished", res))
            except Exception as exc:
                event_q.put(("failed", exc))

        t = threading.Thread(target=worker, daemon=True)
        t.start()

        deadline_draft = time.monotonic() + 1.45
        final_res = None
        final_err: Exception | None = None

        while True:
            timeout = 0.2
            if not fast_draft_sent and not has_live_chunk.is_set():
                timeout = max(0.05, min(0.25, deadline_draft - time.monotonic()))
            try:
                kind, val = event_q.get(timeout=timeout)
                if kind == "chunk":
                    replace_draft = fast_draft_sent
                    fast_draft_sent = False
                    if not write_sse("chunk", {"text": val, "replaceDraft": replace_draft}):
                        cancel_ev.set()
                        return
                elif kind == "finished":
                    final_res = val
                    break
                elif kind == "failed":
                    final_err = val
                    break
            except queue.Empty:
                if not fast_draft_sent and not has_live_chunk.is_set() and time.monotonic() >= deadline_draft:
                    fast_draft_sent = True
                    draft_txt = build_local_fallback_reply(
                        prompt,
                        agent_profile.name,
                        bundle,
                        f"Instant <2s guide shown while {selected_model} streams live...",
                    )
                    if not write_sse("draft", {"text": draft_txt}):
                        cancel_ev.set()
                        return

        if final_err is not None or final_res is None or not final_res.text.strip():
            clean_err = format_ai_error_message(final_err or "Cloud provider returned empty response.")
            with DB_LOCK:
                conn = get_db()
                SecurityGatekeeper(conn).log_audit("ai_stream_error", "ai_engine", selected_model, "info", clean_err)
            fallback_txt = build_local_fallback_reply(prompt, agent_profile.name, bundle, clean_err)
            write_sse("chunk", {"text": fallback_txt, "replaceDraft": True})
            write_sse("error", {"message": clean_err})
            asst_id = f"msg-{uuid.uuid4().hex[:8]}"
            with DB_LOCK:
                conn = get_db()
                conn.execute(
                    "INSERT INTO messages (id, conversation_id, role, content, agent_id, model, tokens_used, citations_json) VALUES (?, ?, 'assistant', ?, ?, ?, 0, ?)",
                    (asst_id, conv_id, fallback_txt, agent_profile.id, "local-fallback", json.dumps(citations) if citations else None),
                )
                conn.commit()
            write_sse("done", {"assistantMessageId": asst_id, "tokensUsed": 0, "cancelled": False})
            return

        effective_model = final_res.model or selected_model
        if effective_model != selected_model:
            write_sse(
                "meta",
                {
                    "conversationId": conv_id,
                    "userMessageId": user_msg_id,
                    "agent": {"id": agent_profile.id, "name": agent_profile.name, "role": agent_profile.role},
                    "routingReason": f"{routing_reason} (Auto-switched to {effective_model})",
                    "model": effective_model,
                    "cvBlockedByPolicy": bundle.cv_blocked_by_policy,
                    "citations": citations,
                },
            )

        asst_id = f"msg-{uuid.uuid4().hex[:8]}"
        with DB_LOCK:
            conn = get_db()
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, agent_id, model, tokens_used, citations_json) VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)",
                (
                    asst_id,
                    conv_id,
                    final_res.text,
                    agent_profile.id,
                    effective_model,
                    final_res.tokens_used,
                    json.dumps(citations) if citations else None,
                ),
            )
            conn.execute(
                "UPDATE conversations SET agent_id = ?, model = ?, language = ?, updated_at = datetime('now') WHERE id = ?",
                (agent_profile.id, effective_model, language, conv_id),
            )
            conn.commit()
        write_sse("done", {"assistantMessageId": asst_id, "tokensUsed": final_res.tokens_used, "cancelled": final_res.cancelled})


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def main() -> int:
    parser = argparse.ArgumentParser(description="REMY THE GRIVER PRO — Pure Python Backend Server")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=int(os.getenv("PYTHON_PORT", "3001")), help="Bind port (default: 3001)")
    parser.add_argument("--db", default="", help="Optional custom SQLite path")
    args = parser.parse_args()

    init_server_runtime(Path(args.db) if args.db else None)
    server = ReusableThreadingHTTPServer((args.host, args.port), RemyRequestHandler)
    print(f"REMY THE GRIVER PRO Python server listening on http://{args.host}:{args.port} (Python {platform.python_version()})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
