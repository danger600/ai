"""Hybrid AI Engine: OpenAI/Gemini-compatible cloud + Ollama local fallback + streaming + retry + model fallback + cancellation."""
from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Callable

from backend.core.config import AppConfig, load_config
from backend.core.logging_setup import get_logger
from backend.core.security import retrieve_secret

LOGGER = get_logger("ai_engine")
GEMINI_OPENAI_COMPAT_BASE = "https://generativelanguage.googleapis.com/v1beta/openai"


@dataclass
class ProviderStatus:
    name: str
    available: bool
    models: list[str]
    details: str


@dataclass
class AIResponse:
    text: str
    provider: str
    model: str
    tokens_used: int
    cancelled: bool = False


def format_ai_error_message(err: Exception | str) -> str:
    """Unwrap nested JSON error payloads (such as 503 UNAVAILABLE) into clean user-readable messages."""
    raw = str(err or "Unknown AI provider error").strip()
    for _ in range(3):
        if raw.startswith("{"):
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, dict):
                    err_obj = parsed.get("error")
                    if isinstance(err_obj, dict) and err_obj.get("message"):
                        raw = str(err_obj["message"]).strip()
                        continue
                    if parsed.get("message"):
                        raw = str(parsed["message"]).strip()
                        continue
            except json.JSONDecodeError:
                break
        break

    upper = raw.upper()
    lower = raw.lower()
    if "503" in raw or "UNAVAILABLE" in upper or "high demand" in lower:
        return "Cloud AI model is temporarily experiencing high demand (503 Service Unavailable). Automatic fallback was attempted."
    if "429" in raw or "RESOURCE_EXHAUSTED" in upper or "rate limit" in lower:
        return "Cloud AI rate limit reached (429). Retry shortly or use local Ollama."
    if "401" in raw or "403" in raw or "api key" in lower:
        return "Cloud AI authentication error. Verify your API key in Credential Manager or .env."
    return raw


