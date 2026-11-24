"""Controlled Memory Vault: explicit user-approved long-term memories with toggle, search, export, and import."""
from __future__ import annotations

import json
import sqlite3
import uuid
from pathlib import Path
from typing import Any

from backend.core.security import SecurityGatekeeper


class MemoryVault:
    def __init__(self, conn: sqlite3.Connection, gatekeeper: SecurityGatekeeper) -> None:
        self.conn = conn
        self.gatekeeper = gatekeeper

    def is_memory_enabled(self) -> bool:
        row = self.conn.execute("SELECT value FROM app_settings WHERE key = 'memory_enabled'").fetchone()
        return not row or row[0] == "true"

    def set_memory_enabled(self, enabled: bool) -> None:
        self.conn.execute(
            "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('memory_enabled', ?, datetime('now'))",
            ("true" if enabled else "false",),
        )
        self.conn.commit()
        self.gatekeeper.log_audit("memory_global_toggle", "user", "memory_enabled", "allowed", str(enabled))

    def add_memory(self, title: str, content: str, category: str = "general", approved: bool = True) -> dict[str, Any]:
        mem_id = f"mem-{uuid.uuid4().hex[:8]}"
        self.conn.execute(
            """
            INSERT INTO memories (id, title, content, category, approved, enabled, source)
            VALUES (?, ?, ?, ?, ?, 1, 'user')
            """,
            (mem_id, title.strip(), content.strip(), category.strip() or "general", 1 if approved else 0),
        )
        self.conn.commit()
        self.gatekeeper.log_audit("memory_created", "user", title, "allowed")
        return self.get_memory(mem_id)

    def get_memory(self, mem_id: str) -> dict[str, Any]:
        row = self.conn.execute("SELECT * FROM memories WHERE id = ?", (mem_id,)).fetchone()
        if not row:
            raise LookupError(f"Memory '{mem_id}' not found.")
        return dict(row)

    def list_memories(self, query: str = "", category: str | None = None) -> list[dict[str, Any]]:
        sql = "SELECT * FROM memories WHERE 1=1"
        params: list[Any] = []
        if query.strip():
            sql += " AND (LOWER(title) LIKE ? OR LOWER(content) LIKE ?)"
            q = f"%{query.strip().lower()}%"
            params.extend([q, q])
        if category and category != "all":
            sql += " AND category = ?"
            params.append(category)
        sql += " ORDER BY updated_at DESC"
        return [dict(r) for r in self.conn.execute(sql, params).fetchall()]

    def update_memory(
        self,
        mem_id: str,
        title: str | None = None,
        content: str | None = None,
        approved: bool | None = None,
        enabled: bool | None = None,
    ) -> dict[str, Any]:
        current = self.get_memory(mem_id)
        self.conn.execute(
            """
            UPDATE memories
            SET title = ?, content = ?, approved = ?, enabled = ?, updated_at = datetime('now')
            WHERE id = ?
            """,
            (
                title.strip() if title is not None else current["title"],
                content.strip() if content is not None else current["content"],
                (1 if approved else 0) if approved is not None else current["approved"],
                (1 if enabled else 0) if enabled is not None else current["enabled"],
                mem_id,
            ),
        )
        self.conn.commit()
        return self.get_memory(mem_id)

    def delete_memory(self, mem_id: str) -> None:
        self.conn.execute("DELETE FROM memories WHERE id = ?", (mem_id,))
        self.conn.commit()
        self.gatekeeper.log_audit("memory_deleted", "user", mem_id, "allowed")

    def get_active_context_memories(self) -> list[dict[str, Any]]:
        if not self.is_memory_enabled():
            return []
        rows = self.conn.execute(
            "SELECT id, title, content, category FROM memories WHERE approved = 1 AND enabled = 1 ORDER BY updated_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]

    def export_json(self, dest_path: Path) -> Path:
        data = self.list_memories()
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        dest_path.write_text(json.dumps({"memories": data}, indent=2), encoding="utf-8")
        return dest_path

    def import_json(self, src_path: Path) -> int:
        payload = json.loads(src_path.read_text(encoding="utf-8"))
        items = payload.get("memories", [])
        imported = 0
        for item in items:
            if isinstance(item, dict) and item.get("title") and item.get("content"):
                self.add_memory(
                    title=str(item["title"]),
                    content=str(item["content"]),
                    category=str(item.get("category", "general")),
                    approved=bool(item.get("approved", True)),
                )
                imported += 1
        return imported
