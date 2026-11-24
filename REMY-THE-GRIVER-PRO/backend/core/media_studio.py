"""Pure Python Media Studio: Gemini Interactions API Text-to-Image & Text-to-Video."""
from __future__ import annotations

import base64
import json
import sqlite3
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from backend.core.ai_engine import format_ai_error_message
from backend.core.config import EXPORTS_DIR, ensure_directories
from backend.core.security import SecurityGatekeeper, retrieve_secret

GEMINI_INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions"


@dataclass
class MediaGenerationResult:
    media_type: str
    model: str
    output_path: Path
    mime_type: str
    aspect_ratio: str
    text_note: str = ""


class PythonMediaStudio:
    """Generates images (gemini-3.1-flash-lite-image) and videos (gemini-omni-1.2-flash) in Python."""

    def __init__(self, conn: sqlite3.Connection, gatekeeper: SecurityGatekeeper) -> None:
        self.conn = conn
        self.gatekeeper = gatekeeper
        ensure_directories()

    def _is_strict_local(self) -> bool:
        row = self.conn.execute("SELECT value FROM app_settings WHERE key = 'strict_local_mode'").fetchone()
        return bool(row and str(row[0]).lower() == "true")

    def _get_api_key(self) -> str:
        key = retrieve_secret("GEMINI_API_KEY")
        if not key or key == "MY_GEMINI_API_KEY":
            raise RuntimeError("GEMINI_API_KEY is not configured in Windows Credential Manager or .env.")
        return key

    def _call_interactions(self, payload: dict[str, Any], timeout_sec: int = 120) -> dict[str, Any]:
        api_key = self._get_api_key()
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            GEMINI_INTERACTIONS_URL,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": api_key,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
                return dict(json.loads(resp.read().decode("utf-8")))
        except urllib.error.HTTPError as err:
            detail = err.read().decode("utf-8", errors="replace").strip()
            raise RuntimeError(format_ai_error_message(detail or f"HTTP {err.code}")) from err
        except (urllib.error.URLError, TimeoutError, OSError) as err:
            raise RuntimeError(f"Media API connection error: {err}") from err

    def generate_image(self, prompt: str, aspect_ratio: str = "1:1") -> MediaGenerationResult:
        clean_prompt = prompt.strip()
        if not clean_prompt:
            raise ValueError("Image prompt cannot be empty.")
        if self._is_strict_local():
            self.gatekeeper.log_audit("strict_local_blocked", "security_gatekeeper", "media.image", "denied", "Strict Local Mode active")
            raise RuntimeError("Strict Local-Only Privacy Mode is active. Disable it to call cloud image generation.")
        if aspect_ratio not in ("1:1", "16:9", "9:16", "4:3", "3:4"):
            raise ValueError("Unsupported aspect ratio. Use 1:1, 16:9, 9:16, 4:3, or 3:4.")

        self.gatekeeper.log_audit("media_image_generate", "user", aspect_ratio, "allowed", clean_prompt[:100])
        data = self._call_interactions(
            {
                "model": "gemini-3.1-flash-lite-image",
                "input": clean_prompt,
                "response_modalities": ["image", "text"],
                "generation_config": {
                    "image_config": {
                        "aspect_ratio": aspect_ratio,
                        "image_size": "1K",
                    }
                },
            },
            timeout_sec=120,
        )

        img_b64 = None
        mime_type = "image/png"
        text_note = str(data.get("output_text") or "")

        out_img = data.get("output_image")
        if isinstance(out_img, dict) and out_img.get("data"):
            img_b64 = str(out_img["data"])
            mime_type = str(out_img.get("mime_type") or "image/png")

        if not img_b64:
            for step in data.get("steps", []) or []:
                if isinstance(step, dict) and step.get("type") == "model_output":
                    for part in step.get("content", []) or []:
                        if isinstance(part, dict) and part.get("type") == "image" and part.get("data") and not img_b64:
                            img_b64 = str(part["data"])
                            mime_type = str(part.get("mime_type") or "image/png")
                        if isinstance(part, dict) and part.get("type") == "text" and part.get("text") and not text_note:
                            text_note = str(part["text"])

        if not img_b64:
            raise RuntimeError("Gemini image API completed without returning image bytes.")

        ext = "jpg" if "jpeg" in mime_type else "png"
        out_path = EXPORTS_DIR / f"remy_image_{uuid.uuid4().hex[:8]}.{ext}"
        out_path.write_bytes(base64.b64decode(img_b64))
        return MediaGenerationResult(
            media_type="image",
            model="gemini-3.1-flash-lite-image",
            output_path=out_path,
            mime_type=mime_type,
            aspect_ratio=aspect_ratio,
            text_note=text_note,
        )

    def generate_video(
        self,
        prompt: str,
        aspect_ratio: str = "16:9",
        duration: str = "8s",
        resolution: str = "720p",
    ) -> MediaGenerationResult:
        clean_prompt = prompt.strip()
        if not clean_prompt:
            raise ValueError("Video prompt cannot be empty.")
        if self._is_strict_local():
            self.gatekeeper.log_audit("strict_local_blocked", "security_gatekeeper", "media.video", "denied", "Strict Local Mode active")
            raise RuntimeError("Strict Local-Only Privacy Mode is active. Disable it to call cloud video generation.")
        if aspect_ratio not in ("16:9", "9:16"):
            raise ValueError("Video aspect_ratio must be '16:9' or '9:16'.")

        self.gatekeeper.log_audit("media_video_generate", "user", f"{aspect_ratio}/{duration}", "allowed", clean_prompt[:100])
        data = self._call_interactions(
            {
                "model": "gemini-omni-1.2-flash",
                "input": clean_prompt,
                "background": False,
                "store": False,
                "stream": False,
                "response_format": {
                    "type": "video",
                    "aspect_ratio": aspect_ratio,
                    "duration": duration,
                    "resolution": resolution,
                },
            },
            timeout_sec=300,
        )

        vid_b64 = None
        mime_type = "video/mp4"
        out_vid = data.get("output_video")
        if isinstance(out_vid, dict) and out_vid.get("data"):
            vid_b64 = str(out_vid["data"])
            mime_type = str(out_vid.get("mime_type") or "video/mp4")

        if not vid_b64:
            for step in data.get("steps", []) or []:
                if isinstance(step, dict) and step.get("type") == "model_output":
                    for part in step.get("content", []) or []:
                        if isinstance(part, dict) and part.get("type") == "video" and part.get("data"):
                            vid_b64 = str(part["data"])
                            mime_type = str(part.get("mime_type") or "video/mp4")
                            break

        if not vid_b64:
            raise RuntimeError("Gemini Omni video API completed without returning video bytes.")

        out_path = EXPORTS_DIR / f"remy_video_{uuid.uuid4().hex[:8]}.mp4"
        out_path.write_bytes(base64.b64decode(vid_b64))
        return MediaGenerationResult(
            media_type="video",
            model="gemini-omni-1.2-flash",
            output_path=out_path,
            mime_type=mime_type,
            aspect_ratio=aspect_ratio,
        )
