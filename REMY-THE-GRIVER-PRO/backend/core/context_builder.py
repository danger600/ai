"""Global Chat Context Builder & Comprehensive General-Knowledge Fallback Synthesizer."""
from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from typing import Any

from backend.career.cv_manager import CVManager
from backend.core.security import SecurityGatekeeper
from backend.documents.rag_engine import LocalRAGEngine
from backend.memory.memory_vault import MemoryVault


@dataclass
class ChatContextBundle:
    system_prompt: str
    messages: list[dict[str, str]]
    memories_used: list[dict[str, Any]]
    cv_included: bool
    cv_raw_text: str | None
    cv_blocked_by_policy: bool
    rag_hits: list[dict[str, Any]]
    language: str = "en"


_GENERAL_TOPICS: list[tuple[tuple[str, ...], str]] = [
    (
        (
            "generate image",
            "create image",
            "ai image",
            "image step by step",
            "text to image",
            "make picture",
            "draw image",
            "illustration",
            "stable diffusion",
            "midjourney",
            "dalle",
            "imagen",
        ),
        """### Step-by-Step Guide: Generating High-Quality Images with AI

1. **Define Your Visual Goal & Subject**
   - Identify the **main subject** (person, product, architecture, landscape, logo, or UI concept).
   - Pick the output **aspect ratio** (`1:1` square, `16:9` landscape banner, `9:16` portrait, `4:3`).

2. **Select an Image Model or Studio**
   - **Cloud API:** `gemini-3.1-flash-lite-image` via server-side Gemini Interactions API (`response_modalities=["image", "text"]`).
   - **Local GPU:** ComfyUI or Automatic1111 running SDXL or FLUX.1 (requires 8GB+ VRAM).

3. **Write a Structured 5-Part Prompt**
   Formula: `[Subject & Action] + [Environment / Setting] + [Lighting & Mood] + [Art Style / Medium] + [Camera / Composition]`
   - *Example:* "A software developer working at a sleek obsidian desk in Kigali, subtle blue monitor glow, warm gold rim light, editorial photography, 35mm shallow depth of field."

4. **Run Generation via Python (`google-genai` SDK)**
```python
from google import genai

client = genai.Client()
interaction = client.interactions.create(
    model="gemini-3.1-flash-lite-image",
    input="Minimalist gold bull emblem on matte black pedestal, studio lighting",
    response_modalities=["image", "text"],
    generation_config={"image_config": {"aspect_ratio": "1:1", "image_size": "1K"}},
)
```

5. **Inspect, Refine & Export**
   - Check anatomy, text legibility, and lighting consistency.
   - Iterate one detail at a time or use image-to-image editing, then export as **PNG** (lossless) or **WebP** (web).""",
    ),
    (
        ("generate video", "create video", "text to video", "ai video", "animate image", "omni", "video step by step"),
        """### Step-by-Step Guide: Generating AI Video from Text

1. **Design Shot & Motion**
   - Specify **subject + physical action + camera movement + lighting + atmosphere**.
2. **Choose Aspect Ratio & Resolution**
   - Select **`16:9` (Landscape)** for desktop/YouTube or **`9:16` (Portrait)** for vertical mobile video.
3. **Call `gemini-omni-1.2-flash` Server-Side**
   - Use `ai.interactions.create` with `response_format={"type": "video", "aspect_ratio": "16:9", "duration": "8s", "resolution": "720p"}`.
4. **Review & Export**
   - Inspect motion continuity and save the resulting MP4 stream.""",
    ),
    (
        ("python", "customtkinter", "fastapi", "flask", "django", "pandas", "script", "venv"),
        """### Python Engineering Step-by-Step Guide

1. **Create an Isolated Virtual Environment:** `python -m venv .venv` and activate it before installing dependencies.
2. **Modular Architecture:** Separate config, SQLite/database persistence, business logic, and CustomTkinter UI threads (`queue.Queue` + `after()`).
3. **Security & Correctness:** Use parameterized SQL (`?`), `pathlib.Path` traversal validation, and avoid `shell=True`.
4. **Test & Verify:** Run `python -m compileall -q .` and `python -m unittest discover -v`.""",
    ),
    (
        ("react", "node", "express", "javascript", "typescript", "html", "css", "tailwind", "rest api", "website"),
        """### Full-Stack Web Engineering Guide

1. **Frontend (React + TypeScript):** Modular components, typed state, and `AbortController` stream cleanup.
2. **Backend (Node/Express or FastAPI):** Validate inputs, keep API secrets server-side, and return clear HTTP status errors.
3. **Database:** Parameterized SQL queries, foreign keys, and regular backups.
4. **Verification:** Run TypeScript checks (`tsc --noEmit`), production build, and unit tests.""",
    ),
    (
        ("sql", "mysql", "sqlite", "mongodb", "supabase", "database", "schema", "query", "index", "join"),
        """### Database Design & SQL Optimization Guide

1. **Schema Normalization:** Use primary keys, explicit `FOREIGN KEY` constraints, and atomic columns.
2. **Indexing:** Index foreign keys and frequent `WHERE` / `ORDER BY` filter columns.
3. **Query Safety:** Always bind parameters (`?` / `$1`) instead of string formatting; wrap multi-step writes in transactions.""",
    ),
    (
        ("security", "cybersecurity", "password", "encryption", "xss", "ssrf", "sql injection", "permission", "privacy"),
        """### Security & Privacy Engineering Checklist

1. **Validate All Inputs & Paths:** Block `..` path traversal and private/loopback URLs (SSRF).
2. **Protect Secrets:** Store keys in Credential Manager / `.env` and mask tokens in logs.
3. **Enforce Least Privilege:** Gate sensitive actions (files, CV export, shell execution) behind explicit user approval + audit logs.""",
    ),
    (
        ("cv", "resume", "career", "job", "interview", "portfolio", "internship", "study", "learn", "roadmap"),
        """### Career, CV & Technical Interview Guide

1. **Verify Facts Only:** Present genuine projects, tech stack skills, and education accurately without inventing duties or credentials.
2. **Match Job Descriptions:** Compare required keywords against your core stack and close gaps with focused mini-projects.
3. **Interview Readiness:** Practice explaining architecture trade-offs, database schemas, debugging steps, and live problem solving.""",
    ),
    (
        ("ai", "machine learning", "llm", "rag", "ollama", "prompt", "agent", "gemini", "gpt", "chatbot"),
        """### Hybrid AI & Local RAG Architecture Guide

1. **Structured Prompting:** Define role, constraints, context sources, and output structure clearly.
2. **Local RAG Pipeline:** Parse PDF/DOCX/CSV locally -> chunk with page/row metadata -> retrieve matching excerpts -> cite sources explicitly.
3. **Hybrid Resilience:** Combine fast cloud models (`gemini-4-hydrogen`, `gemini-3.1-flash-lite`) with local Ollama fallback.""",
    ),
]


