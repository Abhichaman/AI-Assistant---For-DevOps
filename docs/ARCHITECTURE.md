# Architecture

## DevOps Shack VoiceOps Assistant

The application is intentionally small so the real-time voice flow is easy to understand and demo.

```text
User
  |
  | microphone audio
  v
Browser UI
  |
  | WebSocket (16 kHz PCM upstream / streamed audio downstream)
  v
FastAPI + Uvicorn
  |
  +------------------------+
  |                        |
  |                        +--> Read-only DevOps tools
  |                             - CPU
  |                             - memory
  |                             - disk
  |                             - TCP port
  |                             - HTTP endpoint
  |                             - Docker container listing
  |
  v
Google GenAI SDK
  |
  | Internet
  v
Gemini Live API
  |
  v
Streaming voice response
  |
  v
Browser speaker output
```

## Main components

### `frontend/`
Runs in the browser. It captures the microphone, converts audio to the PCM format used by the backend, opens a WebSocket, receives the assistant audio stream, shows transcripts, and renders tool activity.

### `app/server.py`
The FastAPI application. It serves the frontend, exposes `/api/health`, accepts the `/ws` WebSocket, opens one Gemini Live session per browser session, forwards microphone frames, returns streamed voice frames, and dispatches function/tool calls.

### `app/persona.py`
Contains the DevOps Shack system instruction. It defines the assistant as a read-only DevOps learning and troubleshooting assistant and prevents it from pretending that external systems are connected when they are not.

### `app/tools.py`
Contains the read-only DevOps tools. These tools intentionally avoid arbitrary shell execution and destructive operations.

## Local versus Docker behavior

When running natively, `localhost` refers to the host machine.

When running in Docker, `localhost` refers to the voice-assistant container. The Compose configuration therefore adds `host.docker.internal`, which can be used to reach services running on the host machine.

Example from Docker Compose:

```text
Check port 8080 on host.docker.internal.
```

## Docker Engine integration

`compose.yaml` mounts `/var/run/docker.sock` read-only so the demo can list running Docker containers through the Docker Engine API.

This is useful for a trusted local demo, but Docker socket access is security-sensitive. Use `compose.safe.yaml` when you do not want to expose the Docker socket to the application.
