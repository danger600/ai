# REMY THE GRIVER PRO

**Your Personal AI. Your Rules.**  
Developer: **Remy Nsanzimana** | Brand: **BULL MAN — THE BULL MAN ON TOP**  
GitHub: https://github.com/danger600  

Enterprise Personal AI Desktop Assistant built in Python (`CustomTkinter` + `SQLite` + Hybrid Cloud/Ollama AI + Multi-Agent Security Gatekeeper) for Windows 10 & Windows 11.

## Implemented Modules
1. **Hybrid AI Engine (`backend/core/ai_engine.py`)**: OpenAI-compatible SSE streaming, Ollama `/api/tags` probe & local fallback, exponential backoff retry, `threading.Event` cancellation, Strict Local-Only Mode.
2. **Multi-Agent Orchestrator (`backend/agents/orchestrator.py`)**: 10 specialized agents routed by intent or manual selection, bound to `SecurityGatekeeper`.
3. **Private Career & CV Vault (`backend/career/cv_manager.py`)**: Authentic Remy Nsanzimana profile, local `.pdf`/`.docx`/`.txt` extraction, offline JD skill-gap matcher, PDF export, version snapshots, and `cv.external_ai` privacy lock.
4. **Document Intelligence & Local RAG (`backend/documents/rag_engine.py`)**: Multi-format local ingestion (PDF, DOCX, XLSX, CSV, Markdown, Code) with TF-IDF search returning exact `[filename | page_or_row]` citations.
5. **Controlled Memory Vault (`backend/memory/memory_vault.py`)**: Approved/enabled long-term memories, global pause toggle, JSON export/import.
6. **Developer Studio & GitHub (`backend/integrations/`)**: AST static/security inspector, SQL analyzer, `shell=False` isolated Python sandbox, `danger600` GitHub REST inspector.
7. **Productivity, System Telemetry & Research (`backend/tools/`)**: Tasks/Notes/Reminders CRUD, safe AST calculator & unit converter, live Kigali Open-Meteo weather & currency conversion, live CPU/RAM/Disk/DB integrity monitor, permission-gated web research.
8. **Voice Intelligence & Isolated Plugins (`backend/voice/`, `backend/automation/`)**: Multilingual STT/TTS (`EN/RW/FR/SW`), immediate `Esc` stop interruption, approval-gated plugins (`plugins/kigali_briefing.py`).
9. **CustomTkinter Desktop Shell (`gui/app.py`)**: Obsidian Dark & Clean Daylight themes, Hide Private Features toggle, Strict Local-Only toggle, background worker queue.

## Quick Start (Windows PowerShell)
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
python main.py
```

## Automated Verification
```powershell
python -m unittest discover -s tests -v
python main.py --health-check
```
