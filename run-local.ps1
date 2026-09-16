$ErrorActionPreference = "Stop"

if (-not (Test-Path ".env")) {
    Write-Error "Missing .env. Copy .env.example to .env and add GOOGLE_API_KEY."
}

if (Get-Command uv -ErrorAction SilentlyContinue) {
    uv sync --frozen
    uv run uvicorn app.server:app --host 0.0.0.0 --port 8000
    exit $LASTEXITCODE
}

if (-not (Test-Path ".venv")) {
    python -m venv .venv
}
& .\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn app.server:app --host 0.0.0.0 --port 8000
