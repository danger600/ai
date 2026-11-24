"""Centralized security gatekeeper: permissions, path traversal, URL validation, credentials, and audit logs."""
from __future__ import annotations

import ipaddress
import os
import sqlite3
import subprocess
from pathlib import Path
from typing import Iterable, Sequence
from urllib.parse import urlparse

from backend.core.logging_setup import get_logger, mask_secrets

try:
    import keyring  # type: ignore
except ImportError:  # pragma: no cover - fallback when keyring not installed
    keyring = None

LOGGER = get_logger("security")
SERVICE_NAME = "REMY_THE_GRIVER_PRO"


class SecurityViolationError(PermissionError):
    """Raised when an operation violates centralized security policy."""


class SecurityGatekeeper:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn

    def log_audit(self, action: str, actor: str, target: str, decision: str, details: str = "") -> None:
        self.conn.execute(
            """
            INSERT INTO audit_logs (action, actor, target, decision, details)
            VALUES (?, ?, ?, ?, ?)
            """,
            (action, actor, mask_secrets(target), decision, mask_secrets(details)),
        )
        self.conn.commit()
        LOGGER.info("audit action=%s actor=%s decision=%s target=%s", action, actor, decision, target)

    def is_permission_granted(self, scope: str) -> bool:
        row = self.conn.execute("SELECT granted FROM permissions WHERE scope = ?", (scope,)).fetchone()
        return bool(row and row[0] == 1)

    def set_permission(self, scope: str, granted: bool, actor: str = "user") -> None:
        self.conn.execute(
            "UPDATE permissions SET granted = ?, updated_at = datetime('now') WHERE scope = ?",
            (1 if granted else 0, scope),
        )
        if scope == "cv.external_ai":
            self.conn.execute(
                "UPDATE cv_profiles SET private_locked = ? WHERE id = 'remy-primary-cv'",
                (0 if granted else 1,),
            )
        self.conn.commit()
        self.log_audit("permission_changed", actor, scope, "allowed" if granted else "denied")

    def require_permission(self, scope: str, actor: str, target: str) -> None:
        if not self.is_permission_granted(scope):
            self.log_audit("permission_blocked", actor, target, "denied", f"Missing scope: {scope}")
            raise SecurityViolationError(f"Action blocked by Security Gatekeeper: permission '{scope}' is not granted.")

    def validate_safe_path(self, base_dir: Path, relative_or_target: str | Path) -> Path:
        raw = str(relative_or_target)
        if not raw or "\x00" in raw:
            self.log_audit("path_validation_failed", "security_gatekeeper", raw, "denied", "Empty or null byte path")
            raise SecurityViolationError("Empty or null-byte path rejected.")
        base = base_dir.resolve()
        candidate = Path(raw)
        resolved = candidate.resolve() if candidate.is_absolute() else (base / candidate).resolve()
        if resolved != base and base not in resolved.parents:
            self.log_audit("path_traversal_blocked", "security_gatekeeper", raw, "denied", f"Outside {base}")
            raise SecurityViolationError(f"Path traversal blocked: '{raw}' escapes approved folder '{base}'.")
        return resolved

    def is_folder_approved(self, target_path: Path) -> bool:
        resolved = target_path.resolve()
        rows = self.conn.execute("SELECT folder_path FROM approved_folders").fetchall()
        for (folder_str,) in rows:
            folder = Path(folder_str).resolve()
            if resolved == folder or folder in resolved.parents:
                return True
        return False

    def validate_safe_url(self, raw_url: str) -> str:
        parsed = urlparse(raw_url.strip())
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise SecurityViolationError("Only valid HTTP/HTTPS URLs are permitted.")
        host = (parsed.hostname or "").lower()
        if host in ("localhost", "127.0.0.1", "0.0.0.0", "::1"):
            self.log_audit("ssrf_blocked", "security_gatekeeper", raw_url, "denied", "Loopback host blocked")
            raise SecurityViolationError("Loopback hosts are blocked by URL security policy.")
        try:
            ip = ipaddress.ip_address(host)
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                self.log_audit("ssrf_blocked", "security_gatekeeper", raw_url, "denied", "Private IP blocked")
                raise SecurityViolationError("Private network IP addresses are blocked.")
        except ValueError:
            pass
        return parsed.geturl()

    def run_approved_command(self, args: Sequence[str], cwd: Path, approved_executable: str) -> subprocess.CompletedProcess[str]:
        """Execute an approved binary strictly with shell=False and explicit allowlist verification."""
        if not args:
            raise SecurityViolationError("Empty command rejected.")
        row = self.conn.execute(
            "SELECT executable_path, allowed FROM approved_apps WHERE app_name = ? OR executable_path = ?",
            (approved_executable, approved_executable),
        ).fetchone()
        if not row or row[1] != 1:
            self.log_audit("command_blocked", "security_gatekeeper", str(args[0]), "denied", "App not in approved_apps")
            raise SecurityViolationError(f"Executable '{approved_executable}' is not approved in Security Center.")
        if not self.is_folder_approved(cwd):
            self.log_audit("cwd_blocked", "security_gatekeeper", str(cwd), "denied", "Working directory not approved")
            raise SecurityViolationError(f"Working directory '{cwd}' is not in approved_folders.")
        self.log_audit("approved_command_exec", "automation", str(args[0]), "allowed", f"cwd={cwd}")
        return subprocess.run(
            list(args),
            cwd=str(cwd),
            shell=False,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )


def store_secret(key_name: str, secret_value: str) -> str:
    """Store secret in OS keyring (Windows Credential Manager) when available, falling back to env only in dev."""
    if keyring is not None:
        try:
            keyring.set_password(SERVICE_NAME, key_name, secret_value)
            return "keyring"
        except Exception as exc:  # pragma: no cover
            LOGGER.warning("Keyring unavailable (%s); using process env only.", exc)
    os.environ[key_name] = secret_value
    return "process_env"


def retrieve_secret(key_name: str) -> str:
    if keyring is not None:
        try:
            val = keyring.get_password(SERVICE_NAME, key_name)
            if val:
                return val
        except Exception:  # pragma: no cover
            pass
    return os.getenv(key_name, "").strip()


def sanitize_filename(name: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in Path(name).name)
    return cleaned or "unnamed_file"
