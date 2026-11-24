"""SQLite persistence layer with 18 normalized tables, foreign keys, indexes, backup, and restore."""
from __future__ import annotations

import json
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.core.config import BACKUPS_DIR, CV_DIR, DB_PATH, DOCUMENTS_DIR, ensure_directories


def get_connection(db_path: Path | None = None) -> sqlite3.Connection:
    ensure_directories()
    target = db_path or DB_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(target), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    return conn


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    cols = {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def init_database(db_path: Path | None = None) -> sqlite3.Connection:
    conn = get_connection(db_path)
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            brand_name TEXT NOT NULL,
            education TEXT NOT NULL,
            location TEXT NOT NULL,
            github_url TEXT NOT NULL,
            email TEXT DEFAULT 'remy@kivumusmart.local',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            agent_id TEXT NOT NULL DEFAULT 'main',
            model TEXT NOT NULL DEFAULT 'gemini-4-hydrogen',
            language TEXT NOT NULL DEFAULT 'en',
            saved INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
            content TEXT NOT NULL,
            agent_id TEXT,
            model TEXT,
            tokens_used INTEGER DEFAULT 0,
            citations_json TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS memories (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT 'general',
            approved INTEGER NOT NULL DEFAULT 1,
            enabled INTEGER NOT NULL DEFAULT 1,
            source TEXT NOT NULL DEFAULT 'user',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            filename TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            page_count INTEGER NOT NULL DEFAULT 1,
            summary TEXT DEFAULT '',
            local_only INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL DEFAULT 'indexed',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS document_chunks (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            page_or_row TEXT NOT NULL,
            content TEXT NOT NULL,
            keywords TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            progress INTEGER NOT NULL DEFAULT 0,
            stack TEXT NOT NULL,
            due_date TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            project_id TEXT,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high')),
            status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'in_progress', 'done')),
            project_name TEXT DEFAULT 'REMY THE GRIVER PRO',
            due_date TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT 'general',
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS reminders (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            remind_at TEXT NOT NULL,
            completed INTEGER NOT NULL DEFAULT 0,
            notified INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS approved_folders (
            id TEXT PRIMARY KEY,
            folder_path TEXT NOT NULL UNIQUE,
            access_level TEXT NOT NULL DEFAULT 'read',
            added_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS approved_apps (
            id TEXT PRIMARY KEY,
            app_name TEXT NOT NULL UNIQUE,
            executable_path TEXT NOT NULL,
            allowed INTEGER NOT NULL DEFAULT 1,
            added_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS permissions (
            id TEXT PRIMARY KEY,
            scope TEXT NOT NULL UNIQUE,
            description TEXT NOT NULL,
            granted INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT NOT NULL,
            actor TEXT NOT NULL,
            target TEXT NOT NULL,
            decision TEXT NOT NULL CHECK(decision IN ('allowed', 'denied', 'info')),
            details TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS provider_configs (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            provider_type TEXT NOT NULL,
            endpoint TEXT DEFAULT '',
            model_name TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            priority INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS cv_profiles (
            id TEXT PRIMARY KEY,
            full_name TEXT NOT NULL,
            education TEXT NOT NULL,
            location TEXT NOT NULL,
            github_url TEXT NOT NULL,
            internship TEXT NOT NULL,
            skills_json TEXT NOT NULL,
            projects_json TEXT NOT NULL,
            summary TEXT NOT NULL DEFAULT '',
            raw_text TEXT NOT NULL,
            private_locked INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS cv_versions (
            id TEXT PRIMARY KEY,
            cv_id TEXT NOT NULL,
            version_label TEXT NOT NULL,
            target_role TEXT DEFAULT '',
            raw_text TEXT NOT NULL,
            notes TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (cv_id) REFERENCES cv_profiles(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS plugin_registry (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            version TEXT NOT NULL,
            description TEXT NOT NULL,
            permissions_json TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 0,
            approved INTEGER NOT NULL DEFAULT 0,
            last_run TEXT,
            last_status TEXT DEFAULT 'idle'
        );

        CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_chunks_doc ON document_chunks(document_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
        """
    )
    # Forward-compatible column migrations for existing DB files
    _ensure_column(conn, "users", "email", "TEXT DEFAULT 'remy@kivumusmart.local'")
    _ensure_column(conn, "messages", "citations_json", "TEXT")
    _ensure_column(conn, "documents", "status", "TEXT NOT NULL DEFAULT 'indexed'")
    _ensure_column(conn, "tasks", "project_id", "TEXT")
    _ensure_column(conn, "tasks", "project_name", "TEXT DEFAULT 'REMY THE GRIVER PRO'")
    _ensure_column(conn, "reminders", "notified", "INTEGER NOT NULL DEFAULT 0")
    _ensure_column(conn, "cv_profiles", "summary", "TEXT NOT NULL DEFAULT ''")
    _seed_initial_data(conn)
    return conn


def _seed_initial_data(conn: sqlite3.Connection) -> None:
    if conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
        conn.execute(
            """
            INSERT INTO users (full_name, brand_name, education, location, github_url, email)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                "Remy Nsanzimana",
                "BULL MAN — THE BULL MAN ON TOP",
                "Level 5 Software Development, EAV KIVUMU TSS, Rwanda",
                "Kigali, Gasabo, Rwanda",
                "https://github.com/danger600",
                "remy@kivumusmart.local",
            ),
        )

    if conn.execute("SELECT COUNT(*) FROM cv_profiles").fetchone()[0] == 0:
        skills = [
            "HTML5", "CSS3", "JavaScript", "React.js", "Node.js", "Express.js",
            "MongoDB", "MySQL", "Supabase", "Git and GitHub", "Python",
            "REST APIs", "Database design", "Software development fundamentals",
            "Blockchain fundamentals",
        ]
        projects = [
            {"name": "KIVUMU SMART CAMPUS", "category": "Education Technology"},
            {"name": "UBUBIKO SMART", "category": "Smart Operations"},
            {"name": "EAV KIVUMU CLASS WEBSITE", "category": "Web Development"},
            {"name": "STUDENT REGISTRATION SYSTEM", "category": "Information Systems"},
        ]
        raw_text = "\n".join([
            "REMY NSANZIMANA",
            "Location: Kigali, Gasabo, Rwanda",
            "GitHub: https://github.com/danger600",
            "Education: Level 5 Software Development, EAV KIVUMU TSS, Rwanda",
            "",
            "TECHNICAL SKILLS & STUDY AREAS",
            ", ".join(skills),
            "",
            "SELECTED PROJECTS",
            *[f"- {p['name']} ({p['category']})" for p in projects],
            "",
            "INTERNSHIP",
            "ICT SMART SOLUTION, Kigali, Rwanda — April 2026",
        ])
        conn.execute(
            """
            INSERT INTO cv_profiles (
                id, full_name, education, location, github_url, internship,
                skills_json, projects_json, summary, raw_text, private_locked
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            """,
            (
                "remy-primary-cv",
                "Remy Nsanzimana",
                "Level 5 Software Development, EAV KIVUMU TSS, Rwanda",
                "Kigali, Gasabo, Rwanda",
                "https://github.com/danger600",
                "ICT SMART SOLUTION, Kigali, Rwanda (April 2026)",
                json.dumps(skills),
                json.dumps(projects),
                "Software Development student (Level 5, EAV KIVUMU TSS) based in Kigali, Gasabo, Rwanda, focused on full-stack web engineering, database systems, REST APIs, and Python AI tooling.",
                raw_text,
            ),
        )
        conn.execute(
            """
            INSERT INTO cv_versions (id, cv_id, version_label, target_role, raw_text, notes)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                "cv-v1",
                "remy-primary-cv",
                "v1.0 — Verified Baseline",
                "Junior Software Developer",
                raw_text,
                "Authentic baseline profile. Private by default.",
            ),
        )

    extra_perms = [
        ("perm-cv", "cv.external_ai", "Allow transmitting private CV to external AI models", 0),
        ("perm-exec", "studio.sandbox_exec", "Allow isolated Python code execution", 1),
        ("perm-vm", "studio.vm_exec", "Allow isolated Developer Studio sandbox execution", 1),
        ("perm-web", "research.web_search", "Allow live web search queries", 1),
        ("perm-plug", "plugins.execute", "Allow approved plugins to execute", 1),
        ("perm-mic", "voice.microphone", "Allow microphone capture and voice recognition", 1),
        ("perm-fs", "workspace.export", "Allow exporting PDF/ZIP bundles to downloads", 1),
    ]
    conn.executemany(
        "INSERT OR IGNORE INTO permissions (id, scope, description, granted) VALUES (?, ?, ?, ?)",
        extra_perms,
    )

    if conn.execute("SELECT COUNT(*) FROM approved_folders").fetchone()[0] == 0:
        folders = [
            ("fld-docs", str(DOCUMENTS_DIR.resolve()), "read_write"),
            ("fld-cv", str(CV_DIR.resolve()), "read_write"),
            ("fld-backups", str(BACKUPS_DIR.resolve()), "read_write"),
        ]
        conn.executemany(
            "INSERT INTO approved_folders (id, folder_path, access_level) VALUES (?, ?, ?)",
            folders,
        )

    if conn.execute("SELECT COUNT(*) FROM approved_apps").fetchone()[0] == 0:
        apps = [
            ("app-python", "Python", "python", 1),
            ("app-git", "Git", "git", 1),
            ("app-code", "VS Code", "code", 1),
        ]
        conn.executemany(
            "INSERT INTO approved_apps (id, app_name, executable_path, allowed) VALUES (?, ?, ?, ?)",
            apps,
        )

    if conn.execute("SELECT COUNT(*) FROM provider_configs").fetchone()[0] == 0:
        providers = [
            ("prov-openai-responses", "OpenAI Responses API", "openai", "https://api.openai.com/v1/responses", "gpt-4o-mini", 1, 1),
            ("prov-gemini-hydrogen", "Gemini 4 Hydrogen (Primary Cloud)", "gemini", "server-managed", "gemini-4-hydrogen", 1, 2),
            ("prov-ollama", "Ollama Local", "ollama", "http://127.0.0.1:11434", "llama3", 1, 3),
        ]
        conn.executemany(
            "INSERT INTO provider_configs (id, name, provider_type, endpoint, model_name, enabled, priority) VALUES (?, ?, ?, ?, ?, ?, ?)",
            providers,
        )

    default_settings = [
        ("theme", "dark"),
        ("language", "en"),
        ("memory_enabled", "true"),
        ("default_model", "gemini-4-hydrogen"),
        ("hide_private_features", "false"),
        ("strict_local_mode", "false"),
    ]
    conn.executemany("INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)", default_settings)

    if conn.execute("SELECT COUNT(*) FROM plugin_registry").fetchone()[0] == 0:
        conn.executemany(
            """
            INSERT INTO plugin_registry (id, name, version, description, permissions_json, enabled, approved)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    "plug-kigali-brief",
                    "Kigali Daily Briefing",
                    "1.0.0",
                    "Summarizes open tasks and live Open-Meteo weather for Kigali.",
                    json.dumps(["tasks.read", "weather.read"]),
                    1,
                    1,
                ),
                (
                    "plug-code-complexity",
                    "Code Complexity Inspector",
                    "1.0.0",
                    "Analyzes Python functions and branches statically in isolation.",
                    json.dumps(["studio.read"]),
                    1,
                    1,
                ),
                (
                    "plug-cv-keyword-audit",
                    "ATS Keyword Auditor",
                    "1.0.0",
                    "Audits stored CV keywords locally without external transmission.",
                    json.dumps(["cv.read_local"]),
                    0,
                    0,
                ),
            ],
        )
    conn.commit()


def create_backup(conn: sqlite3.Connection, dest_dir: Path | None = None) -> Path:
    target_dir = dest_dir or BACKUPS_DIR
    target_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    dest = target_dir / f"remy_griver_backup_{stamp}.db"
    backup_conn = sqlite3.connect(str(dest))
    try:
        conn.backup(backup_conn)
    finally:
        backup_conn.close()
    return dest


def restore_backup(backup_file: Path, target_db_path: Path | None = None) -> None:
    if not backup_file.exists():
        raise FileNotFoundError(f"Backup file not found: {backup_file}")
    test_conn = sqlite3.connect(str(backup_file))
    try:
        res = test_conn.execute("PRAGMA integrity_check;").fetchone()
        if not res or res[0] != "ok":
            raise ValueError("Backup failed SQLite integrity verification.")
    finally:
        test_conn.close()
    dest = target_db_path or DB_PATH
    shutil.copy2(str(backup_file), str(dest))


def get_database_health(conn: sqlite3.Connection, db_path: Path | None = None) -> dict[str, Any]:
    integrity = conn.execute("PRAGMA integrity_check;").fetchone()[0]
    target = db_path or DB_PATH
    size_bytes = target.stat().st_size if target.exists() else 0
    tables = ["conversations", "messages", "memories", "documents", "tasks", "notes", "reminders", "audit_logs", "plugin_registry"]
    counts = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in tables}
    return {"integrity": integrity, "size_bytes": size_bytes, "counts": counts}
