"""Main entry point for REMY THE GRIVER PRO (CustomTkinter Desktop GUI & Interactive Python CLI)."""
from __future__ import annotations

import argparse
import json
import sys
import uuid

from backend.agents.orchestrator import AGENTS, AgentOrchestrator
from backend.career.cv_manager import CVManager
from backend.core.ai_engine import HybridAIEngine, format_ai_error_message
from backend.core.config import APP_NAME, APP_TAGLINE, DEVELOPER_NAME, GITHUB_URL, PERSONAL_BRAND, load_config
from backend.core.context_builder import build_global_chat_context, build_local_fallback_reply
from backend.core.logging_setup import setup_logging
from backend.core.security import SecurityGatekeeper
from backend.database.db import init_database
from backend.documents.rag_engine import LocalRAGEngine
from backend.memory.memory_vault import MemoryVault
from backend.tools.system_monitor import collect_system_telemetry


def run_health_check() -> int:
    setup_logging()
    cfg = load_config()
    conn = init_database()
    try:
        gatekeeper = SecurityGatekeeper(conn)
        cv_mgr = CVManager(conn, gatekeeper)
        ai = HybridAIEngine(cfg)
        telemetry = collect_system_telemetry(conn, check_network=False)
        report = {
            "product": APP_NAME,
            "tagline": APP_TAGLINE,
            "developer": DEVELOPER_NAME,
            "brand": PERSONAL_BRAND,
            "github": GITHUB_URL,
            "agents_registered": len(AGENTS),
            "cv_private_locked": cv_mgr.get_primary_cv()["private_locked"],
            "providers": {
                k: {"available": v.available, "details": v.details}
                for k, v in ai.detect_providers().items()
            },
            "system": telemetry,
        }
        print(json.dumps(report, indent=2))
        return 0
    finally:
        conn.close()


def run_cli_shell() -> int:
    setup_logging()
    cfg = load_config()
    conn = init_database()
    gatekeeper = SecurityGatekeeper(conn)
    orchestrator = AgentOrchestrator(gatekeeper)
    ai = HybridAIEngine(cfg)
    vault = MemoryVault(conn, gatekeeper)
    rag = LocalRAGEngine(conn, gatekeeper)
    cv_mgr = CVManager(conn, gatekeeper)

    conv_id = f"conv-{uuid.uuid4().hex[:8]}"
    conn.execute("INSERT INTO conversations (id, title) VALUES (?, ?)", (conv_id, "Python CLI Session"))
    conn.commit()

    print(f"{APP_NAME} — {APP_TAGLINE}")
    print(f"Developer: {DEVELOPER_NAME} | {PERSONAL_BRAND}")
    print("Pure Python Interactive Shell. Ask any question, or type 'health' / 'quit'.")
    try:
        while True:
            try:
                cmd = input("remy-pro> ").strip()
            except EOFError:
                break
            if not cmd:
                continue
            if cmd.lower() in ("quit", "exit", "q"):
                break
            if cmd.lower() == "health":
                run_health_check()
                continue

            agent, reason = orchestrator.route(cmd)
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, agent_id) VALUES (?, ?, 'user', ?, ?)",
                (f"msg-{uuid.uuid4().hex[:8]}", conv_id, cmd, agent.id),
            )
            conn.commit()
            bundle = build_global_chat_context(
                conn=conn,
                gatekeeper=gatekeeper,
                memory_vault=vault,
                rag_engine=rag,
                cv_manager=cv_mgr,
                conversation_id=conv_id,
                prompt=cmd,
                agent_system_prompt=agent.system_prompt,
            )
            print(f"\n[{agent.name}] ({reason})")
            try:
                resp = ai.stream_chat(
                    bundle.messages,
                    on_chunk=lambda c: print(c, end="", flush=True),
                    first_token_timeout_sec=12.0,
                )
                print("\n")
                reply_text = resp.text
            except Exception as exc:
                reply_text = build_local_fallback_reply(cmd, agent.name, bundle, format_ai_error_message(exc))
                print(reply_text + "\n")

            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, agent_id) VALUES (?, ?, 'assistant', ?, ?)",
                (f"msg-{uuid.uuid4().hex[:8]}", conv_id, reply_text, agent.id),
            )
            conn.commit()
        return 0
    finally:
        conn.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=f"{APP_NAME} — {APP_TAGLINE}")
    parser.add_argument("--health-check", action="store_true", help="Print JSON system/DB/security health check and exit.")
    parser.add_argument("--cli", action="store_true", help="Launch interactive Python AI CLI shell.")
    args = parser.parse_args(argv)

    if args.health_check:
        return run_health_check()
    if args.cli:
        return run_cli_shell()

    try:
        from gui.app import RemyGriverProApp
        app = RemyGriverProApp()
        app.mainloop()
        return 0
    except RuntimeError as exc:
        print(f"[GUI Startup Notice] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