def generate_general_knowledge_answer(prompt: str, language: str = "en") -> str:
    clean_prompt = prompt.strip()
    lower = clean_prompt.lower()

    best_score = 0
    best_body = ""
    for keywords, body in _GENERAL_TOPICS:
        score = sum(3 if " " in kw else 1 for kw in keywords if kw in lower)
        if score > best_score:
            best_score = score
            best_body = body

    lang_headers = {
        "en": "",
        "fr": "[Langue: Français — Guide structuré ci-dessous]\n\n",
        "rw": "[Ururimi: Ikinyarwanda — Sobanukirwa intambwe ku ntambwe hasi aha]\n\n",
        "sw": "[Lugha: Kiswahili — Mwongozo wa hatua kwa hatua hapa chini]\n\n",
    }
    prefix = lang_headers.get(language, "")

    if best_body:
        return f"{prefix}{best_body}"

    words = [w for w in re.findall(r"[A-Za-z0-9_-]{3,}", clean_prompt)][:6]
    topic_label = ", ".join(words) if words else clean_prompt[:60]
    return (
        f"{prefix}### Direct Step-by-Step Answer: {clean_prompt}\n\n"
        f"1. **Core Objective:** Your request focuses on **{topic_label}**. Break it into clear inputs, execution steps, and validation checks.\n"
        "2. **Step-by-Step Plan:**\n"
        "   - **Step 1 (Inputs & Scope):** Clarify your exact target output, constraints, and available tools.\n"
        "   - **Step 2 (Setup & References):** Gather required files, dependencies, or background data.\n"
        "   - **Step 3 (Incremental Execution):** Complete one verifiable step at a time and inspect the output immediately.\n"
        "   - **Step 4 (Verification):** Double-check accuracy, edge cases, and formatting before finalizing.\n"
        "3. **Next Refinement:** Specify if you want a code snippet, checklist, math breakdown, or detailed example."
    )


