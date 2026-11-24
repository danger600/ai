# REMY THE GRIVER PRO

**Your Personal AI. Your Rules.**

Developer: **Remy Nsanzimana** | Brand: **BULL MAN — THE BULL MAN ON TOP**  
Education: Level 5 Software Development, EAV KIVUMU TSS, Rwanda  
Location: Kigali, Gasabo, Rwanda  
GitHub: [https://github.com/danger600](https://github.com/danger600)

## Architecture Overview

REMY THE GRIVER PRO is a full-stack personal AI command center and career intelligence workspace backed by SQLite (`node:sqlite`), Express, React, Tailwind CSS, and server-side `@google/genai` integration (`gemini-4-hydrogen` and `gemini-3.1-flash-lite`), plus an exportable Windows Python CustomTkinter starter bundle (`REMY-THE-GRIVER-PRO-Windows-Desktop.zip`).

### Core Modules
- **AI Workspace**: Streaming SSE responses, 10 specialized agents with automatic intent orchestration, edit & resubmit, regenerate, copy code, PDF export, and Web Speech API voice STT/TTS with `Esc` immediate interruption.
- **AI Developer Studio**: Code analysis, refactoring, unit tests, SQL/architecture assistance, isolated `node:vm` JavaScript sandbox, and live GitHub repository inspection.
- **Document Intelligence & Local RAG**: Local parsing and chunking for PDF, DOCX, TXT, Markdown, CSV, XLSX, and source code with offline TF-IDF search and cited Q&A.
- **Personal Profile & CV Vault**: Verified profile for Remy Nsanzimana, private by default (`cv.external_ai` permission gate), offline job-description skill matcher, version manager, and PDF export.
- **Memory Vault**: Controllable long-term memories with global toggle, approval controls, search, and JSON import/export.
- **Productivity Command Center**: Projects (`KIVUMU SMART CAMPUS`, `UBUBIKO SMART`), tasks, notes, reminders, calculator, unit converter, live Open-Meteo weather, and live currency conversion.
- **Web Research Engine**: Real Google Search grounding with verified clickable URLs.
- **System Monitor & Security Center**: Live CPU/RAM/SQLite integrity telemetry, local Ollama endpoint probe, approved folders/apps in SQLite, audit logs, secret masking, and database backup creation.

## Local Development & Verification

```bash
npm install
npm run dev
```

### Run Automated Tests
```bash
node --import tsx --test tests/core.test.ts
```
