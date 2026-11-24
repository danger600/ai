"""Isolated Plugin Manager: discovery, permission checks, approval gating, and exception sandboxing."""
from __future__ import annotations

import importlib.util
import json
import sqlite3
from pathlib import Path
from typing import Any

from backend.core.config import BASE_DIR
from backend.core.security import SecurityGatekeeper, SecurityViolationError


class PluginManager:
    def __init__(self, conn: sqlite3.Connection, gatekeeper: SecurityGatekeeper, plugins_dir: Path | None = None) -> None:
        self.conn = conn
        self.gatekeeper = gatekeeper
        self.plugins_dir = plugins_dir or (BASE_DIR / "plugins")

    def list_plugins(self) -> list[dict[str, Any]]:
        rows = self.conn.execute("SELECT * FROM plugin_registry ORDER BY name ASC").fetchall()
        results: list[dict[str, Any]] = []
        for r in rows:
            item = dict(r)
            item["permissions"] = json.loads(item["permissions_json"])
            results.append(item)
        return results

    def set_plugin_state(self, plugin_id: str, enabled: bool | None = None, approved: bool | None = None) -> None:
        row = self.conn.execute("SELECT enabled, approved FROM plugin_registry WHERE id = ?", (plugin_id,)).fetchone()
        if not row:
            raise LookupError(f"Plugin '{plugin_id}' not found.")
        new_enabled = (1 if enabled else 0) if enabled is not None else row["enabled"]
        new_approved = (1 if approved else 0) if approved is not None else row["approved"]
        self.conn.execute(
            "UPDATE plugin_registry SET enabled = ?, approved = ? WHERE id = ?",
            (new_enabled, new_approved, plugin_id),
        )
        self.conn.commit()
        self.gatekeeper.log_audit("plugin_state_changed", "user", plugin_id, "allowed", f"enabled={new_enabled},approved={new_approved}")

    def run_plugin(self, plugin_id: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
        self.gatekeeper.require_permission("plugins.execute", actor="plugin_manager", target=plugin_id)
        row = self.conn.execute("SELECT * FROM plugin_registry WHERE id = ?", (plugin_id,)).fetchone()
        if not row:
            raise LookupError(f"Plugin '{plugin_id}' not registered.")
        if row["approved"] != 1 or row["enabled"] != 1:
            self.gatekeeper.log_audit("plugin_blocked", "plugin_manager", plugin_id, "denied", "Plugin disabled or unapproved")
            raise SecurityViolationError(f"Plugin '{row['name']}' must be both approved and enabled before running.")

        plugin_map = {
            "plug-kigali-brief": self.plugins_dir / "kigali_briefing.py",
        }
        module_path = plugin_map.get(plugin_id)
        if not module_path or not module_path.exists():
            raise FileNotFoundError(f"Plugin entrypoint missing for '{plugin_id}'.")

        try:
            spec = importlib.util.spec_from_file_location(f"remy_plugin_{plugin_id}", str(module_path))
            if spec is None or spec.loader is None:
                raise ImportError("Unable to load plugin spec.")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            output = module.run_plugin(self.conn, context or {})
            self.conn.execute(
                "UPDATE plugin_registry SET last_run = datetime('now'), last_status = 'ok' WHERE id = ?",
                (plugin_id,),
            )
            self.conn.commit()
            self.gatekeeper.log_audit("plugin_executed", "plugin_manager", plugin_id, "allowed")
            return {"status": "ok", "output": output}
        except Exception as exc:
            self.conn.execute(
                "UPDATE plugin_registry SET last_run = datetime('now'), last_status = ? WHERE id = ?",
                (f"error: {exc}", plugin_id),
            )
            self.conn.commit()
            self.gatekeeper.log_audit("plugin_failed", "plugin_manager", plugin_id, "info", str(exc))
            return {"status": "error", "error": str(exc)}
