"""Developer Studio: AST static analysis, SQL explainer, and isolated Python execution (shell=False)."""
from __future__ import annotations

import ast
import sqlite3
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from backend.core.security import SecurityGatekeeper


@dataclass
class SandboxResult:
    exit_code: int
    stdout: str
    stderr: str
    timed_out: bool = False


class DevStudioEngine:
    def __init__(self, conn: sqlite3.Connection, gatekeeper: SecurityGatekeeper) -> None:
        self.conn = conn
        self.gatekeeper = gatekeeper

    def analyze_python_code(self, code: str) -> dict[str, Any]:
        """Parse Python code safely with AST to inspect imports, functions, classes, and syntax validity."""
        try:
            tree = ast.parse(code)
        except SyntaxError as exc:
            return {
                "valid_syntax": False,
                "error": f"Line {exc.lineno}: {exc.msg}",
                "functions": [],
                "classes": [],
                "imports": [],
            }

        functions = [node.name for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))]
        classes = [node.name for node in ast.walk(tree) if isinstance(node, ast.ClassDef)]
        imports: list[str] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imports.append(node.module)

        warnings: list[str] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                if node.func.id in ("eval", "exec"):
                    warnings.append(f"Avoid dynamic '{node.func.id}()' on untrusted inputs.")
            if isinstance(node, ast.keyword) and node.arg == "shell":
                if isinstance(node.value, ast.Constant) and node.value.value is True:
                    warnings.append("Security finding: subprocess call uses shell=True.")

        return {
            "valid_syntax": True,
            "functions": functions,
            "classes": classes,
            "imports": sorted(set(imports)),
            "warnings": warnings,
        }

    def explain_sql_query(self, sql_query: str) -> dict[str, Any]:
        cleaned = " ".join(sql_query.strip().split())
        upper = cleaned.upper()
        statement_type = upper.split(" ", 1)[0] if upper else "EMPTY"
        findings: list[str] = []
        if "SELECT *" in upper:
            findings.append("Uses SELECT *; prefer explicit columns in production queries.")
        if ("UPDATE " in upper or "DELETE " in upper) and "WHERE " not in upper:
            findings.append("Critical: UPDATE/DELETE without WHERE clause affects every row.")
        if "JOIN " in upper:
            findings.append("Contains JOIN; verify foreign key indexes exist on join columns.")
        return {"statement_type": statement_type, "summary": cleaned[:180], "findings": findings}

    def run_isolated_python(self, code: str, timeout_sec: float = 5.0) -> SandboxResult:
        """Execute user-approved Python snippet inside an isolated temp directory with -I flag and shell=False."""
        self.gatekeeper.require_permission("studio.sandbox_exec", actor="dev_studio", target="python_sandbox")
        with tempfile.TemporaryDirectory(prefix="remy_sandbox_") as tmpdir:
            script_path = Path(tmpdir) / "snippet.py"
            script_path.write_text(code, encoding="utf-8")
            self.gatekeeper.log_audit("sandbox_python_run", "dev_studio", "snippet.py", "allowed", f"bytes={len(code)}")
            try:
                proc = subprocess.run(
                    [sys.executable, "-I", str(script_path)],
                    cwd=tmpdir,
                    shell=False,
                    capture_output=True,
                    text=True,
                    timeout=timeout_sec,
                    check=False,
                )
                return SandboxResult(exit_code=proc.returncode, stdout=proc.stdout, stderr=proc.stderr)
            except subprocess.TimeoutExpired as exc:
                return SandboxResult(
                    exit_code=124,
                    stdout=exc.stdout.decode("utf-8", errors="replace") if isinstance(exc.stdout, bytes) else (exc.stdout or ""),
                    stderr=f"Execution timed out after {timeout_sec}s.",
                    timed_out=True,
                )