class HybridAIEngine:
    def __init__(self, config: AppConfig | None = None) -> None:
        self.config = config or load_config()

    def _resolve_cloud_credentials(self) -> tuple[str, str, list[str]]:
        openai_key = retrieve_secret("OPENAI_API_KEY") or self.config.openai_api_key
        if openai_key:
            return openai_key, self.config.openai_base_url, ["gpt-4o-mini", "gpt-4o"]
        gemini_key = retrieve_secret("GEMINI_API_KEY")
        if gemini_key and gemini_key != "MY_GEMINI_API_KEY":
            return gemini_key, GEMINI_OPENAI_COMPAT_BASE, [
                "gemini-4-hydrogen",
                "gemini-3.1-flash-lite",
                "gemini-4-carbon",
                "gemini-4-neon",
            ]
        return "", self.config.openai_base_url, []

    def check_ollama(self, timeout_sec: float = 1.5) -> ProviderStatus:
        url = f"{self.config.ollama_base_url}/api/tags"
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
                models = [m.get("name", "") for m in payload.get("models", []) if m.get("name")]
                return ProviderStatus(
                    name="ollama",
                    available=True,
                    models=models,
                    details=f"Connected at {self.config.ollama_base_url}",
                )
        except Exception as exc:
            return ProviderStatus(
                name="ollama",
                available=False,
                models=[],
                details=f"Ollama unavailable at {self.config.ollama_base_url}: {exc}",
            )

    def check_openai_cloud(self) -> ProviderStatus:
        api_key, base_url, models = self._resolve_cloud_credentials()
        if not api_key:
            return ProviderStatus(
                name="openai_compatible",
                available=False,
                models=[],
                details="OPENAI_API_KEY / GEMINI_API_KEY not configured in Windows Credential Manager or .env",
            )
        return ProviderStatus(
            name="openai_compatible",
            available=True,
            models=models,
            details=f"Configured endpoint {base_url}",
        )

    def detect_providers(self) -> dict[str, ProviderStatus]:
        return {
            "cloud": self.check_openai_cloud(),
            "local": self.check_ollama(),
        }

    def stream_chat(
        self,
        messages: list[dict[str, str]],
        preferred_provider: str = "auto",
        model: str | None = None,
        cancel_event: threading.Event | None = None,
        strict_local_only: bool = False,
        on_chunk: Callable[[str], None] | None = None,
        first_token_timeout_sec: float = 1.9,
    ) -> AIResponse:
        cancel = cancel_event or threading.Event()
        providers = self.detect_providers()

        if strict_local_only:
            if not providers["local"].available:
                raise RuntimeError("Strict Local-Only Mode is active, and no local Ollama daemon was detected.")
            return self._stream_ollama(messages, model or self.config.default_local_model, cancel, on_chunk)

        if preferred_provider == "ollama":
            if not providers["local"].available:
                raise RuntimeError(providers["local"].details)
            return self._stream_ollama(messages, model or self.config.default_local_model, cancel, on_chunk)

        if providers["cloud"].available:
            _, base_url, default_models = self._resolve_cloud_credentials()
            primary = model or (default_models[0] if default_models else self.config.default_cloud_model)
            candidates = [primary] + [m for m in default_models if m != primary]
            deadline = time.monotonic() + first_token_timeout_sec
            last_err: Exception | None = None

            for idx, candidate_model in enumerate(candidates):
                remaining = deadline - time.monotonic()
                if remaining <= 0.15:
                    break
                slice_timeout = min(remaining, max(0.85, remaining * 0.6)) if idx == 0 else remaining
                try:
                    return self._call_with_backoff(
                        lambda m=candidate_model, t=slice_timeout: self._stream_openai_compatible(
                            messages,
                            m,
                            cancel,
                            on_chunk,
                            base_url=base_url,
                            request_timeout_sec=t,
                        ),
                        cancel=cancel,
                        deadline=deadline,
                        max_retries=0 if first_token_timeout_sec <= 2.5 else 1,
                    )
                except Exception as cloud_err:
                    last_err = cloud_err
                    LOGGER.warning("Cloud model %s failed (%s); fast fallback.", candidate_model, format_ai_error_message(cloud_err))
                    if cancel.is_set():
                        raise

            if providers["local"].available:
                return self._stream_ollama(messages, self.config.default_local_model, cancel, on_chunk)
            if last_err is not None:
                raise RuntimeError(format_ai_error_message(last_err)) from last_err
            raise RuntimeError("Cloud AI did not reply within 2 seconds; delivered instant local context fallback.")

        if providers["local"].available:
            return self._stream_ollama(messages, model or self.config.default_local_model, cancel, on_chunk)

        raise RuntimeError(
            "No active AI provider found. Configure OPENAI_API_KEY / GEMINI_API_KEY in Credential Manager/.env or start Ollama locally."
        )

    def _call_with_backoff(
        self,
        fn: Callable[[], AIResponse],
        cancel: threading.Event,
        deadline: float | None = None,
        max_retries: int = 1,
    ) -> AIResponse:
        attempt = 0
        while True:
            if cancel.is_set():
                raise RuntimeError("Generation cancelled by user.")
            if deadline is not None and time.monotonic() >= deadline:
                raise RuntimeError("Cloud AI did not reply within 2 seconds; delivered instant local context fallback.")
            try:
                return fn()
            except urllib.error.HTTPError as err:
                body_detail = ""
                try:
                    body_detail = err.read().decode("utf-8", errors="replace").strip()
                except Exception:
                    body_detail = ""
                clean_detail = format_ai_error_message(body_detail or f"HTTP {err.code}: {err.reason}")
                if err.code not in (429, 500, 502, 503, 504) or attempt >= max_retries:
                    raise RuntimeError(clean_detail) from err
                delay = min(0.15, max(0.0, (deadline - time.monotonic()) * 0.25)) if deadline else 0.15
                if delay > 0 and cancel.wait(delay):
                    raise RuntimeError("Generation cancelled by user.") from err
                attempt += 1
            except (urllib.error.URLError, TimeoutError, OSError) as err:
                if attempt >= max_retries:
                    raise RuntimeError(f"Network/timeout error contacting AI provider: {err}") from err
                delay = 0.1
                if cancel.wait(delay):
                    raise RuntimeError("Generation cancelled by user.") from err
                attempt += 1

    def _stream_openai_compatible(
        self,
        messages: list[dict[str, str]],
        model: str,
        cancel: threading.Event,
        on_chunk: Callable[[str], None] | None,
        base_url: str | None = None,
        request_timeout_sec: float = 1.9,
    ) -> AIResponse:
        api_key, resolved_base, _ = self._resolve_cloud_credentials()
        target_base = (base_url or resolved_base).rstrip("/")
        body = json.dumps({"model": model, "messages": messages, "stream": True}).encode("utf-8")
        req = urllib.request.Request(
            f"{target_base}/chat/completions",
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
        )
        full_text: list[str] = []
        cancelled = False
        with urllib.request.urlopen(req, timeout=max(0.3, request_timeout_sec)) as resp:
            for raw_line in resp:
                if cancel.is_set():
                    cancelled = True
                    break
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line.startswith("data: "):
                    continue
                payload_str = line[6:]
                if payload_str == "[DONE]":
                    break
                chunk = json.loads(payload_str)
                delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content")
                if delta:
                    full_text.append(delta)
                    if on_chunk:
                        on_chunk(delta)

        combined = "".join(full_text)
        tokens = max(1, (sum(len(m["content"]) for m in messages) + len(combined)) // 4)
        return AIResponse(text=combined, provider="openai_compatible", model=model, tokens_used=tokens, cancelled=cancelled)

    def _stream_ollama(
        self,
        messages: list[dict[str, str]],
        model: str,
        cancel: threading.Event,
        on_chunk: Callable[[str], None] | None,
    ) -> AIResponse:
        body = json.dumps({"model": model, "messages": messages, "stream": True}).encode("utf-8")
        req = urllib.request.Request(
            f"{self.config.ollama_base_url}/api/chat",
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        full_text: list[str] = []
        cancelled = False
        with urllib.request.urlopen(req, timeout=120) as resp:
            for raw_line in resp:
                if cancel.is_set():
                    cancelled = True
                    break
                data = json.loads(raw_line.decode("utf-8", errors="replace"))
                delta = data.get("message", {}).get("content", "")
                if delta:
                    full_text.append(delta)
                    if on_chunk:
                        on_chunk(delta)
                if data.get("done"):
                    break

        combined = "".join(full_text)
        tokens = max(1, (sum(len(m["content"]) for m in messages) + len(combined)) // 4)
        return AIResponse(text=combined, provider="ollama", model=model, tokens_used=tokens, cancelled=cancelled)
