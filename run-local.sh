#!/usr/bin/env bash
set -euo pipefail

if [ ! -f .env ]; then
  echo "Missing .env. Run: cp .env.example .env, then add GOOGLE_API_KEY."
  exit 1
fi

if command -v uv >/dev/null 2>&1; then
  uv sync --frozen
  exec uv run uvicorn app.server:app --host 0.0.0.0 --port 8000
fi

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
. .venv/bin/activate
python -m pip install -r requirements.txt
exec python -m uvicorn app.server:app --host 0.0.0.0 --port 8000
