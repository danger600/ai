"""Application configuration, directory paths, and theme palettes."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - optional in bare stdlib environments
    def load_dotenv(*_args: object, **_kwargs: object) -> bool:
        return False


APP_NAME = "REMY THE GRIVER PRO"
APP_TAGLINE = "Your Personal AI. Your Rules."
APP_VERSION = "1.0.0"
DEVELOPER_NAME = "Remy Nsanzimana"
PERSONAL_BRAND = "BULL MAN — THE BULL MAN ON TOP"
GITHUB_URL = "https://github.com/danger600"

BASE_DIR = Path(__file__).resolve().parents[2]
STORAGE_DIR = BASE_DIR / "storage"
DOCUMENTS_DIR = STORAGE_DIR / "documents"
CV_DIR = STORAGE_DIR / "cv"
EXPORTS_DIR = STORAGE_DIR / "exports"
BACKUPS_DIR = STORAGE_DIR / "backups"
LOGS_DIR = STORAGE_DIR / "logs"
DB_PATH = STORAGE_DIR / "remy_griver_pro.db"

THEMES = {
    "obsidian_dark": {
        "bg_canvas": "#090D16",
        "bg_panel": "#0F172A",
        "bg_card": "#162032",
        "border": "#1E293B",
        "text_primary": "#F8FAFC",
        "text_muted": "#94A3B8",
        "accent_blue": "#2563EB",
        "accent_gold": "#F59E0B",
        "success": "#16A34A",
        "warning": "#D97706",
        "danger": "#DC2626",
    },
    "clean_daylight": {
        "bg_canvas": "#F8FAFC",
        "bg_panel": "#FFFFFF",
        "bg_card": "#F1F5F9",
        "border": "#CBD5E1",
        "text_primary": "#0F172A",
        "text_muted": "#475569",
        "accent_blue": "#1D4ED8",
        "accent_gold": "#D97706",
        "success": "#15803D",
        "warning": "#B45309",
        "danger": "#B91C1C",
    },
}


@dataclass(frozen=True)
class AppConfig:
    openai_api_key: str
    openai_base_url: str
    default_cloud_model: str
    ollama_base_url: str
    default_local_model: str
    theme: str
    language: str


def ensure_directories() -> None:
    for d in (STORAGE_DIR, DOCUMENTS_DIR, CV_DIR, EXPORTS_DIR, BACKUPS_DIR, LOGS_DIR):
        d.mkdir(parents=True, exist_ok=True)


def load_config() -> AppConfig:
    ensure_directories()
    env_file = BASE_DIR / ".env"
    if env_file.exists():
        load_dotenv(env_file)
    return AppConfig(
        openai_api_key=os.getenv("OPENAI_API_KEY", "").strip(),
        openai_base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").strip().rstrip("/"),
        default_cloud_model=os.getenv("DEFAULT_CLOUD_MODEL", "gpt-4o-mini").strip(),
        ollama_base_url=os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").strip().rstrip("/"),
        default_local_model=os.getenv("DEFAULT_LOCAL_MODEL", "llama3").strip(),
        theme=os.getenv("APP_THEME", "obsidian_dark").strip(),
        language=os.getenv("APP_LANGUAGE", "en").strip(),
    )
