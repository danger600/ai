"""Hybrid AI Engine: OpenAI Responses API (https://api.openai.com/v1/responses) + Gemini Native REST SSE + Ollama local fallback."""
from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable

from backend.core.config import AppConfig, load_config
from backend.core.logging_setup import get_logger
from backend.core.security import retrieve_secret

LOGGER = get_logger("ai_engine")
OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
GEMINI_NATIVE_BASE = "https://generativelanguage.googleapis.com/v1beta"

GEMINI_MODELS = [
    "gemini-4-hydrogen",
    "gemini-3.1-flash-lite",
    "gemini-4-carbon",
    "gemini-4-neon",
]
OPENAI_MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"]


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
    sources: list[dict[str, str]] | None = None


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


def _get_gemini_thinking_level(model: str) -> str:
    if model in ("gemini-4-hydrogen", "gemini-3.1-flash-lite"):
        return "MINIMAL"
    if model == "gemini-4-neon":
        return "LOW"
    return "LOW"


def _is_openai_model(model: str) -> bool:
    low = model.lower().strip()
    return low.startswith(("gpt-", "o1", "o3", "o4", "chatgpt-"))


def _is_gemini_model(model: str) -> bool:
    return model.lower().strip().startswith("gemini-")


def _extract_responses_api_text(data: dict[str, Any]) -> str:
    if isinstance(data.get("output_text"), str) and data["output_text"].strip():
        return str(data["output_text"])
    chunks: list[str] = []
    for item in data.get("output", []) or []:
        if not isinstance(item, dict):
            continue
        for part in item.get("content", []) or []:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                chunks.append(part["text"])
    return "".join(chunks)


