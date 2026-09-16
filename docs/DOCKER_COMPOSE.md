# Docker Compose

## Prerequisites

- Docker Engine or Docker Desktop
- Docker Compose v2
- Internet connection
- Gemini API key

## 1. Configure `.env`

```bash
cp .env.example .env
```

Set:

```env
GOOGLE_API_KEY=your_actual_key
```

## 2. Build and run

```bash
docker compose up --build
```

Open:

```text
http://localhost:8000
```

Run detached:

```bash
docker compose up -d --build
```

View logs:

```bash
docker compose logs -f voiceops
```

Check status:

```bash
docker compose ps
```

Stop:

```bash
docker compose down
```

## Docker container listing

The default `compose.yaml` mounts:

```text
/var/run/docker.sock:/var/run/docker.sock:ro
```

This enables the read-only demo tool to query the Docker Engine API and list running containers.

Docker socket access is security-sensitive. Use it only on a trusted local demo machine.

## Safe Compose mode

To run without the Docker socket:

```bash
docker compose -f compose.safe.yaml up --build
```

The voice assistant, CPU/memory/disk checks, port checks, HTTP checks, and conceptual DevOps questions continue to work. Only Docker container listing becomes unavailable.

## Reaching services on the host

Inside the container, `localhost` means the container itself.

To check an application running on the host machine, use:

```text
host.docker.internal
```

Examples:

```text
Check port 8080 on host.docker.internal.
Check http://host.docker.internal:8080/health.
```
