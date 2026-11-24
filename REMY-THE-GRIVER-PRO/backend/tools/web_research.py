"""Permission-gated Web Research Assistant separating verified retrieved sources from synthesis."""
from __future__ import annotations

import json
import sqlite3
import urllib.parse
import urllib.request
from typing import Any

from backend.core.security import SecurityGatekeeper, SecurityViolationError


class WebResearchClient:
    def __init__(self, conn: sqlite3.Connection, gatekeeper: SecurityGatekeeper) -> None:
        self.conn = conn
        self.gatekeeper = gatekeeper

    def search_wikipedia_and_ddg(self, query: str, limit: int = 5) -> dict[str, Any]:
        strict_row = self.conn.execute("SELECT value FROM app_settings WHERE key = 'strict_local_mode'").fetchone()
        if strict_row and strict_row[0] == "true":
            self.gatekeeper.log_audit("web_research_blocked", "research_agent", query, "denied", "Strict Local-Only Mode")
            raise SecurityViolationError("Strict Local-Only Mode blocks outbound web research.")

        self.gatekeeper.require_permission("research.web_search", actor="research_agent", target=query)
        clean_q = query.strip()
        if not clean_q:
            raise ValueError("Search query cannot be empty.")

        wiki_url = self.gatekeeper.validate_safe_url(
            f"https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch={urllib.parse.quote(clean_q)}&format=json&srlimit={limit}"
        )
        req = urllib.request.Request(wiki_url, headers={"User-Agent": "REMY-THE-GRIVER-PRO/1.0"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            payload = json.loads(resp.read().decode("utf-8"))

        sources: list[dict[str, str]] = []
        for item in payload.get("query", {}).get("search", []):
            title = item.get("title", "")
            snippet = (
                item.get("snippet", "")
                .replace('<span class="searchmatch">', "")
                .replace("</span>", "")
            )
            page_url = f"https://en.wikipedia.org/wiki/{urllib.parse.quote(title.replace(' ', '_'))}"
            sources.append({"title": title, "snippet": snippet, "url": page_url})

        self.gatekeeper.log_audit("web_research_executed", "research_agent", clean_q, "allowed", f"hits={len(sources)}")
        return {
            "query": clean_q,
            "verified_sources": sources,
            "note": "Sources listed verbatim from retrieved web endpoint. Synthesis must be generated only from these verified entries.",
        }