def build_global_chat_context(
    conn: sqlite3.Connection,
    gatekeeper: SecurityGatekeeper,
    memory_vault: MemoryVault,
    rag_engine: LocalRAGEngine,
    cv_manager: CVManager,
    conversation_id: str,
    prompt: str,
    agent_system_prompt: str,
    language: str = "en",
    include_memory: bool = True,
    include_cv: bool = False,
    hide_private: bool = False,
    history_limit: int = 20,
) -> ChatContextBundle:
    sys_parts = [agent_system_prompt, f"Response language: {language}."]

    memories_used: list[dict[str, Any]] = []
    if include_memory and not hide_private:
        memories_used = memory_vault.get_active_context_memories()[:12]
        if memories_used:
            mem_txt = "\n".join(f"- [{m['category']}] {m['title']}: {m['content']}" for m in memories_used)
            sys_parts.append(f"APPROVED LONG-TERM MEMORIES:\n{mem_txt}")

    cv_included = False
    cv_raw_text: str | None = None
    cv_blocked_by_policy = False
    if include_cv and not hide_private:
        if gatekeeper.is_permission_granted("cv.external_ai"):
            cv_profile = cv_manager.get_primary_cv()
            cv_included = True
            cv_raw_text = str(cv_profile["raw_text"])
            sys_parts.append(f"USER-APPROVED PRIVATE CV PROFILE:\n{cv_raw_text}")
            gatekeeper.log_audit("cv_transmitted_to_ai", "user_action", "remy-primary-cv", "allowed", "Include CV enabled in chat")
        else:
            cv_blocked_by_policy = True
            gatekeeper.log_audit("cv_transmission_blocked", "security_gatekeeper", "remy-primary-cv", "denied", "cv.external_ai locked")
            sys_parts.append(
                "NOTE: User checked 'Include CV (Permission-Gated)' but cv.external_ai is LOCKED in Security Center. "
                "Do not fabricate CV facts; advise unlocking cv.external_ai if private CV details are needed."
            )

    rag_hits = rag_engine.search_chunks(prompt, limit=4)
    if rag_hits:
        rag_txt = "\n".join(f"{h['citation']} {h['excerpt'][:450]}" for h in rag_hits)
        sys_parts.append(f"LOCAL DOCUMENT CONTEXT (cite exact bracket tags):\n{rag_txt}")

    full_system = "\n\n".join(sys_parts)

    rows = conn.execute(
        """
        SELECT role, content FROM (
            SELECT role, content, rowid FROM messages
            WHERE conversation_id = ?
            ORDER BY rowid DESC LIMIT ?
        ) ORDER BY rowid ASC
        """,
        (conversation_id, history_limit),
    ).fetchall()

    history_msgs = [
        {"role": r["role"], "content": r["content"]}
        for r in rows
        if r["role"] in ("user", "assistant") and str(r["content"]).strip()
    ]
    if not history_msgs or history_msgs[-1]["role"] != "user" or history_msgs[-1]["content"].strip() != prompt.strip():
        history_msgs.append({"role": "user", "content": prompt.strip()})

    payload_messages = [{"role": "system", "content": full_system}, *history_msgs]
    return ChatContextBundle(
        system_prompt=full_system,
        messages=payload_messages,
        memories_used=memories_used,
        cv_included=cv_included,
        cv_raw_text=cv_raw_text,
        cv_blocked_by_policy=cv_blocked_by_policy,
        rag_hits=rag_hits,
        language=language,
    )


def build_local_fallback_reply(
    prompt: str,
    agent_name: str,
    bundle: ChatContextBundle,
    reason: str,
) -> str:
    """Produce a comprehensive general-knowledge + local-context response when cloud AI is offline/unavailable."""
    general_answer = generate_general_knowledge_answer(prompt, getattr(bundle, "language", "en"))
    lines = [
        general_answer,
        "",
        "---",
        f"[Assistant Engine Note — {agent_name}] {reason}",
        "",
    ]
    if bundle.memories_used:
        lines.append("Memory Vault Context Applied:")
        for m in bundle.memories_used:
            lines.append(f"  - [{m['category']}] {m['title']}: {m['content']}")
        lines.append("")

    if bundle.cv_blocked_by_policy:
        lines.append("Private CV Gatekeeper Notice:")
        lines.append("  - CV External AI is LOCKED (cv.external_ai = denied). Unlock in CV Vault or Security Center to include CV context.")
        lines.append("")
    elif bundle.cv_included and bundle.cv_raw_text:
        lines.append("Authorized CV Profile Included:")
        lines.append(bundle.cv_raw_text.strip())
        lines.append("")

    if bundle.rag_hits:
        lines.append("Matching Local Document Excerpts:")
        for hit in bundle.rag_hits:
            lines.append(f"  - {hit['citation']} {hit['excerpt'][:220]}")
        lines.append("")

    return "\n".join(lines)
