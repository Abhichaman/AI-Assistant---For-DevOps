# DevOps Shack VoiceOps Assistant

A DevOps Shack–branded real-time AI voice assistant for DevOps learning, troubleshooting guidance, and safe local diagnostics.

The browser captures microphone audio and streams it over WebSocket to a FastAPI backend. The backend keeps a Gemini Live session open, streams the assistant's voice back to the browser, and exposes a small set of read-only DevOps tools.

## Project structure

```text
devops-shack-voiceops-assistant/
│
├── app/
│   ├── __init__.py
│   ├── server.py
│   ├── persona.py
│   └── tools.py
│
├── frontend/
│   ├── index.html
│   ├── main.js
│   └── pcm-processor.js
│
├── assets/
│   └── README.md
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── LOCAL_SETUP.md
│   ├── DOCKER_COMPOSE.md
│   └── TOOLS.md
│
├── Dockerfile
├── compose.yaml
├── compose.safe.yaml
│
├── pyproject.toml
├── uv.lock
├── requirements.txt
│
├── .python-version
├── .env.example
├── .gitignore
├── .dockerignore
│
├── run-local.sh
├── run-local.ps1
│
└── README.md
```

## What the demo can do

- Real-time voice conversation with Gemini Live
- DevOps Shack–branded frontend
- Explain Linux, Docker, Kubernetes, Jenkins, CI/CD, networking, and troubleshooting concepts
- Check CPU usage
- Check memory usage
- Check disk usage
- Check TCP ports
- Check HTTP/HTTPS endpoints
- List running Docker containers when Docker socket access is explicitly enabled
- Show transcripts and tool activity in the UI

The project intentionally exposes only read-only diagnostics. It does not provide arbitrary shell execution or destructive infrastructure actions.

## Architecture

```text
Browser microphone
      |
      | WebSocket (16 kHz PCM)
      v
FastAPI / Uvicorn
      |
      +---------------------> Read-only DevOps tools
      |
      v
Google GenAI SDK
      |
      v
Gemini Live API
      |
      | streamed voice
      v
Browser speaker
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the detailed flow.

## Prerequisites

### Native local execution

- Python 3.11
- Internet connection
- Gemini API key
- Modern browser with microphone access
- `uv` recommended

### Docker Compose execution

- Docker Engine or Docker Desktop
- Docker Compose v2 (`docker compose`)
- Internet connection
- Gemini API key

No Node.js, database, Kubernetes cluster, or cloud account is required for the local demo.

## Configure the application

Copy the environment template:

```bash
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and set your Gemini API key:

```env
GOOGLE_GENAI_USE_VERTEXAI=FALSE
GOOGLE_API_KEY=YOUR_GEMINI_API_KEY
LIVE_MODEL=gemini-3.8-live
LIVE_VOICE=Aoede
LOG_LEVEL=INFO
OTEL_SDK_DISABLED=true
DOCKER_SOCKET=/var/run/docker.sock
```

Never commit `.env`.

# Option A — Run locally with `uv`

Install the locked dependencies:

```bash
uv sync --frozen
```

Start the application:

```bash
uv run uvicorn app.server:app --host 0.0.0.0 --port 8000
```

Or on Linux/macOS/WSL:

```bash
./run-local.sh
```

On PowerShell:

```powershell
.\run-local.ps1
```

Open:

```text
http://localhost:8000
```

Health endpoint:

```text
http://localhost:8000/api/health
```

Detailed native setup: [`docs/LOCAL_SETUP.md`](docs/LOCAL_SETUP.md).

# Option B — Run locally with Python `venv` + pip

Linux/macOS/WSL:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m uvicorn app.server:app --host 0.0.0.0 --port 8000
```

Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn app.server:app --host 0.0.0.0 --port 8000
```

# Option C — Run with Docker Compose

Standard demo, including Docker-container visibility:

```bash
docker compose up --build
```

Open:

```text
http://localhost:8000
```

Useful commands:

```bash
docker compose ps
docker compose logs -f voiceops
docker compose down
```

The standard `compose.yaml` mounts `/var/run/docker.sock` so the read-only Docker tool can list running containers through the Docker Engine API.

**Security note:** Docker socket access is highly privileged even when bind-mounted with `:ro`. Use this only on a trusted local demo machine.

For a Compose run without Docker socket access:

```bash
docker compose -f compose.safe.yaml up --build
```

Detailed Compose setup: [`docs/DOCKER_COMPOSE.md`](docs/DOCKER_COMPOSE.md).

## Important `localhost` behavior in Docker

When the application runs natively:

```text
localhost -> your host machine
```

When the application runs in Docker:

```text
localhost -> the VoiceOps container
```

To reach a service running on your host from the Compose version, use:

```text
host.docker.internal
```

Examples:

```text
Check port 8080 on host.docker.internal.
Check http://host.docker.internal:8080/health.
```

## Demo prompts

After clicking **Start Live Session**, try:

```text
What's my CPU usage?
Check memory usage.
Check disk space.
Show running Docker containers.
Check port 8080 on host.docker.internal.
Check http://host.docker.internal:8080/health.
Explain CrashLoopBackOff.
What's the difference between a Docker image and a container?
How would you troubleshoot a failed Jenkins pipeline?
```

For conceptual DevOps questions, Gemini answers directly. For supported diagnostics, Gemini can invoke a read-only tool and the UI displays the tool activity and result.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — application and runtime architecture
- [`docs/LOCAL_SETUP.md`](docs/LOCAL_SETUP.md) — native local execution
- [`docs/DOCKER_COMPOSE.md`](docs/DOCKER_COMPOSE.md) — Docker Compose execution
- [`docs/TOOLS.md`](docs/TOOLS.md) — read-only tool behavior and boundaries
