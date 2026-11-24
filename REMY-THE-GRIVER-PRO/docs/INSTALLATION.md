# Installation Guide — REMY THE GRIVER PRO (Windows 10 & Windows 11)

## Prerequisites
- Windows 10 (22H2+) or Windows 11 (64-bit)
- Python 3.11 or 3.12 installed with Tkinter enabled (`tcl/tk and IDLE` checked during setup)
- Optional local AI daemon: [Ollama](https://ollama.com/) (`ollama pull llama3`)
- Optional cloud AI key: OpenAI-compatible API key stored via Settings -> Windows Credential Manager (`keyring`) or `.env`

## Step-by-Step Setup (PowerShell)
```powershell
cd REMY-THE-GRIVER-PRO
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -r requirements.txt
Copy-Item .env.example .env
```

## Launch Desktop App
```powershell
python main.py
```

## Run Headless Health Check or CLI
```powershell
python main.py --health-check
python main.py --cli
```

## Language & Speech Notes
- **English (`en`) & French (`fr`)**: Supported for text, STT (`SpeechRecognition`), and Windows SAPI TTS (`pyttsx3`) when language voice packs are installed.
- **Swahili (`sw`)**: Supported for online STT (`sw-KE`); Windows offline TTS depends on installed system voice packs.
- **Kinyarwanda (`rw`)**: Full text conversation support; offline speech-to-text and Windows SAPI pronunciation support remain limited by current OS speech packs.
