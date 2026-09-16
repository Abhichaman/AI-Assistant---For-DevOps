# Local Setup

## Prerequisites

- Python 3.11
- `uv` recommended
- Internet connection
- Gemini API key
- Chrome, Edge, or another modern browser
- Microphone
- Headphones recommended

## 1. Configure the environment

From the project root:

```bash
cp .env.example .env
```

Edit `.env` and set:

```env
GOOGLE_API_KEY=your_actual_key
```

Do not commit `.env`.

## 2. Run with `uv`

Install the locked dependencies:

```bash
uv sync --frozen
```

Start the application:

```bash
uv run uvicorn app.server:app --host 0.0.0.0 --port 8000
```

Or use:

```bash
./run-local.sh
```

On PowerShell:

```powershell
.\run-local.ps1
```

## 3. Open the UI

Open:

```text
http://localhost:8000
```

Health endpoint:

```text
http://localhost:8000/api/health
```

## 4. Demo prompts

Try:

```text
What's my CPU usage?
Check memory usage.
Check disk space.
Check localhost port 8080.
Explain CrashLoopBackOff.
Explain why a Jenkins pipeline might fail during Maven build.
Show running Docker containers.
```

Docker container listing works natively only when `/var/run/docker.sock` is available to the process, typically on Linux/WSL. On native Windows, use the Docker Compose path instead.
