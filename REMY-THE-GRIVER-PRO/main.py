"""Main entry point for REMY THE GRIVER PRO (CustomTkinter Desktop GUI & CLI Diagnostics)."""
from __future__ import annotations

import argparse
import json
import sys

from backend.agents.orchestrator import AGENTS
from backend.career.cv_manager import CVManager
from backend.core.ai_engine import HybridAIEngine
from backend.core.config import APP_NAME, APP_TAGLINE, DEVELOPER_NAME, GITHUB_URL, PERSONAL_BRAND, load_config
from backend.core.logging_setup import setup_logging
from backend.core.security import SecurityGatekeeper
from backend.database.db import init_database
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
    conn = init_database()
    print(f"{APP_NAME} — {APP_TAGLINE}")
    print(f"Developer: {DEVELOPER_NAME} | {PERSONAL_BRAND}")
    print("CLI Diagnostics Mode. Type 'health' or 'quit'.")
    try:
        while True:
            try:
                cmd = input("remy-pro> ").strip().lower()
            except EOFError:
                break
            if cmd in ("quit", "exit", "q"):
                break
            if cmd == "health":
                run_health_check()
            elif cmd:
                print(f"Command '{cmd}' recognized. Launch full GUI on Windows via `python main.py`.")
        return 0
    finally:
        conn.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=f"{APP_NAME} — {APP_TAGLINE}")
    parser.add_argument("--health-check", action="store_true", help="Print JSON system/DB/security health check and exit.")
    parser.add_argument("--cli", action="store_true", help="Launch interactive CLI diagnostic shell.")
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
