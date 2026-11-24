# Run full automated test suite and syntax check on Windows PowerShell
$ErrorActionPreference = "Stop"

if (Test-Path ".venv\Scripts\Activate.ps1") {
    .\.venv\Scripts\Activate.ps1
}

python -m compileall backend gui plugins main.py tests
python -m unittest discover -s tests -v
