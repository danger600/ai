"""CustomTkinter Enterprise Desktop UI for REMY THE GRIVER PRO (Windows 10 / 11)."""
from __future__ import annotations

import queue
import sqlite3
import threading
import uuid
from pathlib import Path
from typing import Any

from backend.agents.orchestrator import AGENTS, AgentOrchestrator
from backend.automation.plugin_manager import PluginManager
from backend.career.cv_manager import CVManager
from backend.core.ai_engine import HybridAIEngine, format_ai_error_message
from backend.core.config import APP_NAME, APP_TAGLINE, PERSONAL_BRAND, THEMES, load_config
from backend.core.context_builder import build_global_chat_context, build_local_fallback_reply
from backend.core.logging_setup import setup_logging
from backend.core.media_studio import PythonMediaStudio
from backend.core.security import SecurityGatekeeper, store_secret
from backend.database.db import create_backup, init_database, restore_backup
from backend.documents.rag_engine import LocalRAGEngine
from backend.integrations.dev_studio import DevStudioEngine
from backend.integrations.github_client import GitHubInspector
from backend.memory.memory_vault import MemoryVault
from backend.tools.calculator import convert_unit, safe_calculate
from backend.tools.productivity import ProductivityService, convert_currency, fetch_kigali_weather
from backend.tools.system_monitor import collect_system_telemetry
from backend.tools.web_research import WebResearchClient
from backend.voice.voice_engine import LANGUAGE_PROFILES, VoiceEngine

try:
    import tkinter as tk
    from tkinter import filedialog, messagebox
    import customtkinter as ctk  # type: ignore
except ImportError:  # pragma: no cover - headless CI without tkinter/customtkinter
    tk = None  # type: ignore
    filedialog = None  # type: ignore
    messagebox = None  # type: ignore
    ctk = None  # type: ignore


BaseCTk = ctk.CTk if ctk is not None else object


