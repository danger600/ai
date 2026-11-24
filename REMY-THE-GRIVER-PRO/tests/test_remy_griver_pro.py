"""Comprehensive automated verification suite for REMY THE GRIVER PRO (Python-only codebase)."""
from __future__ import annotations

import json
import sys
import tempfile
import threading
import unittest
import zipfile
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.agents.orchestrator import AGENTS, AgentOrchestrator
from backend.automation.plugin_manager import PluginManager
from backend.career.cv_manager import CVManager, extract_cv_text
from backend.core.ai_engine import HybridAIEngine
from backend.core.config import load_config
from backend.core.logging_setup import mask_secrets
from backend.core.security import SecurityGatekeeper, SecurityViolationError
from backend.database.db import create_backup, get_database_health, init_database, restore_backup
from backend.documents.rag_engine import LocalRAGEngine
from backend.integrations.dev_studio import DevStudioEngine
from backend.memory.memory_vault import MemoryVault
from backend.tools.calculator import convert_unit, safe_calculate
from backend.tools.productivity import ProductivityService
from backend.tools.system_monitor import collect_system_telemetry
from backend.tools.web_research import WebResearchClient
from backend.voice.voice_engine import LANGUAGE_PROFILES, VoiceEngine


class RemyGriverProTestSuite(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = tempfile.TemporaryDirectory(prefix="remy_test_")
        self.tmp_path = Path(self.tmp_dir.name)
        self.db_path = self.tmp_path / "test_remy.db"
        self.conn = init_database(self.db_path)
        self.gatekeeper = SecurityGatekeeper(self.conn)

    def tearDown(self) -> None:
        self.conn.close()
        self.tmp_dir.cleanup()

    def test_01_database_schema_foreign_keys_and_backup_restore(self) -> None:
        fk = self.conn.execute("PRAGMA foreign_keys;").fetchone()[0]
        self.assertEqual(fk, 1)
        health = get_database_health(self.conn, self.db_path)
        self.assertEqual(health["integrity"], "ok")

        backup_path = create_backup(self.conn, self.tmp_path / "backups")
        self.assertTrue(backup_path.exists())
        restore_target = self.tmp_path / "restored.db"
        restore_backup(backup_path, restore_target)
        self.assertTrue(restore_target.exists())

    def test_02_security_gatekeeper_path_ssrf_and_secret_masking(self) -> None:
        with self.assertRaises(SecurityViolationError):
            self.gatekeeper.validate_safe_path(self.tmp_path, "../../Windows/System32/config/SAM")

        safe = self.gatekeeper.validate_safe_path(self.tmp_path, "docs/readme.txt")
        self.assertTrue(str(safe).startswith(str(self.tmp_path.resolve())))

        with self.assertRaises(SecurityViolationError):
            self.gatekeeper.validate_safe_url("http://127.0.0.1:11434/api/tags")
        with self.assertRaises(SecurityViolationError):
            self.gatekeeper.validate_safe_url("http://192.168.1.10/admin")

        valid_url = self.gatekeeper.validate_safe_url("https://github.com/danger600")
        self.assertEqual(valid_url, "https://github.com/danger600")

        masked = mask_secrets("Authorization: Bearer sk-abc1234567890secretKEY999")
        self.assertNotIn("sk-abc1234567890secretKEY999", masked)

    def test_03_private_cv_authenticity_privacy_lock_matching_and_pdf_export(self) -> None:
        cv_mgr = CVManager(self.conn, self.gatekeeper)
        cv = cv_mgr.get_primary_cv()
        self.assertEqual(cv["full_name"], "Remy Nsanzimana")
        self.assertIn("KIVUMU SMART CAMPUS", cv["raw_text"])
        self.assertIn("ICT SMART SOLUTION", cv["raw_text"])
        self.assertTrue(cv["private_locked"])

        # External AI prompt access must fail while private_locked
        with self.assertRaises(SecurityViolationError):
            cv_mgr.build_career_action_prompt("optimize")

        # Offline JD skill-gap matcher still works safely with zero network calls
        jd = "Looking for a Junior Developer skilled in Python, React.js, Node.js, MySQL, and Docker."
        match = cv_mgr.compare_with_job_description(jd)
        self.assertGreater(match.match_percent, 40)
        self.assertIn("Python", match.matched_skills)
        self.assertIn("docker", match.missing_keywords)

        # PDF export produces valid %PDF-1.4 file
        pdf_path = cv_mgr.export_cv_pdf("Test_Remy_CV.pdf")
        try:
            self.assertTrue(pdf_path.exists())
            self.assertTrue(pdf_path.read_bytes().startswith(b"%PDF-1.4"))
        finally:
            pdf_path.unlink(missing_ok=True)

        # Granting permission unlocks career prompt; revoking locks again
        self.gatekeeper.set_permission("cv.external_ai", True)
        msgs = cv_mgr.build_career_action_prompt("skills_analysis")
        self.assertIn("REMY NSANZIMANA", msgs[0]["content"].upper())
        self.gatekeeper.set_permission("cv.external_ai", False)
        self.assertTrue(cv_mgr.get_primary_cv()["private_locked"])

        # Local DOCX extraction via zipfile XML parser
        docx_file = self.tmp_path / "sample_cv.docx"
        with zipfile.ZipFile(docx_file, "w") as zf:
            zf.writestr(
                "word/document.xml",
                '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                "<w:body><w:p><w:r><w:t>Remy Nsanzimana Local DOCX CV</w:t></w:r></w:p></w:body></w:document>",
            )
        extracted = extract_cv_text(docx_file)
        self.assertIn("Remy Nsanzimana Local DOCX CV", extracted)

    def test_04_multi_agent_routing_and_permission_enforcement(self) -> None:
        self.assertEqual(len(AGENTS), 10)
        orch = AgentOrchestrator(self.gatekeeper)

        eng_agent, _ = orch.route("Please debug this python sql bug")
        self.assertEqual(eng_agent.id, "engineering")

        career_agent, _ = orch.route("Analyze my CV for a developer job")
        self.assertEqual(career_agent.id, "career")
        with self.assertRaises(SecurityViolationError):
            orch.verify_agent_permissions(career_agent, "cv_analysis")

    def test_05_local_rag_document_ingestion_and_citations(self) -> None:
        rag = LocalRAGEngine(self.conn, self.gatekeeper)
        sample_csv = self.tmp_path / "kivumu_metrics.csv"
        sample_csv.write_text("Project,Stack,City\nKIVUMU SMART CAMPUS,React Node MySQL,Kigali\nUBUBIKO SMART,Python SQLite,Gasabo\n", encoding="utf-8")

        doc = rag.ingest_file(sample_csv)
        self.assertEqual(doc["filename"], "kivumu_metrics.csv")
        hits = rag.search_chunks("KIVUMU SMART CAMPUS MySQL")
        self.assertTrue(len(hits) >= 1)
        self.assertIn("[kivumu_metrics.csv | CSV Row 2]", hits[0]["citation"])
        rag.delete_document(doc["id"])

    def test_06_memory_vault_controls_and_json_roundtrip(self) -> None:
        vault = MemoryVault(self.conn, self.gatekeeper)
        m = vault.add_memory("Coding Style", "Prefer Python 3.11 type annotations.", category="engineering")
        self.assertEqual(len(vault.get_active_context_memories()), 1)

        vault.set_memory_enabled(False)
        self.assertEqual(vault.get_active_context_memories(), [])
        vault.set_memory_enabled(True)
        self.assertEqual(len(vault.get_active_context_memories()), 1)

        export_file = self.tmp_path / "memories_export.json"
        vault.export_json(export_file)
        vault.delete_memory(m["id"])
        self.assertEqual(len(vault.list_memories()), 0)
        imported = vault.import_json(export_file)
        self.assertEqual(imported, 1)

    def test_07_ast_calculator_productivity_and_telemetry(self) -> None:
        self.assertAlmostEqual(safe_calculate("sqrt(144) + 2 ** 3"), 20.0)
        with self.assertRaises(ValueError):
            safe_calculate("__import__('os').system('echo pwned')")
        self.assertEqual(convert_unit(2.5, "km", "m"), 2500.0)
        self.assertEqual(convert_unit(100, "c", "f"), 212.0)

        prod = ProductivityService(self.conn)
        task = prod.create_task("Verify Python Unit Tests", priority="high")
        prod.update_task_status(task["id"], "done")
        prod.create_note("Architecture Note", "SQLite WAL enabled")
        prod.create_reminder("Backup Check", "2026-12-01 09:00")
        summary = prod.get_weekly_summary()
        self.assertEqual(summary["tasks_done"], 1)
        self.assertEqual(summary["notes_total"], 1)
        self.assertEqual(summary["reminders_pending"], 1)

        tel = collect_system_telemetry(self.conn, self.db_path)
        self.assertEqual(tel["database"]["integrity"], "ok")
        self.assertIn("cpu_percent", tel)

    def test_08_ai_engine_local_check_and_strict_local_enforcement(self) -> None:
        cfg = load_config()
        ai = HybridAIEngine(cfg)
        ollama_status = ai.check_ollama(timeout_sec=0.3)
        self.assertIsInstance(ollama_status.available, bool)

        # Strict local-only rejects web research and GitHub
        self.conn.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('strict_local_mode', 'true')")
        self.conn.commit()
        research = WebResearchClient(self.conn, self.gatekeeper)
        with self.assertRaises(SecurityViolationError):
            research.search_wikipedia_and_ddg("Python")

    def test_09_voice_interruption_plugins_and_dev_studio_sandbox(self) -> None:
        voice = VoiceEngine(self.gatekeeper)
        self.assertTrue(voice.detect_wake_word("Hey Remy, show tasks"))
        self.assertIn("rw", LANGUAGE_PROFILES)
        voice.stop_all()
        self.assertTrue(voice.stop_event.is_set())

        pm = PluginManager(self.conn, self.gatekeeper, plugins_dir=ROOT_DIR / "plugins")
        res = pm.run_plugin("plug-kigali-brief", {"include_weather": False})
        self.assertEqual(res["status"], "ok")
        self.assertIn("BULL MAN", res["output"]["briefing_title"])

        pm.set_plugin_state("plug-kigali-brief", enabled=False)
        with self.assertRaises(SecurityViolationError):
            pm.run_plugin("plug-kigali-brief")

        studio = DevStudioEngine(self.conn, self.gatekeeper)
        analysis = studio.analyze_python_code("import subprocess\nsubprocess.run('dir', shell=True)")
        self.assertTrue(analysis["valid_syntax"])
        self.assertTrue(any("shell=True" in w for w in analysis["warnings"]))

        sql_info = studio.explain_sql_query("DELETE FROM tasks")
        self.assertEqual(sql_info["statement_type"], "DELETE")
        self.assertTrue(any("WHERE" in f for f in sql_info["findings"]))

        sandbox = studio.run_isolated_python("print(6 * 7)")
        self.assertEqual(sandbox.exit_code, 0)
        self.assertEqual(sandbox.stdout.strip(), "42")

        import gui.app as gui_app
        import main as app_main
        self.assertTrue(hasattr(gui_app, "RemyGriverProApp"))
        self.assertTrue(callable(app_main.run_health_check))

    def test_10_global_chat_context_cv_gate_and_503_fallback(self) -> None:
        from backend.core.ai_engine import format_ai_error_message
        from backend.core.context_builder import build_global_chat_context, build_local_fallback_reply

        nested_503 = json.dumps({
            "error": {
                "code": 503,
                "message": json.dumps({
                    "error": {
                        "code": 503,
                        "message": "This model is currently experiencing high demand.",
                        "status": "UNAVAILABLE",
                    }
                }),
                "status": "Service Unavailable",
            }
        })
        clean_msg = format_ai_error_message(nested_503)
        self.assertFalse(clean_msg.startswith("{"))
        self.assertIn("503 Service Unavailable", clean_msg)

        vault = MemoryVault(self.conn, self.gatekeeper)
        vault.add_memory("Preferred Stack", "Python + SQLite + React", category="engineering")
        rag = LocalRAGEngine(self.conn, self.gatekeeper)
        cv_mgr = CVManager(self.conn, self.gatekeeper)

        self.conn.execute("INSERT INTO conversations (id, title) VALUES ('conv-global', 'Global Test')")
        self.conn.commit()

        # Case 1: Include CV requested while cv.external_ai is locked
        locked_bundle = build_global_chat_context(
            conn=self.conn,
            gatekeeper=self.gatekeeper,
            memory_vault=vault,
            rag_engine=rag,
            cv_manager=cv_mgr,
            conversation_id="conv-global",
            prompt="Summarize my memory vault and CV",
            agent_system_prompt="Assistant",
            include_memory=True,
            include_cv=True,
            hide_private=False,
        )
        self.assertEqual(len(locked_bundle.memories_used), 1)
        self.assertTrue(locked_bundle.cv_blocked_by_policy)
        self.assertFalse(locked_bundle.cv_included)

        fallback_locked = build_local_fallback_reply(
            prompt="Summarize my memory vault and CV",
            agent_name="Main Assistant Agent",
            bundle=locked_bundle,
            reason=clean_msg,
        )
        self.assertIn("Preferred Stack", fallback_locked)
        self.assertIn("CV External AI is LOCKED", fallback_locked)

        img_guide = build_local_fallback_reply(
            prompt="how to generate image step by step",
            agent_name="Main Assistant Agent",
            bundle=locked_bundle,
            reason=clean_msg,
        )
        self.assertIn("Step-by-Step Guide: Generating High-Quality Images", img_guide)
        self.assertIn("gemini-3.1-flash-lite-image", img_guide)

        # Case 2: Grant permission -> CV is included cleanly
        self.gatekeeper.set_permission("cv.external_ai", True)
        unlocked_bundle = build_global_chat_context(
            conn=self.conn,
            gatekeeper=self.gatekeeper,
            memory_vault=vault,
            rag_engine=rag,
            cv_manager=cv_mgr,
            conversation_id="conv-global",
            prompt="Analyze my verified CV",
            agent_system_prompt="Career Agent",
            include_memory=True,
            include_cv=True,
            hide_private=False,
        )
        self.assertFalse(unlocked_bundle.cv_blocked_by_policy)
        self.assertTrue(unlocked_bundle.cv_included)
        self.assertIn("KIVUMU SMART CAMPUS", unlocked_bundle.system_prompt)

        # Case 3: hide_private=True suppresses both Memory Vault & CV
        private_hidden_bundle = build_global_chat_context(
            conn=self.conn,
            gatekeeper=self.gatekeeper,
            memory_vault=vault,
            rag_engine=rag,
            cv_manager=cv_mgr,
            conversation_id="conv-global",
            prompt="Hello",
            agent_system_prompt="Assistant",
            include_memory=True,
            include_cv=True,
            hide_private=True,
        )
        self.assertEqual(private_hidden_bundle.memories_used, [])
        self.assertFalse(private_hidden_bundle.cv_included)

    def test_11_two_second_first_token_deadline(self) -> None:
        import http.server
        import time

        class SlowHandler(http.server.BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                time.sleep(2.5)
                self.send_response(200)
                self.end_headers()

            def log_message(self, *_args: object) -> None:
                return

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), SlowHandler)
        port = server.server_address[1]
        t = threading.Thread(target=server.serve_forever, daemon=True)
        t.start()
        try:
            from dataclasses import replace
            cfg = replace(load_config(), openai_api_key="sk-test-12345678901234567890", openai_base_url=f"http://127.0.0.1:{port}")
            engine = HybridAIEngine(cfg)
            start = time.monotonic()
            with self.assertRaises(RuntimeError):
                engine.stream_chat(
                    [{"role": "user", "content": "hello"}],
                    first_token_timeout_sec=0.8,
                )
            elapsed = time.monotonic() - start
            self.assertLess(elapsed, 1.8)
        finally:
            server.shutdown()
            server.server_close()

    def test_12_python_media_studio_validation_and_strict_local(self) -> None:
        from backend.core.media_studio import PythonMediaStudio

        media = PythonMediaStudio(self.conn, self.gatekeeper)
        with self.assertRaises(ValueError):
            media.generate_image("")
        with self.assertRaises(ValueError):
            media.generate_video("Test video", aspect_ratio="1:1")

        self.conn.execute("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('strict_local_mode', 'true')")
        self.conn.commit()
        with self.assertRaises(RuntimeError):
            media.generate_image("A futuristic Kigali skyline", aspect_ratio="16:9")

    def test_13_openai_responses_api_streaming_and_non_streaming(self) -> None:
        import http.server
        import os
        import urllib.request
        from dataclasses import replace

        captured_paths: list[str] = []
        captured_payloads: list[dict[str, object]] = []

        class MockResponsesHandler(http.server.BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                captured_paths.append(self.path)
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length).decode("utf-8"))
                captured_payloads.append(body)

                if body.get("stream"):
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.end_headers()
                    events = (
                        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hello from "}\n\n'
                        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"OpenAI Responses API!"}\n\n'
                        'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"total_tokens":27}}}\n\n'
                    )
                    self.wfile.write(events.encode("utf-8"))
                    self.wfile.flush()
                else:
                    out = json.dumps({
                        "id": "resp_123",
                        "output_text": "Direct Responses API reply",
                        "usage": {"total_tokens": 19},
                    }).encode("utf-8")
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(out)))
                    self.end_headers()
                    self.wfile.write(out)

            def log_message(self, *_args: object) -> None:
                return

        srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), MockResponsesHandler)
        port = srv.server_address[1]
        t = threading.Thread(target=srv.serve_forever, daemon=True)
        t.start()
        old_url = os.environ.get("OPENAI_RESPONSES_URL")
        try:
            os.environ["OPENAI_RESPONSES_URL"] = f"http://127.0.0.1:{port}/v1/responses"
            cfg = replace(load_config(), openai_api_key="sk-test-responses-1234567890", openai_base_url=f"http://127.0.0.1:{port}/v1")
            engine = HybridAIEngine(cfg)

            chunks: list[str] = []
            stream_res = engine.stream_chat(
                [
                    {"role": "system", "content": "You are Remy AI."},
                    {"role": "user", "content": "Say hello"},
                ],
                preferred_provider="openai",
                model="gpt-4o-mini",
                on_chunk=chunks.append,
                first_token_timeout_sec=5.0,
            )
            self.assertEqual(stream_res.provider, "openai_responses")
            self.assertEqual("".join(chunks), "Hello from OpenAI Responses API!")
            self.assertEqual(stream_res.tokens_used, 27)
            self.assertEqual(captured_paths[-1], "/v1/responses")
            self.assertEqual(captured_payloads[-1].get("instructions"), "You are Remy AI.")

            non_stream = engine.generate_text(
                [{"role": "user", "content": "Test non stream"}],
                model="gpt-4o-mini",
                timeout_sec=5.0,
            )
            self.assertEqual(non_stream.text, "Direct Responses API reply")
            self.assertEqual(non_stream.tokens_used, 19)
        finally:
            if old_url is None:
                os.environ.pop("OPENAI_RESPONSES_URL", None)
            else:
                os.environ["OPENAI_RESPONSES_URL"] = old_url
            srv.shutdown()
            srv.server_close()

    def test_14_unified_python_server_http_and_sse_endpoints(self) -> None:
        import urllib.request

        workspace_root = str(ROOT_DIR.parent)
        if workspace_root not in sys.path:
            sys.path.insert(0, workspace_root)
        import server as py_server

        py_server.init_server_runtime(self.tmp_path / "web_runtime.db")
        srv = py_server.ReusableThreadingHTTPServer(("127.0.0.1", 0), py_server.RemyRequestHandler)
        port = srv.server_address[1]
        t = threading.Thread(target=srv.serve_forever, daemon=True)
        t.start()
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=5) as r:
                health = json.loads(r.read().decode("utf-8"))
                self.assertTrue(health["ok"])
                self.assertTrue(health["runtime"].startswith("Python"))
                self.assertEqual(health["openaiResponsesUrl"], "https://api.openai.com/v1/responses")

            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/system/telemetry", timeout=5) as r:
                tel = json.loads(r.read().decode("utf-8"))
                self.assertTrue(tel["telemetry"]["nodeVersion"].startswith("Python "))
                self.assertEqual(tel["dbHealth"]["integrity"], "ok")

            req = urllib.request.Request(
                f"http://127.0.0.1:{port}/api/studio/run-python",
                data=json.dumps({"code": "print(21 * 2)"}).encode("utf-8"),
                method="POST",
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=5) as r:
                py_run = json.loads(r.read().decode("utf-8"))
                self.assertTrue(py_run["allowed"])
                self.assertEqual(py_run["output"], "42")

            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/export/windows-python-bundle", timeout=5) as r:
                zip_bytes = r.read()
                self.assertTrue(zip_bytes.startswith(b"PK"))
        finally:
            srv.shutdown()
            srv.server_close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