class HybridAIEngine:
    def __init__(self, config: AppConfig | None = None) -> None:
        self.config = config or load_config()

    def _get_openai_credentials(self) -> tuple[str, str]:
        api_key = retrieve_secret("OPENAI_API_KEY") or self.config.openai_api_key
        custom_url = os.getenv("OPENAI_RESPONSES_URL", "").strip()
        if custom_url:
            return api_key, custom_url
        base = self.config.openai_base_url.rstrip("/")
        if base.endswith("/responses"):
            return api_key, base
        if base == "https://api.openai.com/v1" or not base:
            return api_key, OPENAI_RESPONSES_URL
        return api_key, f"{base}/responses"

    def _get_gemini_key(self) -> str:
        key = retrieve_secret("GEMINI_API_KEY")
        if key and key != "MY_GEMINI_API_KEY":
            return key
        return ""

    def _resolve_cloud_credentials(self) -> tuple[str, str, list[str]]:
        openai_key, openai_url = self._get_openai_credentials()
        if openai_key:
            return openai_key, openai_url, OPENAI_MODELS
        gemini_key = self._get_gemini_key()
        if gemini_key:
            return gemini_key, GEMINI_NATIVE_BASE, GEMINI_MODELS
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
        openai_key, openai_url = self._get_openai_credentials()
        gemini_key = self._get_gemini_key()
        if openai_key:
            return ProviderStatus(
                name="openai_responses",
                available=True,
                models=OPENAI_MODELS,
                details=f"Configured OpenAI Responses API at {openai_url}",
            )
        if gemini_key:
            return ProviderStatus(
                name="gemini_native",
                available=True,
                models=GEMINI_MODELS,
                details=f"Configured Gemini REST endpoint {GEMINI_NATIVE_BASE}",
            )
        return ProviderStatus(
            name="openai_responses",
            available=False,
            models=[],
            details="OPENAI_API_KEY / GEMINI_API_KEY not configured in Credential Manager or .env",
        )

    def check_openai_responses(self) -> ProviderStatus:
        openai_key, openai_url = self._get_openai_credentials()
        return ProviderStatus(
            name="openai_responses",
            available=bool(openai_key),
            models=OPENAI_MODELS if openai_key else [],
            details=openai_url if openai_key else "OPENAI_API_KEY not configured",
        )

    def check_gemini_cloud(self) -> ProviderStatus:
        gemini_key = self._get_gemini_key()
        return ProviderStatus(
            name="gemini",
            available=bool(gemini_key),
            models=GEMINI_MODELS if gemini_key else [],
            details=GEMINI_NATIVE_BASE if gemini_key else "GEMINI_API_KEY not configured",
        )

    def detect_providers(self) -> dict[str, ProviderStatus]:
        return {
            "cloud": self.check_openai_cloud(),
            "openai": self.check_openai_responses(),
            "gemini": self.check_gemini_cloud(),
            "local": self.check_ollama(),
        }

    def generate_text(
        self,
        messages: list[dict[str, str]],
        model: str | None = None,
        timeout_sec: float = 20.0,
        use_google_search: bool = False,
    ) -> AIResponse:
        return self.stream_chat(
            messages=messages,
            model=model,
            on_chunk=None,
            first_token_timeout_sec=timeout_sec,
            use_google_search=use_google_search,
        )

    def stream_chat(
        self,
        messages: list[dict[str, str]],
        preferred_provider: str = "auto",
        model: str | None = None,
        cancel_event: threading.Event | None = None,
        strict_local_only: bool = False,
        on_chunk: Callable[[str], None] | None = None,
        first_token_timeout_sec: float = 1.9,
        use_google_search: bool = False,
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

        openai_key, openai_url = self._get_openai_credentials()
        gemini_key = self._get_gemini_key()

        candidate_calls: list[tuple[str, str]] = []
        requested = (model or "").strip()

        if preferred_provider == "openai" or (requested and _is_openai_model(requested)):
            if openai_key:
                ordered_openai = ([requested] if requested in OPENAI_MODELS else [requested] if requested else []) + [
                    m for m in OPENAI_MODELS if m != requested
                ]
                for m in ordered_openai:
                    candidate_calls.append(("openai_responses", m))
            if gemini_key and not use_google_search:
                for m in GEMINI_MODELS[:2]:
                    candidate_calls.append(("gemini", m))
        elif preferred_provider == "gemini" or (requested and _is_gemini_model(requested)):
            if gemini_key:
                ordered_gemini = ([requested] if requested in GEMINI_MODELS else [requested] if requested else []) + [
                    m for m in GEMINI_MODELS if m != requested
                ]
                for m in ordered_gemini:
                    candidate_calls.append(("gemini", m))
            if openai_key and not use_google_search:
                for m in OPENAI_MODELS[:2]:
                    candidate_calls.append(("openai_responses", m))
        else:
            if openai_key and not use_google_search:
                for m in OPENAI_MODELS:
                    candidate_calls.append(("openai_responses", m))
            if gemini_key:
                for m in GEMINI_MODELS:
                    candidate_calls.append(("gemini", m))

        if candidate_calls:
            deadline = time.monotonic() + first_token_timeout_sec
            last_err: Exception | None = None

            for idx, (backend_kind, candidate_model) in enumerate(candidate_calls):
                remaining = deadline - time.monotonic()
                if remaining <= 0.15:
                    break
                slice_timeout = min(remaining, max(0.85, remaining * 0.6)) if idx == 0 else remaining
                try:
                    if backend_kind == "openai_responses":
                        return self._call_with_backoff(
                            lambda m=candidate_model, t=slice_timeout: self._stream_openai_responses(
                                messages=messages,
                                model=m,
                                cancel=cancel,
                                on_chunk=on_chunk,
                                responses_url=openai_url,
                                api_key=openai_key,
                                request_timeout_sec=t,
                            ),
                            cancel=cancel,
                            deadline=deadline,
                            max_retries=0 if first_token_timeout_sec <= 2.5 else 1,
                        )
                    return self._call_with_backoff(
                        lambda m=candidate_model, t=slice_timeout: self._stream_gemini_native(
                            messages=messages,
                            model=m,
                            cancel=cancel,
                            on_chunk=on_chunk,
                            api_key=gemini_key,
                            request_timeout_sec=t,
                            use_google_search=use_google_search,
                        ),
                        cancel=cancel,
                        deadline=deadline,
                        max_retries=0 if first_token_timeout_sec <= 2.5 else 1,
                    )
                except Exception as cloud_err:
                    last_err = cloud_err
                    LOGGER.warning("Cloud model %s (%s) failed (%s); fast fallback.", candidate_model, backend_kind, format_ai_error_message(cloud_err))
                    if cancel.is_set():
                        raise

            if providers["local"].available:
                return self._stream_ollama(messages, self.config.default_local_model, cancel, on_chunk)
            if last_err is not None:
                raise RuntimeError(format_ai_error_message(last_err)) from last_err
            raise RuntimeError("Cloud AI did not reply within deadline; delivered instant local context fallback.")

        if providers["local"].available:
            return self._stream_ollama(messages, model or self.config.default_local_model, cancel, on_chunk)

        raise RuntimeError(
            "No active AI provider found. Configure OPENAI_API_KEY (https://api.openai.com/v1/responses) or GEMINI_API_KEY, or start Ollama locally."
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

    def _stream_openai_responses(
        self,
        messages: list[dict[str, str]],
        model: str,
        cancel: threading.Event,
        on_chunk: Callable[[str], None] | None,
        responses_url: str,
        api_key: str,
        request_timeout_sec: float = 15.0,
    ) -> AIResponse:
        """Call OpenAI Responses API (https://api.openai.com/v1/responses) with SSE streaming."""
        system_parts = [m["content"] for m in messages if m.get("role") == "system" and m.get("content")]
        input_items = [
            {"role": m["role"], "content": m["content"]}
            for m in messages
            if m.get("role") in ("user", "assistant") and str(m.get("content", "")).strip()
        ]
        if not input_items:
            input_items = [{"role": "user", "content": "Hello"}]

        stream_mode = on_chunk is not None
        payload: dict[str, Any] = {
            "model": model,
            "input": input_items,
            "stream": stream_mode,
        }
        if system_parts:
            payload["instructions"] = "\n\n".join(system_parts)

        req = urllib.request.Request(
            responses_url,
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
        )

        if not stream_mode:
            with urllib.request.urlopen(req, timeout=max(0.3, request_timeout_sec)) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                combined = _extract_responses_api_text(data)
                usage_tokens = int(data.get("usage", {}).get("total_tokens", 0) or 0)
                tokens = usage_tokens or max(1, (sum(len(m["content"]) for m in messages) + len(combined)) // 4)
                return AIResponse(text=combined, provider="openai_responses", model=model, tokens_used=tokens)

        full_text: list[str] = []
        cancelled = False
        usage_tokens = 0
        current_event = ""

        with urllib.request.urlopen(req, timeout=max(0.3, request_timeout_sec)) as resp:
            for raw_line in resp:
                if cancel.is_set():
                    cancelled = True
                    break
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line:
                    current_event = ""
                    continue
                if line.startswith("event: "):
                    current_event = line[7:].strip()
                    continue
                if not line.startswith("data: "):
                    continue
                payload_str = line[6:].strip()
                if payload_str == "[DONE]":
                    break
                try:
                    event_data = json.loads(payload_str)
                except json.JSONDecodeError:
                    continue

                ev_type = str(event_data.get("type") or current_event)
                if ev_type == "response.output_text.delta":
                    delta = str(event_data.get("delta") or "")
                    if delta:
                        full_text.append(delta)
                        if on_chunk:
                            on_chunk(delta)
                elif ev_type == "response.output_text.done" and not full_text:
                    done_text = str(event_data.get("text") or "")
                    if done_text:
                        full_text.append(done_text)
                        if on_chunk:
                            on_chunk(done_text)
                elif ev_type in ("response.completed", "response.done"):
                    resp_obj = event_data.get("response", {})
                    if isinstance(resp_obj, dict):
                        usage_tokens = int(resp_obj.get("usage", {}).get("total_tokens", 0) or 0)
                        if not full_text:
                            extracted = _extract_responses_api_text(resp_obj)
                            if extracted:
                                full_text.append(extracted)
                                if on_chunk:
                                    on_chunk(extracted)
                elif ev_type in ("error", "response.failed"):
                    err_msg = event_data.get("message") or event_data.get("response", {}).get("error", {}).get("message") or "OpenAI Responses stream error"
                    raise RuntimeError(str(err_msg))
                elif "choices" in event_data:
                    delta = event_data.get("choices", [{}])[0].get("delta", {}).get("content")
                    if delta:
                        full_text.append(delta)
                        if on_chunk:
                            on_chunk(delta)

        combined = "".join(full_text)
        tokens = usage_tokens or max(1, (sum(len(m["content"]) for m in messages) + len(combined)) // 4)
        return AIResponse(text=combined, provider="openai_responses", model=model, tokens_used=tokens, cancelled=cancelled)

    def _stream_gemini_native(
        self,
        messages: list[dict[str, str]],
        model: str,
        cancel: threading.Event,
        on_chunk: Callable[[str], None] | None,
        api_key: str,
        request_timeout_sec: float = 15.0,
        use_google_search: bool = False,
    ) -> AIResponse:
        system_parts = [m["content"] for m in messages if m.get("role") == "system" and m.get("content")]
        contents = []
        for m in messages:
            role = m.get("role")
            txt = str(m.get("content", "")).strip()
            if role in ("user", "assistant") and txt:
                contents.append(
                    {
                        "role": "model" if role == "assistant" else "user",
                        "parts": [{"text": txt}],
                    }
                )
        if not contents:
            contents = [{"role": "user", "parts": [{"text": "Hello"}]}]

        payload: dict[str, Any] = {
            "contents": contents,
            "generationConfig": {
                "thinkingConfig": {"thinkingLevel": _get_gemini_thinking_level(model)},
            },
        }
        if system_parts:
            payload["systemInstruction"] = {"parts": [{"text": "\n\n".join(system_parts)}]}
        if use_google_search:
            payload["tools"] = [{"google_search": {}}]

        safe_model = urllib.parse.quote(model, safe="-.")
        stream_mode = on_chunk is not None and not use_google_search
        action = "streamGenerateContent?alt=sse" if stream_mode else "generateContent"
        url = f"{GEMINI_NATIVE_BASE}/models/{safe_model}:{action}"

        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": api_key,
            },
        )

        sources: list[dict[str, str]] = []
        if not stream_mode:
            with urllib.request.urlopen(req, timeout=max(0.3, request_timeout_sec)) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                candidates = data.get("candidates", []) or []
                parts = candidates[0].get("content", {}).get("parts", []) if candidates else []
                combined = "".join(str(p.get("text", "")) for p in parts if isinstance(p, dict))
                if candidates:
                    grounding = candidates[0].get("groundingMetadata", {}) or {}
                    for g in grounding.get("groundingChunks", []) or []:
                        web = g.get("web") if isinstance(g, dict) else None
                        if isinstance(web, dict) and web.get("uri"):
                            sources.append({"title": str(web.get("title") or web["uri"]), "uri": str(web["uri"])})
                if combined and on_chunk:
                    on_chunk(combined)
                tokens = max(1, (sum(len(m["content"]) for m in messages) + len(combined)) // 4)
                return AIResponse(text=combined, provider="gemini", model=model, tokens_used=tokens, sources=sources)

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
                payload_str = line[6:].strip()
                if not payload_str or payload_str == "[DONE]":
                    continue
                try:
                    chunk = json.loads(payload_str)
                except json.JSONDecodeError:
                    continue
                candidates = chunk.get("candidates", []) or []
                if not candidates:
                    continue
                parts = candidates[0].get("content", {}).get("parts", []) or []
                delta = "".join(str(p.get("text", "")) for p in parts if isinstance(p, dict) and p.get("text"))
                if delta:
                    full_text.append(delta)
                    if on_chunk:
                        on_chunk(delta)

        combined = "".join(full_text)
        tokens = max(1, (sum(len(m["content"]) for m in messages) + len(combined)) // 4)
        return AIResponse(text=combined, provider="gemini", model=model, tokens_used=tokens, cancelled=cancelled, sources=sources)

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
