"""Kigali Daily Briefing plugin: summarizes pending SQLite tasks and live Kigali weather."""
from __future__ import annotations

import sqlite3
from typing import Any

from backend.tools.productivity import ProductivityService, fetch_kigali_weather


def run_plugin(conn: sqlite3.Connection, context: dict[str, Any]) -> dict[str, Any]:
    prod = ProductivityService(conn)
    summary = prod.get_weekly_summary()
    include_weather = bool(context.get("include_weather", True))
    weather: dict[str, Any] | str
    if include_weather:
        try:
            weather = fetch_kigali_weather()
        except Exception as exc:
            weather = f"Weather offline/unavailable: {exc}"
    else:
        weather = "Skipped (offline mode)"
    return {
        "briefing_title": "BULL MAN — Kigali Daily Briefing",
        "productivity": summary,
        "kigali_weather": weather,
    }
