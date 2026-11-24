# Build Windows 10/11 executable bundle with PyInstaller
$ErrorActionPreference = "Stop"

if (-not (Test-Path ".venv")) {
    python -m venv .venv
}
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pip install pyinstaller

pyinstaller --noconfirm --windowed --name "RemyTheGriverPro" `
    --add-data "plugins;plugins" `
    --add-data "docs;docs" `
    main.py

Write-Host "Build complete: dist\RemyTheGriverPro\RemyTheGriverPro.exe"
