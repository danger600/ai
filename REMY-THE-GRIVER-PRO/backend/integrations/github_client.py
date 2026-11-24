"""GitHub REST API Client for public repository inspection (configured for https://github.com/danger600)."""
from __future__ import annotations

import json
import sqlite3
import urllib.parse
import urllib.request
from typing import Any

from backend.core.security import SecurityGatekeeper, SecurityViolationError


class GitHubInspector:
    def __init__(self, conn: sqlite3.Connection, gatekeeper: SecurityGatekeeper) -> None:
        self.conn = conn
        self.gatekeeper = gatekeeper

    def _check_network_policy(self, target: str) -> None:
        strict_row = self.conn.execute("SELECT value FROM app_settings WHERE key = 'strict_local_mode'").fetchone()
        if strict_row and strict_row[0] == "true":
            raise SecurityViolationError("Strict Local-Only Mode blocks GitHub API requests.")
        self.gatekeeper.require_permission("research.web_search", actor="dev_studio", target=target)

    def fetch_user_repos(self, username: str = "danger600", per_page: int = 10) -> list[dict[str, Any]]:
        self._check_network_policy(f"github:{username}")
        safe_user = urllib.parse.quote(username.strip())
        url = self.gatekeeper.validate_safe_url(
            f"https://api.github.com/users/{safe_user}/repos?sort=updated&per_page={per_page}"
        )
        req = urllib.request.Request(
            url,
            headers={"Accept": "application/vnd.github+json", "User-Agent": "REMY-THE-GRIVER-PRO/1.0"},
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
        return [
            {
                "name": repo.get("name", ""),
                "full_name": repo.get("full_name", ""),
                "description": repo.get("description") or "",
                "language": repo.get("language") or "Unknown",
                "stars": repo.get("stargazers_count", 0),
                "url": repo.get("html_url", ""),
                "updated_at": repo.get("updated_at", ""),
            }
            for repo in raw
        ]