class RemyGriverProApp(BaseCTk):  # type: ignore[misc]
    """Full CustomTkinter desktop shell with background threading & Esc stop hook."""

    def __init__(self, conn: sqlite3.Connection | None = None) -> None:
        if ctk is None or tk is None:
            raise RuntimeError(
                "CustomTkinter / Tkinter is not available in this Python environment. "
                "Install requirements.txt on Windows 10/11 or run 'python main.py --cli'."
            )
        super().__init__()
        setup_logging()
        self.cfg = load_config()
        self.conn = conn or init_database()
        self.gatekeeper = SecurityGatekeeper(self.conn)
        self.ai_engine = HybridAIEngine(self.cfg)
        self.orchestrator = AgentOrchestrator(self.gatekeeper)
        self.cv_manager = CVManager(self.conn, self.gatekeeper)
        self.rag_engine = LocalRAGEngine(self.conn, self.gatekeeper)
        self.memory_vault = MemoryVault(self.conn, self.gatekeeper)
        self.productivity = ProductivityService(self.conn)
        self.web_research = WebResearchClient(self.conn, self.gatekeeper)
        self.voice_engine = VoiceEngine(self.gatekeeper)
        self.plugin_manager = PluginManager(self.conn, self.gatekeeper)
        self.dev_studio = DevStudioEngine(self.conn, self.gatekeeper)
        self.github_inspector = GitHubInspector(self.conn, self.gatekeeper)
        self.media_studio = PythonMediaStudio(self.conn, self.gatekeeper)

        self.ui_queue: queue.Queue[tuple[str, Any]] = queue.Queue()
        self.cancel_event = threading.Event()
        self.active_view = "chat"
        self.current_conversation_id = self._ensure_conversation()
        self.theme_key = self._get_setting("theme", self.cfg.theme)
        self.language = self._get_setting("language", self.cfg.language)
        self.hide_private = self._get_setting("hide_private_features", "false") == "true"
        self.strict_local = self._get_setting("strict_local_mode", "false") == "true"

        self.palette = THEMES.get(self.theme_key, THEMES["obsidian_dark"])
        ctk.set_appearance_mode("dark" if self.theme_key == "obsidian_dark" else "light")
        ctk.set_default_color_theme("blue")

        self.title(f"{APP_NAME} — {APP_TAGLINE}")
        self.geometry("1380x860")
        self.minsize(1120, 720)
        self.bind("<Escape>", lambda _e: self.stop_active_operations())

        self._build_shell()
        self._render_view(self.active_view)
        self.after(80, self._poll_ui_queue)
        self.after(200, self._refresh_context_panel_async)

    def _get_setting(self, key: str, default: str = "") -> str:
        row = self.conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
        return str(row[0]) if row else default

    def _set_setting(self, key: str, value: str) -> None:
        self.conn.execute(
            "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))",
            (key, value),
        )
        self.conn.commit()

    def _ensure_conversation(self) -> str:
        row = self.conn.execute("SELECT id FROM conversations ORDER BY updated_at DESC LIMIT 1").fetchone()
        if row:
            return str(row[0])
        cid = f"conv-{uuid.uuid4().hex[:8]}"
        self.conn.execute("INSERT INTO conversations (id, title) VALUES (?, ?)", (cid, "Remy Workspace Session"))
        self.conn.commit()
        return cid

    def _build_shell(self) -> None:
        p = self.palette
        self.configure(fg_color=p["bg_canvas"])
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)

        # Left Navigation Sidebar
        self.sidebar = ctk.CTkFrame(self, width=240, corner_radius=0, fg_color=p["bg_panel"])
        self.sidebar.grid(row=0, column=0, sticky="nsew")
        self.sidebar.grid_propagate(False)

        ctk.CTkLabel(
            self.sidebar, text=APP_NAME, font=("Outfit", 16, "bold"), text_color=p["accent_gold"]
        ).pack(padx=16, pady=(18, 2), anchor="w")
        ctk.CTkLabel(
            self.sidebar, text=APP_TAGLINE, font=("Plus Jakarta Sans", 11), text_color=p["text_muted"]
        ).pack(padx=16, pady=(0, 4), anchor="w")
        ctk.CTkLabel(
            self.sidebar, text=PERSONAL_BRAND, font=("Plus Jakarta Sans", 10, "bold"), text_color=p["accent_blue"]
        ).pack(padx=16, pady=(0, 14), anchor="w")

        self.nav_buttons: dict[str, Any] = {}
        self.nav_container = ctk.CTkFrame(self.sidebar, fg_color="transparent")
        self.nav_container.pack(fill="both", expand=True, padx=10)
        self._rebuild_sidebar_nav()

        # Privacy quick switches at bottom of sidebar
        privacy_box = ctk.CTkFrame(self.sidebar, fg_color=p["bg_card"], corner_radius=10)
        privacy_box.pack(fill="x", padx=12, pady=12)

        self.hide_private_var = tk.BooleanVar(value=self.hide_private)
        ctk.CTkSwitch(
            privacy_box,
            text="Hide Private Features",
            variable=self.hide_private_var,
            command=self._toggle_hide_private,
            font=("Plus Jakarta Sans", 11),
        ).pack(padx=10, pady=(10, 6), anchor="w")

        self.strict_local_var = tk.BooleanVar(value=self.strict_local)
        ctk.CTkSwitch(
            privacy_box,
            text="Strict Local-Only",
            variable=self.strict_local_var,
            command=self._toggle_strict_local,
            font=("Plus Jakarta Sans", 11),
        ).pack(padx=10, pady=(0, 10), anchor="w")

        # Center Main Workspace
        self.workspace = ctk.CTkFrame(self, fg_color=p["bg_canvas"], corner_radius=0)
        self.workspace.grid(row=0, column=1, sticky="nsew", padx=12, pady=12)
        self.workspace.grid_columnconfigure(0, weight=1)
        self.workspace.grid_rowconfigure(1, weight=1)

        # Header Bar
        self.header_bar = ctk.CTkFrame(self.workspace, fg_color=p["bg_panel"], height=52, corner_radius=10)
        self.header_bar.grid(row=0, column=0, sticky="ew", pady=(0, 10))
        self.header_title = ctk.CTkLabel(
            self.header_bar, text="AI Workspace", font=("Outfit", 16, "bold"), text_color=p["text_primary"]
        )
        self.header_title.pack(side="left", padx=16, pady=10)

        self.stop_btn = ctk.CTkButton(
            self.header_bar,
            text="Stop (Esc)",
            width=100,
            fg_color=p["danger"],
            command=self.stop_active_operations,
        )
        self.stop_btn.pack(side="right", padx=12, pady=8)

        self.status_badge = ctk.CTkLabel(
            self.header_bar, text="Security Gatekeeper Active", font=("Plus Jakarta Sans", 11), text_color=p["accent_gold"]
        )
        self.status_badge.pack(side="right", padx=10)

        # Dynamic View Container
        self.view_frame = ctk.CTkFrame(self.workspace, fg_color=p["bg_panel"], corner_radius=12)
        self.view_frame.grid(row=1, column=0, sticky="nsew")

        # Right Context Panel
        self.context_panel = ctk.CTkFrame(self, width=265, corner_radius=0, fg_color=p["bg_panel"])
        self.context_panel.grid(row=0, column=2, sticky="nsew")
        self.context_panel.grid_propagate(False)
        ctk.CTkLabel(
            self.context_panel, text="Live Context Inspector", font=("Outfit", 14, "bold"), text_color=p["text_primary"]
        ).pack(padx=14, pady=(18, 10), anchor="w")
        self.context_box = ctk.CTkTextbox(
            self.context_panel, fg_color=p["bg_card"], text_color=p["text_primary"], font=("JetBrains Mono", 11)
        )
        self.context_box.pack(fill="both", expand=True, padx=12, pady=(0, 12))
        self.context_box.configure(state="disabled")

    def _rebuild_sidebar_nav(self) -> None:
        for child in self.nav_container.winfo_children():
            child.destroy()
        self.nav_buttons.clear()

        items = [
            ("chat", "AI Assistant Chat", False),
            ("studio", "Developer Studio (Python)", False),
            ("media", "Media Studio (Image/Video)", False),
            ("documents", "Document Hub (RAG)", False),
            ("cv", "Private CV Vault", True),
            ("memory", "Memory Vault", True),
            ("productivity", "Productivity & Tools", False),
            ("research", "Web Research", False),
            ("system", "System & Security", False),
            ("settings", "Settings & Keys", False),
        ]
        p = self.palette
        for key, label, is_private in items:
            if is_private and self.hide_private:
                continue
            btn = ctk.CTkButton(
                self.nav_container,
                text=label,
                anchor="w",
                height=36,
                corner_radius=8,
                fg_color=p["accent_blue"] if self.active_view == key else "transparent",
                hover_color=p["bg_card"],
                text_color=p["text_primary"],
                command=lambda k=key: self._render_view(k),
            )
            btn.pack(fill="x", pady=3)
            self.nav_buttons[key] = btn

    def _toggle_hide_private(self) -> None:
        self.hide_private = bool(self.hide_private_var.get())
        self._set_setting("hide_private_features", "true" if self.hide_private else "false")
        self.gatekeeper.log_audit("hide_private_toggled", "user", "ui", "allowed", str(self.hide_private))
        if self.hide_private and self.active_view in ("cv", "memory"):
            self.active_view = "chat"
        self._rebuild_sidebar_nav()
        self._render_view(self.active_view)

    def _toggle_strict_local(self) -> None:
        self.strict_local = bool(self.strict_local_var.get())
        self._set_setting("strict_local_mode", "true" if self.strict_local else "false")
        self.gatekeeper.log_audit("strict_local_toggled", "user", "network_policy", "allowed", str(self.strict_local))
        self._refresh_context_panel_async()

    def stop_active_operations(self) -> None:
        self.cancel_event.set()
        self.voice_engine.stop_all()
        self.status_badge.configure(text="Interrupted via Stop/Esc")

    def _poll_ui_queue(self) -> None:
        try:
            while True:
                kind, payload = self.ui_queue.get_nowait()
                if kind == "context_update":
                    self.context_box.configure(state="normal")
                    self.context_box.delete("1.0", "end")
                    self.context_box.insert("1.0", payload)
                    self.context_box.configure(state="disabled")
                elif kind == "chat_append" and hasattr(self, "chat_log"):
                    self.chat_log.configure(state="normal")
                    self.chat_log.insert("end", payload)
                    self.chat_log.see("end")
                    self.chat_log.configure(state="disabled")
                elif kind == "chat_done":
                    self.status_badge.configure(text=payload)
                elif kind == "info_popup" and messagebox is not None:
                    messagebox.showinfo(APP_NAME, str(payload))
                elif kind == "error_popup" and messagebox is not None:
                    messagebox.showerror(f"{APP_NAME} — Policy / Error", str(payload))
        except queue.Empty:
            pass
        self.after(80, self._poll_ui_queue)

    def _refresh_context_panel_async(self) -> None:
        def _worker() -> None:
            providers = self.ai_engine.detect_providers()
            telemetry = collect_system_telemetry(self.conn)
            lines = [
                f"Developer: Remy Nsanzimana",
                f"Brand: BULL MAN",
                f"Theme: {self.theme_key}",
                f"Strict Local: {'ON' if self.strict_local else 'OFF'}",
                f"Private Hidden: {'YES' if self.hide_private else 'NO'}",
                "",
                "--- AI Providers ---",
                f"Cloud: {'READY' if providers['cloud'].available else 'UNCONFIGURED'}",
                f"Ollama: {'READY' if providers['local'].available else 'OFFLINE'}",
                "",
                "--- System Telemetry ---",
                f"OS: {telemetry['os']}",
                f"CPU: {telemetry['cpu_percent']}%",
                f"RAM: {telemetry['ram_percent']}%",
                f"Disk: {telemetry['disk_percent']}%",
                f"DB Integrity: {telemetry['database']['integrity']}",
            ]
            self.ui_queue.put(("context_update", "\n".join(lines)))

        threading.Thread(target=_worker, daemon=True).start()

    def _render_view(self, view_key: str) -> None:
        if self.hide_private and view_key in ("cv", "memory"):
            view_key = "chat"
        self.active_view = view_key
        for k, btn in self.nav_buttons.items():
            btn.configure(fg_color=self.palette["accent_blue"] if k == view_key else "transparent")
        for child in self.view_frame.winfo_children():
            child.destroy()

        titles = {
            "chat": "AI Assistant Workspace (10 Specialized Agents)",
            "studio": "Developer Studio — AST Analyzer, SQL & Isolated Python Sandbox",
            "media": "Python Media Studio — Text-to-Image & Text-to-Video",
            "documents": "Document Intelligence & Local RAG Citations",
            "cv": "Private CV & Career Intelligence (Remy Nsanzimana)",
            "memory": "Controlled Memory Vault",
            "productivity": "Productivity Suite — Tasks, Notes, Weather & AST Calculator",
            "research": "Permission-Gated Web Research Assistant",
            "system": "System Monitor, Security Gatekeeper & Plugins",
            "settings": "Application Settings & Windows Credential Manager",
        }
        self.header_title.configure(text=titles.get(view_key, APP_NAME))

        builders = {
            "chat": self._build_chat_view,
            "studio": self._build_studio_view,
            "media": self._build_media_view,
            "documents": self._build_documents_view,
            "cv": self._build_cv_view,
            "memory": self._build_memory_view,
            "productivity": self._build_productivity_view,
            "research": self._build_research_view,
            "system": self._build_system_view,
            "settings": self._build_settings_view,
        }
        builders.get(view_key, self._build_chat_view)()

    # --- View 1: Chat ---
    def _build_chat_view(self) -> None:
        p = self.palette
        top_controls = ctk.CTkFrame(self.view_frame, fg_color="transparent")
        top_controls.pack(fill="x", padx=12, pady=(10, 4))

        agent_choices = ["auto"] + [a.id for a in AGENTS]
        self.agent_var = tk.StringVar(value="auto")
        ctk.CTkLabel(top_controls, text="Agent:").pack(side="left", padx=(0, 4))
        ctk.CTkOptionMenu(top_controls, values=agent_choices, variable=self.agent_var, width=140).pack(side="left", padx=4)

        self.model_var = tk.StringVar(value="gemini-4-hydrogen")
        ctk.CTkLabel(top_controls, text="Model:").pack(side="left", padx=(10, 4))
        ctk.CTkOptionMenu(
            top_controls,
            values=[
                "gemini-4-hydrogen",
                "gemini-3.1-flash-lite",
                "gemini-4-carbon",
                "gemini-4-neon",
                "gpt-4o-mini",
                "gpt-4o",
                "llama3",
                "mistral",
            ],
            variable=self.model_var,
            width=165,
        ).pack(side="left", padx=4)

        self.lang_var = tk.StringVar(value=self.language)
        ctk.CTkLabel(top_controls, text="Lang:").pack(side="left", padx=(10, 4))
        ctk.CTkOptionMenu(top_controls, values=list(LANGUAGE_PROFILES.keys()), variable=self.lang_var, width=80).pack(side="left")

        ctk.CTkButton(top_controls, text="New Chat", width=90, command=self._new_conversation).pack(side="right", padx=4)
        ctk.CTkButton(top_controls, text="Speak Reply", width=100, command=self._speak_last_reply).pack(side="right", padx=4)

        self.use_memory_var = tk.BooleanVar(value=True)
        self.include_cv_var = tk.BooleanVar(value=False)
        if not self.hide_private:
            ctx_bar = ctk.CTkFrame(self.view_frame, fg_color="transparent")
            ctx_bar.pack(fill="x", padx=12, pady=(0, 4))
            ctk.CTkCheckBox(
                ctx_bar,
                text="Use Memory Vault",
                variable=self.use_memory_var,
                font=("Plus Jakarta Sans", 11),
            ).pack(side="left", padx=(0, 14))
            ctk.CTkCheckBox(
                ctx_bar,
                text="Include CV (Permission-Gated)",
                variable=self.include_cv_var,
                font=("Plus Jakarta Sans", 11),
            ).pack(side="left")

        self.chat_log = ctk.CTkTextbox(self.view_frame, fg_color=p["bg_card"], font=("Plus Jakarta Sans", 12), wrap="word")
        self.chat_log.pack(fill="both", expand=True, padx=12, pady=8)
        self._load_conversation_messages()

        dock = ctk.CTkFrame(self.view_frame, fg_color=p["bg_card"], corner_radius=10)
        dock.pack(fill="x", padx=12, pady=(0, 12))
        self.chat_input = ctk.CTkTextbox(dock, height=74, fg_color=p["bg_canvas"], font=("Plus Jakarta Sans", 12))
        self.chat_input.pack(side="left", fill="x", expand=True, padx=(10, 8), pady=10)
        self.chat_input.bind("<Return>", self._on_chat_enter)

        btn_col = ctk.CTkFrame(dock, fg_color="transparent")
        btn_col.pack(side="right", padx=(0, 10), pady=10)
        ctk.CTkButton(btn_col, text="Send", width=96, fg_color=p["accent_blue"], command=self._send_chat_message).pack(pady=(0, 6))
        ctk.CTkButton(btn_col, text="Voice Mic", width=96, fg_color=p["accent_gold"], text_color="#090D16", command=self._voice_prompt).pack()

    def _load_conversation_messages(self) -> None:
        rows = self.conn.execute(
            "SELECT role, content, agent_id FROM messages WHERE conversation_id = ? ORDER BY rowid ASC",
            (self.current_conversation_id,),
        ).fetchall()
        self.chat_log.configure(state="normal")
        self.chat_log.delete("1.0", "end")
        if not rows:
            self.chat_log.insert("end", "BULL MAN — REMY THE GRIVER PRO ready.\nYour Personal AI. Your Rules.\n\n")
        for r in rows:
            prefix = "You" if r["role"] == "user" else f"Assistant [{r['agent_id'] or 'main'}]"
            self.chat_log.insert("end", f"{prefix}:\n{r['content']}\n\n")
        self.chat_log.configure(state="disabled")

    def _new_conversation(self) -> None:
        cid = f"conv-{uuid.uuid4().hex[:8]}"
        self.conn.execute("INSERT INTO conversations (id, title) VALUES (?, ?)", (cid, f"Chat {cid[-4:]}"))
        self.conn.commit()
        self.current_conversation_id = cid
        self._load_conversation_messages()

    def _on_chat_enter(self, event: Any) -> str | None:
        if event.state & 0x0001:  # Shift+Enter inserts newline
            return None
        self._send_chat_message()
        return "break"

    def _send_chat_message(self) -> None:
        prompt = self.chat_input.get("1.0", "end").strip()
        if not prompt:
            return
        self.chat_input.delete("1.0", "end")
        self.cancel_event.clear()

        agent, route_reason = self.orchestrator.route(prompt, self.agent_var.get())
        if agent.id != "career":
            try:
                self.orchestrator.verify_agent_permissions(agent, action_target=prompt[:60])
            except Exception as exc:
                self.ui_queue.put(("error_popup", str(exc)))
                return

        self.conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, agent_id) VALUES (?, ?, 'user', ?, ?)",
            (f"msg-{uuid.uuid4().hex[:8]}", self.current_conversation_id, prompt, agent.id),
        )
        self.conn.commit()

        bundle = build_global_chat_context(
            conn=self.conn,
            gatekeeper=self.gatekeeper,
            memory_vault=self.memory_vault,
            rag_engine=self.rag_engine,
            cv_manager=self.cv_manager,
            conversation_id=self.current_conversation_id,
            prompt=prompt,
            agent_system_prompt=agent.system_prompt,
            language=self.lang_var.get(),
            include_memory=bool(self.use_memory_var.get()),
            include_cv=bool(self.include_cv_var.get()),
            hide_private=self.hide_private,
        )

        self.chat_log.configure(state="normal")
        self.chat_log.insert("end", f"You:\n{prompt}\n\nAssistant [{agent.name}] ({route_reason}):\n")
        if bundle.cv_blocked_by_policy:
            self.chat_log.insert(
                "end",
                "[Security Gatekeeper Notice: Include CV was checked, but cv.external_ai is LOCKED. Proceeding without sending CV.]\n",
            )
        self.chat_log.see("end")
        self.chat_log.configure(state="disabled")
        self.status_badge.configure(text=f"Streaming via {agent.name}...")

        first_chunk_seen = threading.Event()
        fallback_rendered = threading.Event()
        draft_shown = threading.Event()

        def _render_instant_draft() -> None:
            if first_chunk_seen.is_set() or fallback_rendered.is_set() or draft_shown.is_set():
                return
            draft_shown.set()
            draft_text = build_local_fallback_reply(
                prompt,
                agent.name,
                bundle,
                "Instant <2s guide displayed while cloud AI completes...",
            )
            self.ui_queue.put(("chat_append", f"{draft_text}\n\n[Live Cloud AI Response]:\n"))
            self.ui_queue.put(("chat_done", "Instant guide delivered (<2s); awaiting live stream..."))

        def _render_final_fallback(reason: str) -> None:
            if fallback_rendered.is_set() or first_chunk_seen.is_set():
                return
            fallback_rendered.set()
            fallback_text = build_local_fallback_reply(prompt, agent.name, bundle, reason)
            self.conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, agent_id, model, tokens_used) VALUES (?, ?, 'assistant', ?, ?, 'local-fallback', 0)",
                (f"msg-{uuid.uuid4().hex[:8]}", self.current_conversation_id, fallback_text, agent.id),
            )
            self.conn.commit()
            if not draft_shown.is_set():
                self.ui_queue.put(("chat_append", f"{fallback_text}\n\n"))
            else:
                self.ui_queue.put(("chat_append", f"[Fallback active: {reason}]\n\n"))
            self.ui_queue.put(("chat_done", reason[:90]))

        self.after(1500, _render_instant_draft)

        def _worker() -> None:
            try:
                model = self.model_var.get()
                pref = "ollama" if model in ("llama3", "mistral") else "auto"

                def _on_chunk(c: str) -> None:
                    first_chunk_seen.set()
                    if not fallback_rendered.is_set():
                        self.ui_queue.put(("chat_append", c))

                res = self.ai_engine.stream_chat(
                    bundle.messages,
                    preferred_provider=pref,
                    model=model,
                    cancel_event=self.cancel_event,
                    strict_local_only=self.strict_local,
                    on_chunk=_on_chunk,
                    first_token_timeout_sec=15.0,
                )
                if not fallback_rendered.is_set():
                    first_chunk_seen.set()
                    self.conn.execute(
                        "INSERT INTO messages (id, conversation_id, role, content, agent_id, model, tokens_used) VALUES (?, ?, 'assistant', ?, ?, ?, ?)",
                        (f"msg-{uuid.uuid4().hex[:8]}", self.current_conversation_id, res.text, agent.id, res.model, res.tokens_used),
                    )
                    self.conn.commit()
                    self.ui_queue.put(("chat_append", "\n\n"))
                    self.ui_queue.put(("chat_done", f"Ready ({res.provider}: {res.model}, ~{res.tokens_used} tokens)"))
            except Exception as exc:
                _render_final_fallback(format_ai_error_message(exc))

        threading.Thread(target=_worker, daemon=True).start()

    def _voice_prompt(self) -> None:
        def _worker() -> None:
            try:
                transcript = self.voice_engine.listen_once(language=self.lang_var.get())
                if transcript:
                    self.ui_queue.put(("info_popup", f"Recognized: {transcript}"))
            except Exception as exc:
                self.ui_queue.put(("error_popup", str(exc)))

        threading.Thread(target=_worker, daemon=True).start()

    def _speak_last_reply(self) -> None:
        row = self.conn.execute(
            "SELECT content FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY rowid DESC LIMIT 1",
            (self.current_conversation_id,),
        ).fetchone()
        if row:
            self.voice_engine.speak_async(str(row[0]), language=self.lang_var.get())

    # --- View 2: Developer Studio ---
    def _build_studio_view(self) -> None:
        p = self.palette
        bar = ctk.CTkFrame(self.view_frame, fg_color="transparent")
        bar.pack(fill="x", padx=12, pady=10)
        ctk.CTkButton(bar, text="AST Analyze Code", command=self._studio_analyze).pack(side="left", padx=4)
        ctk.CTkButton(bar, text="Explain SQL", command=self._studio_explain_sql).pack(side="left", padx=4)
        ctk.CTkButton(bar, text="Run Isolated Python", fg_color=p["accent_gold"], text_color="#090D16", command=self._studio_run).pack(side="left", padx=4)
        ctk.CTkButton(bar, text="Inspect github.com/danger600", command=self._studio_github).pack(side="right", padx=4)

        self.studio_editor = ctk.CTkTextbox(self.view_frame, height=260, fg_color=p["bg_card"], font=("JetBrains Mono", 12))
        self.studio_editor.pack(fill="x", padx=12, pady=6)
        self.studio_editor.insert("1.0", 'def greet(name: str) -> str:\n    return f"Hello {name} from BULL MAN Sandbox"\n\nprint(greet("Remy"))')

        self.studio_output = ctk.CTkTextbox(self.view_frame, fg_color=p["bg_canvas"], font=("JetBrains Mono", 11))
        self.studio_output.pack(fill="both", expand=True, padx=12, pady=(4, 12))

    def _studio_analyze(self) -> None:
        report = self.dev_studio.analyze_python_code(self.studio_editor.get("1.0", "end"))
        self.studio_output.delete("1.0", "end")
        self.studio_output.insert("1.0", f"AST Analysis:\n{report}")

    def _studio_explain_sql(self) -> None:
        report = self.dev_studio.explain_sql_query(self.studio_editor.get("1.0", "end"))
        self.studio_output.delete("1.0", "end")
        self.studio_output.insert("1.0", f"SQL Structural Review:\n{report}")

    def _studio_run(self) -> None:
        code = self.studio_editor.get("1.0", "end")
        try:
            res = self.dev_studio.run_isolated_python(code)
            self.studio_output.delete("1.0", "end")
            self.studio_output.insert("1.0", f"Exit Code: {res.exit_code}\n\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}")
        except Exception as exc:
            messagebox.showerror(APP_NAME, str(exc))

    def _studio_github(self) -> None:
        def _worker() -> None:
            try:
                repos = self.github_inspector.fetch_user_repos("danger600")
                lines = [f"{r['full_name']} ({r['language']}) — {r['url']}" for r in repos]
                self.ui_queue.put(("info_popup", "\n".join(lines) or "No public repositories returned."))
            except Exception as exc:
                self.ui_queue.put(("error_popup", str(exc)))

        threading.Thread(target=_worker, daemon=True).start()

    # --- View 3: Document Hub ---
    def _build_documents_view(self) -> None:
        bar = ctk.CTkFrame(self.view_frame, fg_color="transparent")
        bar.pack(fill="x", padx=12, pady=10)
        ctk.CTkButton(bar, text="Ingest Local Document (PDF/DOCX/XLSX/CSV/TXT)", command=self._ingest_doc_dialog).pack(side="left")
        self.doc_query_entry = ctk.CTkEntry(bar, placeholder_text="Search local RAG chunks...", width=320)
        self.doc_query_entry.pack(side="left", padx=10)
        ctk.CTkButton(bar, text="Search", command=self._search_docs).pack(side="left")

        self.doc_output = ctk.CTkTextbox(self.view_frame, fg_color=self.palette["bg_card"], font=("JetBrains Mono", 11))
        self.doc_output.pack(fill="both", expand=True, padx=12, pady=(0, 12))
        self._refresh_docs_list()

    def _ingest_doc_dialog(self) -> None:
        path_str = filedialog.askopenfilename(title="Select document to ingest locally")
        if not path_str:
            return
        try:
            doc = self.rag_engine.ingest_file(Path(path_str))
            messagebox.showinfo(APP_NAME, f"Indexed {doc['filename']} ({len(doc['chunks'])} chunks).")
            self._refresh_docs_list()
        except Exception as exc:
            messagebox.showerror(APP_NAME, str(exc))

    def _refresh_docs_list(self) -> None:
        docs = self.rag_engine.list_documents()
        lines = [f"- {d['filename']} | {d['size_bytes']} bytes | {d['page_count']} pages/sections" for d in docs]
        self.doc_output.delete("1.0", "end")
        self.doc_output.insert("1.0", "\n".join(lines) or "No local documents indexed yet.")

    def _search_docs(self) -> None:
        hits = self.rag_engine.search_chunks(self.doc_query_entry.get())
        self.doc_output.delete("1.0", "end")
        if not hits:
            self.doc_output.insert("1.0", "No matching document chunks found.")
            return
        formatted = "\n\n".join(f"{h['citation']} (score={h['score']})\n{h['excerpt']}" for h in hits)
        self.doc_output.insert("1.0", formatted)

    # --- View 4: Private CV Vault ---
    def _build_cv_view(self) -> None:
        cv = self.cv_manager.get_primary_cv()
        bar = ctk.CTkFrame(self.view_frame, fg_color="transparent")
        bar.pack(fill="x", padx=12, pady=10)
        ctk.CTkButton(bar, text="Export CV PDF", command=lambda: messagebox.showinfo(APP_NAME, f"Saved to {self.cv_manager.export_cv_pdf()}")).pack(side="left", padx=4)
        ctk.CTkButton(bar, text="Import CV File", command=self._import_cv_dialog).pack(side="left", padx=4)

        self.cv_text_box = ctk.CTkTextbox(self.view_frame, height=230, fg_color=self.palette["bg_card"], font=("Plus Jakarta Sans", 11))
        self.cv_text_box.pack(fill="x", padx=12, pady=4)
        self.cv_text_box.insert("1.0", cv["raw_text"])

        jd_bar = ctk.CTkFrame(self.view_frame, fg_color="transparent")
        jd_bar.pack(fill="x", padx=12, pady=6)
        self.jd_entry = ctk.CTkEntry(jd_bar, placeholder_text="Paste job description keywords to run offline skill-gap matcher...", width=520)
        self.jd_entry.pack(side="left", padx=(0, 8))
        ctk.CTkButton(jd_bar, text="Offline JD Match", command=self._run_offline_jd_match).pack(side="left")

        self.cv_match_box = ctk.CTkTextbox(self.view_frame, fg_color=self.palette["bg_canvas"], font=("JetBrains Mono", 11))
        self.cv_match_box.pack(fill="both", expand=True, padx=12, pady=(0, 12))

    def _import_cv_dialog(self) -> None:
        path_str = filedialog.askopenfilename(title="Import CV (.pdf, .docx, .txt)")
        if not path_str:
            return
        try:
            ver = self.cv_manager.import_cv_file(Path(path_str))
            messagebox.showinfo(APP_NAME, f"Created CV version: {ver['version_label']}")
            self._render_view("cv")
        except Exception as exc:
            messagebox.showerror(APP_NAME, str(exc))

    def _run_offline_jd_match(self) -> None:
        res = self.cv_manager.compare_with_job_description(self.jd_entry.get())
        lines = [
            f"Offline Match Score: {res.match_percent}%",
            f"Matched Verified Skills: {', '.join(res.matched_skills) or 'None'}",
            f"Missing / Study Keywords: {', '.join(res.missing_keywords) or 'None'}",
            f"Verified Projects: {', '.join(res.verified_projects)}",
            "",
            *res.recommendations,
        ]
        self.cv_match_box.delete("1.0", "end")
        self.cv_match_box.insert("1.0", "\n".join(lines))

    # --- View 5: Memory Vault ---
    def _build_memory_view(self) -> None:
        bar = ctk.CTkFrame(self.view_frame, fg_color="transparent")
        bar.pack(fill="x", padx=12, pady=10)
        self.mem_title_entry = ctk.CTkEntry(bar, placeholder_text="Memory title", width=180)
        self.mem_title_entry.pack(side="left", padx=4)
        self.mem_content_entry = ctk.CTkEntry(bar, placeholder_text="Memory fact/preference", width=320)
        self.mem_content_entry.pack(side="left", padx=4)
        ctk.CTkButton(bar, text="Save Memory", command=self._add_memory).pack(side="left", padx=4)

        self.mem_box = ctk.CTkTextbox(self.view_frame, fg_color=self.palette["bg_card"], font=("Plus Jakarta Sans", 11))
        self.mem_box.pack(fill="both", expand=True, padx=12, pady=(0, 12))
        self._refresh_memories()

    def _add_memory(self) -> None:
        t, c = self.mem_title_entry.get().strip(), self.mem_content_entry.get().strip()
        if t and c:
            self.memory_vault.add_memory(t, c)
            self.mem_title_entry.delete(0, "end")
            self.mem_content_entry.delete(0, "end")
            self._refresh_memories()

    def _refresh_memories(self) -> None:
        mems = self.memory_vault.list_memories()
        self.mem_box.delete("1.0", "end")
        self.mem_box.insert("1.0", "\n".join(f"[{m['id']}] {m['title']}: {m['content']}" for m in mems) or "No memories stored.")

    # --- View 6: Productivity & Tools ---
    def _build_productivity_view(self) -> None:
        bar = ctk.CTkFrame(self.view_frame, fg_color="transparent")
        bar.pack(fill="x", padx=12, pady=10)
        self.task_entry = ctk.CTkEntry(bar, placeholder_text="New task title...", width=240)
        self.task_entry.pack(side="left", padx=4)
        ctk.CTkButton(bar, text="Add Task", command=self._add_task).pack(side="left", padx=4)

        self.calc_entry = ctk.CTkEntry(bar, placeholder_text="Math e.g. sqrt(144) * 5", width=200)
        self.calc_entry.pack(side="left", padx=8)
        ctk.CTkButton(bar, text="Calculate", command=self._run_calc).pack(side="left", padx=4)
        ctk.CTkButton(bar, text="Kigali Weather", command=self._load_weather).pack(side="right", padx=4)

        self.prod_box = ctk.CTkTextbox(self.view_frame, fg_color=self.palette["bg_card"], font=("JetBrains Mono", 11))
        self.prod_box.pack(fill="both", expand=True, padx=12, pady=(0, 12))
        self._refresh_tasks()

    def _add_task(self) -> None:
        t = self.task_entry.get().strip()
        if t:
            self.productivity.create_task(t)
            self.task_entry.delete(0, "end")
            self._refresh_tasks()

    def _refresh_tasks(self) -> None:
        tasks = self.productivity.list_tasks()
        summary = self.productivity.get_weekly_summary()
        lines = [f"Weekly Summary: {summary}", ""] + [f"- [{t['status']}] {t['title']} ({t['priority']})" for t in tasks]
        self.prod_box.delete("1.0", "end")
        self.prod_box.insert("1.0", "\n".join(lines))

    def _run_calc(self) -> None:
        try:
            ans = safe_calculate(self.calc_entry.get())
            messagebox.showinfo(APP_NAME, f"Result: {ans}")
        except Exception as exc:
            messagebox.showerror(APP_NAME, str(exc))

    def _load_weather(self) -> None:
        try:
            w = fetch_kigali_weather()
            messagebox.showinfo(APP_NAME, f"{w['location']}: {w['temperature_c']} C, Wind {w['wind_kmh']} km/h")
        except Exception as exc:
            messagebox.showerror(APP_NAME, str(exc))

    # --- View 7: Web Research ---
    def _build_research_view(self) -> None:
        bar = ctk.CTkFrame(self.view_frame, fg_color="transparent")
        bar.pack(fill="x", padx=12, pady=10)
        self.res_entry = ctk.CTkEntry(bar, placeholder_text="Search verified web sources...", width=420)
        self.res_entry.pack(side="left", padx=4)
        ctk.CTkButton(bar, text="Search Web", command=self._run_research).pack(side="left", padx=4)
        self.res_box = ctk.CTkTextbox(self.view_frame, fg_color=self.palette["bg_card"], font=("Plus Jakarta Sans", 11))
        self.res_box.pack(fill="both", expand=True, padx=12, pady=(0, 12))

    def _run_research(self) -> None:
        try:
            data = self.web_research.search_wikipedia_and_ddg(self.res_entry.get())
            lines = [f"- {s['title']}: {s['url']}\n  {s['snippet']}" for s in data["verified_sources"]]
            self.res_box.delete("1.0", "end")
            self.res_box.insert("1.0", "\n\n".join(lines) or "No verified results found.")
        except Exception as exc:
            messagebox.showerror(APP_NAME, str(exc))

    # --- View 8: System & Security ---
    def _build_system_view(self) -> None:
        bar = ctk.CTkFrame(self.view_frame, fg_color="transparent")
        bar.pack(fill="x", padx=12, pady=10)
        ctk.CTkButton(bar, text="Backup SQLite DB", command=self._backup_db).pack(side="left", padx=4)
        ctk.CTkButton(bar, text="Run Kigali Briefing Plugin", command=self._run_briefing_plugin).pack(side="left", padx=4)
        self.sys_box = ctk.CTkTextbox(self.view_frame, fg_color=self.palette["bg_card"], font=("JetBrains Mono", 11))
        self.sys_box.pack(fill="both", expand=True, padx=12, pady=(0, 12))
        tel = collect_system_telemetry(self.conn)
        logs = self.conn.execute("SELECT action, actor, decision, target, created_at FROM audit_logs ORDER BY id DESC LIMIT 20").fetchall()
        lines = [f"Telemetry: {tel}", "", "--- Recent Security Audit Logs ---"] + [
            f"{l['created_at']} | {l['decision'].upper()} | {l['actor']} | {l['action']} -> {l['target']}" for l in logs
        ]
        self.sys_box.insert("1.0", "\n".join(lines))

    def _backup_db(self) -> None:
        dest = create_backup(self.conn)
        messagebox.showinfo(APP_NAME, f"Backup saved cleanly to:\n{dest}")

    def _run_briefing_plugin(self) -> None:
        res = self.plugin_manager.run_plugin("plug-kigali-brief", {"include_weather": not self.strict_local})
        messagebox.showinfo(APP_NAME, str(res))

    # --- View 8b: Python Media Studio ---
    def _build_media_view(self) -> None:
        bar = ctk.CTkFrame(self.view_frame, fg_color="transparent")
        bar.pack(fill="x", padx=12, pady=10)
        self.media_mode_var = tk.StringVar(value="image")
        ctk.CTkOptionMenu(bar, values=["image", "video"], variable=self.media_mode_var, width=110).pack(side="left", padx=4)
        self.media_aspect_var = tk.StringVar(value="16:9")
        ctk.CTkOptionMenu(bar, values=["16:9", "9:16", "1:1"], variable=self.media_aspect_var, width=90).pack(side="left", padx=4)
        self.media_prompt_entry = ctk.CTkEntry(bar, placeholder_text="Describe the image or video to generate...", width=420)
        self.media_prompt_entry.pack(side="left", fill="x", expand=True, padx=6)
        ctk.CTkButton(bar, text="Generate (Python)", command=self._run_media_generation).pack(side="left", padx=4)
        self.media_status_box = ctk.CTkTextbox(self.view_frame, fg_color=self.palette["bg_card"], font=("JetBrains Mono", 11))
        self.media_status_box.pack(fill="both", expand=True, padx=12, pady=(0, 12))
        self.media_status_box.insert("1.0", "Python Media Studio Ready (gemini-3.1-flash-lite-image / gemini-omni-1.2-flash).\nOutputs save to storage/exports/.\n")

    def _run_media_generation(self) -> None:
        prompt = self.media_prompt_entry.get().strip()
        mode = self.media_mode_var.get()
        aspect = self.media_aspect_var.get()
        if not prompt:
            return
        self.media_status_box.insert("end", f"\nGenerating {mode} ({aspect})...\n")

        def _worker() -> None:
            try:
                if mode == "image":
                    res = self.media_studio.generate_image(prompt, aspect_ratio=aspect)
                else:
                    vid_aspect = aspect if aspect in ("16:9", "9:16") else "16:9"
                    res = self.media_studio.generate_video(prompt, aspect_ratio=vid_aspect)
                self.ui_queue.put(("info_popup", f"Saved {res.media_type} to:\n{res.output_path}"))
            except Exception as exc:
                self.ui_queue.put(("error_popup", str(exc)))

        threading.Thread(target=_worker, daemon=True).start()

    # --- View 9: Settings ---
    def _build_settings_view(self) -> None:
        frame = ctk.CTkFrame(self.view_frame, fg_color="transparent")
        frame.pack(fill="both", expand=True, padx=16, pady=16)

        ctk.CTkLabel(frame, text="Theme Palette:").pack(anchor="w")
        self.theme_opt = ctk.CTkOptionMenu(frame, values=list(THEMES.keys()), command=self._switch_theme)
        self.theme_opt.set(self.theme_key)
        self.theme_opt.pack(anchor="w", pady=(4, 14))

        ctk.CTkLabel(frame, text="Store OpenAI-Compatible API Key in Windows Credential Manager:").pack(anchor="w")
        self.key_entry = ctk.CTkEntry(frame, show="*", width=360, placeholder_text="sk-...")
        self.key_entry.pack(anchor="w", pady=6)
        ctk.CTkButton(frame, text="Save Secret Securely", command=self._save_api_key).pack(anchor="w", pady=4)

    def _switch_theme(self, new_theme: str) -> None:
        self.theme_key = new_theme
        self._set_setting("theme", new_theme)
        self.palette = THEMES.get(new_theme, THEMES["obsidian_dark"])
        ctk.set_appearance_mode("dark" if new_theme == "obsidian_dark" else "light")
        self._render_view("settings")

    def _save_api_key(self) -> None:
        val = self.key_entry.get().strip()
        if not val:
            return
        backend_used = store_secret("OPENAI_API_KEY", val)
        self.key_entry.delete(0, "end")
        self.gatekeeper.log_audit("secret_stored", "user", "OPENAI_API_KEY", "allowed", f"storage={backend_used}")
        messagebox.showinfo(APP_NAME, f"API key stored safely ({backend_used}).")
