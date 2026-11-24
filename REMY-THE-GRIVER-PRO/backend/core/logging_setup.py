"""Structured logging with automatic secret masking."""
from __future__ import annotations

import logging
import re
from logging.handlers import RotatingFileHandler
from pathlib import Path

from backend.core.config import LOGS_DIR, ensure_directories

_SECRET_PATTERNS = (
    (re.compile(r"sk-[A-Za-z0-9_\-]{16,}"), "sk-********MASKED"),
    (re.compile(r"AIza[A-Za-z0-9_\-]{20,}"), "AIza********MASKED"),
    (re.compile(r"ghp_[A-Za-z0-9]{20,}"), "ghp_********MASKED"),
    (re.compile(r"Bearer\s+[A-Za-z0-9\-_.]{12,}", re.IGNORECASE), "Bearer ********MASKED"),
)


def mask_secrets(text: str) -> str:
    if not text:
        return text
    masked = text
    for pattern, replacement in _SECRET_PATTERNS:
        masked = pattern.sub(replacement, masked)
    return masked


class SecretMaskingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = mask_secrets(record.msg)
        if record.args:
            record.args = tuple(mask_secrets(str(a)) if isinstance(a, str) else a for a in record.args)
        return True


def get_logger(name: str = "remy_griver_pro", log_dir: Path | None = None) -> logging.Logger:
    ensure_directories()
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger

    logger.setLevel(logging.INFO)
    target_dir = log_dir or LOGS_DIR
    target_dir.mkdir(parents=True, exist_ok=True)
    formatter = logging.Formatter("%(asctime)s | %(levelname)s | %(name)s | %(message)s")

    file_handler = RotatingFileHandler(target_dir / "app.log", maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    file_handler.setFormatter(formatter)
    file_handler.addFilter(SecretMaskingFilter())

    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)
    stream_handler.addFilter(SecretMaskingFilter())

    logger.addHandler(file_handler)
    logger.addHandler(stream_handler)
    return logger


def setup_logging(log_dir: Path | None = None) -> logging.Logger:
    return get_logger("remy_griver_pro", log_dir=log_dir)

