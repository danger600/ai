"""Productivity Suite: Tasks, Notes, Reminders CRUD + live Kigali weather & currency utilities."""
from __future__ import annotations

import json
import sqlite3
import urllib.parse
import urllib.request
import uuid
from typing import Any


class ProductivityService:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn

    # --- Tasks ---
    def list_tasks(self) -> list[dict[str, Any]]:
        rows = self.conn.execute("SELECT * FROM tasks ORDER BY created_at DESC").fetchall()
        return [dict(r) for r in rows]

    def create_task(self, title: str, description: str = "", priority: str = "medium", due_date: str | None = None) -> dict[str, Any]:
        if priority not in ("low", "medium", "high"):
            priority = "medium"
        task_id = f"tsk-{uuid.uuid4().hex[:8]}"
        self.conn.execute(
            "INSERT INTO tasks (id, title, description, priority, status, due_date) VALUES (?, ?, ?, ?, 'todo', ?)",
            (task_id, title.strip(), description.strip(), priority, due_date),
        )
        self.conn.commit()
        return dict(self.conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone())

    def update_task_status(self, task_id: str, status: str) -> dict[str, Any]:
        if status not in ("todo", "in_progress", "done"):
            raise ValueError(f"Invalid task status: {status}")
        self.conn.execute("UPDATE tasks SET status = ? WHERE id = ?", (status, task_id))
        self.conn.commit()
        row = self.conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            raise LookupError(f"Task '{task_id}' not found.")
        return dict(row)

    def delete_task(self, task_id: str) -> None:
        self.conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        self.conn.commit()

    # --- Notes ---
    def list_notes(self) -> list[dict[str, Any]]:
        rows = self.conn.execute("SELECT * FROM notes ORDER BY updated_at DESC").fetchall()
        return [dict(r) for r in rows]

    def create_note(self, title: str, content: str, category: str = "general") -> dict[str, Any]:
        note_id = f"nte-{uuid.uuid4().hex[:8]}"
        self.conn.execute(
            "INSERT INTO notes (id, title, content, category) VALUES (?, ?, ?, ?)",
            (note_id, title.strip(), content.strip(), category.strip() or "general"),
        )
        self.conn.commit()
        return dict(self.conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone())

    def delete_note(self, note_id: str) -> None:
        self.conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
        self.conn.commit()

    # --- Reminders ---
    def list_reminders(self) -> list[dict[str, Any]]:
        rows = self.conn.execute("SELECT * FROM reminders ORDER BY remind_at ASC").fetchall()
        return [dict(r) for r in rows]

    def create_reminder(self, title: str, remind_at: str) -> dict[str, Any]:
        rem_id = f"rem-{uuid.uuid4().hex[:8]}"
        self.conn.execute(
            "INSERT INTO reminders (id, title, remind_at, completed) VALUES (?, ?, ?, 0)",
            (rem_id, title.strip(), remind_at.strip()),
        )
        self.conn.commit()
        return dict(self.conn.execute("SELECT * FROM reminders WHERE id = ?", (rem_id,)).fetchone())

    def toggle_reminder(self, rem_id: str, completed: bool) -> None:
        self.conn.execute("UPDATE reminders SET completed = ? WHERE id = ?", (1 if completed else 0, rem_id))
        self.conn.commit()

    def get_weekly_summary(self) -> dict[str, Any]:
        tasks = self.list_tasks()
        done = sum(1 for t in tasks if t["status"] == "done")
        in_prog = sum(1 for t in tasks if t["status"] == "in_progress")
        todo = sum(1 for t in tasks if t["status"] == "todo")
        notes_count = self.conn.execute("SELECT COUNT(*) FROM notes").fetchone()[0]
        reminders_open = self.conn.execute("SELECT COUNT(*) FROM reminders WHERE completed = 0").fetchone()[0]
        return {
            "tasks_total": len(tasks),
            "tasks_done": done,
            "tasks_in_progress": in_prog,
            "tasks_todo": todo,
            "notes_total": notes_count,
            "reminders_pending": reminders_open,
        }


def fetch_kigali_weather(lat: float = -1.9441, lon: float = 30.0619, timeout_sec: float = 5.0) -> dict[str, Any]:
    url = (
        f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
        "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&timezone=Africa%2FKigali"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "REMY-THE-GRIVER-PRO/1.0"})
    with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    cur = data.get("current", {})
    return {
        "location": "Kigali, Rwanda" if lat == -1.9441 and lon == 30.0619 else f"{lat}, {lon}",
        "temperature_c": cur.get("temperature_2m"),
        "humidity_pct": cur.get("relative_humidity_2m"),
        "wind_kmh": cur.get("wind_speed_10m"),
        "source": "api.open-meteo.com",
    }


def convert_currency(amount: float, from_curr: str, to_curr: str, timeout_sec: float = 5.0) -> dict[str, Any]:
    f_cur = urllib.parse.quote(from_curr.strip().upper())
    t_cur = to_curr.strip().upper()
    url = f"https://open.er-api.com/v6/latest/{f_cur}"
    req = urllib.request.Request(url, headers={"User-Agent": "REMY-THE-GRIVER-PRO/1.0"})
    with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    rates = data.get("rates", {})
    if t_cur not in rates:
        raise ValueError(f"Currency '{t_cur}' not available in exchange rate feed.")
    rate = float(rates[t_cur])
    return {
        "amount": amount,
        "from": f_cur,
        "to": t_cur,
        "rate": rate,
        "converted": round(amount * rate, 4),
        "source": "open.er-api.com",
    }
