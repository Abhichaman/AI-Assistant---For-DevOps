# Read-Only DevOps Tools

The assistant exposes only a small set of safe diagnostic tools. It does not expose arbitrary shell execution.

| Tool | Purpose | Example request |
|---|---|---|
| `check_cpu_usage` | Reads CPU utilization | "What's my CPU usage?" |
| `check_memory_usage` | Reads memory utilization | "Check memory usage." |
| `check_disk_usage` | Reads root filesystem usage | "Check disk space." |
| `check_local_port` | Attempts a TCP connection | "Check port 8080 on localhost." |
| `check_http_endpoint` | Performs an HTTP/HTTPS request and reports status | "Check http://localhost:8080/health." |
| `list_docker_containers` | Lists running Docker containers via the Engine API | "Show running Docker containers." |

## Deliberate limitations

The demo does not expose tools for:

- deleting or restarting containers
- arbitrary shell commands
- deleting Kubernetes resources
- changing Jenkins configuration
- terminating cloud resources
- modifying files
- deploying infrastructure

The assistant can still explain those topics conversationally, but it should not claim to have executed unsupported actions.

## Environment scope

CPU, memory, and disk metrics always describe the environment in which the backend is running.

- Native run: they describe the local OS/runtime visible to the Python process.
- Docker run: they describe the container/cgroup-visible environment.

Docker container listing is a separate tool and uses the Docker Engine socket when explicitly mounted.
