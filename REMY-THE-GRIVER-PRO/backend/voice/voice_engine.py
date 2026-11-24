"""Voice Intelligence: STT/TTS engine abstraction with language support, wake-word detection, and instant Esc stop."""
from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any

from backend.core.logging_setup import get_logger
from backend.core.security import SecurityGatekeeper

try:
    import speech_recognition as sr  # type: ignore
except ImportError:  # pragma: no cover
    sr = None

try:
    import pyttsx3  # type: ignore
except ImportError:  # pragma: no cover
    pyttsx3 = None

LOGGER = get_logger("voice")

LANGUAGE_PROFILES: dict[str, dict[str, str]] = {
    "en": {"label": "English", "stt_code": "en-US", "note": "Full offline & online voice support."},
    "fr": {"label": "French", "stt_code": "fr-FR", "note": "Standard French STT & Windows SAPI TTS where voice pack is installed."},
    "sw": {"label": "Swahili", "stt_code": "sw-KE", "note": "Online STT supported; Windows local TTS voice depends on installed OS packs."},
    "rw": {
        "label": "Kinyarwanda",
        "stt_code": "rw-RW",
        "note": "Text responses supported natively; offline Windows SAPI & SpeechRecognition Kinyarwanda accuracy is limited.",
    },
}


@dataclass
class VoiceCapability:
    stt_available: bool
    tts_available: bool
    details: str


class VoiceEngine:
    def __init__(self, gatekeeper: SecurityGatekeeper) -> None:
        self.gatekeeper = gatekeeper
        self.stop_event = threading.Event()
        self.listening = False
        self._tts_engine: Any = None

    def get_capabilities(self) -> VoiceCapability:
        stt_ok = sr is not None
        tts_ok = pyttsx3 is not None
        parts = [
            f"STT={'ready' if stt_ok else 'SpeechRecognition not installed'}",
            f"TTS={'ready' if tts_ok else 'pyttsx3 not installed'}",
        ]
        return VoiceCapability(stt_available=stt_ok, tts_available=tts_ok, details=" | ".join(parts))

    def detect_wake_word(self, transcript: str, wake_word: str = "hey remy") -> bool:
        return wake_word.lower() in transcript.lower()

    def stop_all(self) -> None:
        """Immediate interruption triggered by Stop button or Esc key."""
        self.stop_event.set()
        self.listening = False
        if self._tts_engine is not None:
            try:
                self._tts_engine.stop()
            except Exception:  # pragma: no cover
                pass
        self.gatekeeper.log_audit("voice_interrupted", "user", "voice_engine", "info", "Esc/Stop triggered")

    def speak_async(self, text: str, language: str = "en") -> threading.Thread:
        self.stop_event.clear()

        def _worker() -> None:
            if pyttsx3 is None:
                LOGGER.info("pyttsx3 unavailable; speech synthesis skipped in headless environment.")
                return
            try:
                engine = pyttsx3.init()
                self._tts_engine = engine
                if self.stop_event.is_set():
                    return
                engine.say(text)
                engine.runAndWait()
            except Exception as exc:  # pragma: no cover
                LOGGER.warning("TTS synthesis error (%s): %s", language, exc)
            finally:
                self._tts_engine = None

        t = threading.Thread(target=_worker, daemon=True)
        t.start()
        return t

    def listen_once(self, language: str = "en", timeout_sec: float = 5.0) -> str:
        self.gatekeeper.require_permission("voice.microphone", actor="voice_engine", target="microphone")
        if sr is None:
            raise RuntimeError("SpeechRecognition library is not installed in this Python environment.")
        self.stop_event.clear()
        self.listening = True
        recognizer = sr.Recognizer()
        lang_code = LANGUAGE_PROFILES.get(language, LANGUAGE_PROFILES["en"])["stt_code"]
        try:
            with sr.Microphone() as source:
                recognizer.adjust_for_ambient_noise(source, duration=0.4)
                audio = recognizer.listen(source, timeout=timeout_sec, phrase_time_limit=15)
            if self.stop_event.is_set():
                return ""
            return str(recognizer.recognize_google(audio, language=lang_code))
        finally:
            self.listening = False
