"""Read-only local diagnostics used by the DevOps Shack VoiceOps Assistant."""

from __future__ import annotations

import http.client
import json
import os
import socket
import urllib.request
import shutil
import time
from typing import Any, Dict, Tuple


TOOL_DECLARATIONS = [
    {
        "name": "check_cpu_usage",
        "description": "Check current CPU usage of the environment running the voice assistant.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "check_memory_usage",
        "description": "Check current memory usage of the environment running the voice assistant.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "check_disk_usage",
        "description": "Check disk usage for the root filesystem of the environment running the voice assistant.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "check_local_port",
        "description": "Check whether a TCP port is reachable from the voice assistant environment.",
        "parameters": {
            "type": "object",
            "properties": {
                "port": {"type": "integer", "description": "TCP port number, for example 8080."},
                "host": {"type": "string", "description": "Hostname or IP. Defaults to localhost."},
            },
            "required": ["port"],
        },
    },
    {
        "name": "check_http_endpoint",
        "description": "Check whether an HTTP or HTTPS endpoint is reachable and report its status code.",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "Full URL, for example http://host.docker.internal:8080/health."},
            },
            "required": ["url"],
        },
    },
    {
        "name": "list_docker_containers",
        "description": "List running Docker containers when the Docker Engine socket is available to this demo.",
        "parameters": {"type": "object", "properties": {}},
    },
]


def _gb(value: float) -> float:
    return round(value / (1024 ** 3), 2)


def _event(name: str, title: str, summary: str, command: str, details: str = "", ok: bool = True) -> Dict[str, Any]:
    return {
        "name": name,
        "title": title,
        "summary": summary,
        "command": command,
        "details": details,
        "ok": ok,
    }


def _read_linux_cpu_times():
    with open("/proc/stat", "r", encoding="utf-8") as fh:
        first = fh.readline().split()
    if not first or first[0] != "cpu":
        raise RuntimeError("Could not read aggregate CPU counters")
    values = [float(v) for v in first[1:]]
    idle = values[3] + (values[4] if len(values) > 4 else 0.0)
    total = sum(values)
    return idle, total


def cpu_usage() -> Tuple[Dict[str, Any], Dict[str, Any]]:
    try:
        idle1, total1 = _read_linux_cpu_times()
        time.sleep(0.25)
        idle2, total2 = _read_linux_cpu_times()
        total_delta = total2 - total1
        idle_delta = idle2 - idle1
        usage = 0.0 if total_delta <= 0 else (1.0 - idle_delta / total_delta) * 100.0
        usage = round(max(0.0, min(100.0, usage)), 1)
        cores = os.cpu_count() or 1
        summary = f"CPU usage is {usage:.1f}% across {cores} logical cores."
        return (
            _event("check_cpu_usage", "CPU Usage", summary, "Read /proc/stat", "Read-only Linux runtime metric."),
            {"result": "ok", "cpu_percent": usage, "logical_cores": cores, "summary": summary},
        )
    except Exception as exc:
        summary = "CPU utilization could not be read from this runtime."
        return (
            _event("check_cpu_usage", "CPU Usage", summary, "Read /proc/stat", str(exc), False),
            {"result": "failed", "summary": summary},
        )


def memory_usage() -> Tuple[Dict[str, Any], Dict[str, Any]]:
    try:
        values = {}
        with open("/proc/meminfo", "r", encoding="utf-8") as fh:
            for line in fh:
                key, raw = line.split(":", 1)
                values[key] = int(raw.strip().split()[0]) * 1024
        total = values["MemTotal"]
        available = values.get("MemAvailable", values.get("MemFree", 0))
        used = max(0, total - available)
        percent = round((used / total) * 100.0, 1) if total else 0.0
        summary = f"Memory usage is {percent:.1f}%. Used {_gb(used)} GB out of {_gb(total)} GB."
        return (
            _event("check_memory_usage", "Memory Usage", summary, "Read /proc/meminfo", "Read-only Linux runtime metric."),
            {"result": "ok", "memory_percent": percent, "used_gb": _gb(used), "total_gb": _gb(total), "summary": summary},
        )
    except Exception as exc:
        summary = "Memory utilization could not be read from this runtime."
        return (
            _event("check_memory_usage", "Memory Usage", summary, "Read /proc/meminfo", str(exc), False),
            {"result": "failed", "summary": summary},
        )


def disk_usage() -> Tuple[Dict[str, Any], Dict[str, Any]]:
    du = shutil.disk_usage("/")
    used = du.total - du.free
    percent = round((used / du.total) * 100.0, 1) if du.total else 0.0
    summary = f"Root filesystem usage is {percent:.1f}%. Used {_gb(used)} GB out of {_gb(du.total)} GB."
    return (
        _event("check_disk_usage", "Disk Usage", summary, "shutil.disk_usage('/')", "Read-only runtime metric."),
        {"result": "ok", "disk_percent": percent, "used_gb": _gb(used), "total_gb": _gb(du.total), "summary": summary},
    )

def local_port(host: str, port: int) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    host = host or "localhost"
    try:
        port = int(port)
    except (TypeError, ValueError):
        port = 0
    if not (1 <= port <= 65535):
        summary = "The requested TCP port is invalid."
        return (
            _event("check_local_port", "Local Port Check", summary, f"TCP connect to {host}:{port}", "Valid ports are 1-65535.", False),
            {"result": "failed", "reachable": False, "summary": summary},
        )
    try:
        with socket.create_connection((host, port), timeout=2):
            summary = f"Port {port} on {host} is reachable."
            return (
                _event("check_local_port", "Local Port Check", summary, f"TCP connect to {host}:{port}", "TCP connection established successfully."),
                {"result": "ok", "host": host, "port": port, "reachable": True, "summary": summary},
            )
    except Exception as exc:
        summary = f"Port {port} on {host} is not reachable."
        return (
            _event("check_local_port", "Local Port Check", summary, f"TCP connect to {host}:{port}", str(exc), False),
            {"result": "failed", "host": host, "port": port, "reachable": False, "summary": summary},
        )


def http_endpoint(url: str) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    if not url.startswith(("http://", "https://")):
        summary = "Endpoint URL must begin with http:// or https://."
        return (
            _event("check_http_endpoint", "HTTP Endpoint Check", summary, f"HTTP GET {url}", "Invalid URL scheme.", False),
            {"result": "failed", "url": url, "summary": summary},
        )
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "DevOpsShackVoiceOps/1.0"})
        with urllib.request.urlopen(request, timeout=5) as response:
            code = response.getcode()
        ok = 200 <= code < 400
        summary = f"Endpoint returned HTTP {code}."
        return (
            _event("check_http_endpoint", "HTTP Endpoint Check", summary, f"HTTP GET {url}", f"Checked {url}", ok),
            {"result": "ok" if ok else "failed", "url": url, "status_code": code, "summary": summary},
        )
    except Exception as exc:
        summary = f"Endpoint check failed for {url}."
        return (
            _event("check_http_endpoint", "HTTP Endpoint Check", summary, f"HTTP GET {url}", str(exc), False),
            {"result": "failed", "url": url, "summary": summary},
        )


class UnixSocketHTTPConnection(http.client.HTTPConnection):
    """Tiny HTTP client for the Docker Engine Unix socket."""

    def __init__(self, socket_path: str):
        super().__init__("localhost", timeout=4)
        self.socket_path = socket_path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.socket_path)


def docker_containers() -> Tuple[Dict[str, Any], Dict[str, Any]]:
    socket_path = os.getenv("DOCKER_SOCKET", "/var/run/docker.sock")
    command = "Docker Engine API: GET /containers/json"
    if os.name == "nt":
        summary = "Docker socket inspection is not enabled for native Windows execution."
        details = "Use Docker Compose with Docker Desktop/WSL2, or run the app inside WSL where /var/run/docker.sock is available."
        return _event("list_docker_containers", "Docker Containers", summary, command, details, False), {"result": "failed", "summary": summary}
    if not os.path.exists(socket_path):
        summary = "Docker Engine socket is not available to the application."
        details = f"Expected socket: {socket_path}. In Compose, mount /var/run/docker.sock to enable this optional demo feature."
        return _event("list_docker_containers", "Docker Containers", summary, command, details, False), {"result": "failed", "summary": summary}
    try:
        connection = UnixSocketHTTPConnection(socket_path)
        connection.request("GET", "/containers/json")
        response = connection.getresponse()
        body = response.read()
        if response.status != 200:
            summary = f"Docker Engine returned HTTP {response.status}."
            details = body.decode("utf-8", errors="replace")[:1200]
            return _event("list_docker_containers", "Docker Containers", summary, command, details, False), {"result": "failed", "summary": summary}
        payload = json.loads(body.decode("utf-8"))
        containers = []
        for item in payload:
            names = [n.lstrip("/") for n in item.get("Names", [])]
            containers.append({
                "name": names[0] if names else item.get("Id", "")[:12],
                "image": item.get("Image", ""),
                "state": item.get("State", ""),
                "status": item.get("Status", ""),
            })
        summary = f"Found {len(containers)} running Docker container(s)."
        details = "\n".join(
            f"{c['name']} | {c['image']} | {c['status']}" for c in containers[:12]
        ) or "No running containers."
        return (
            _event("list_docker_containers", "Docker Containers", summary, command, details, True),
            {"result": "ok", "containers": containers, "summary": summary},
        )
    except Exception as exc:
        summary = "Could not query the Docker Engine socket."
        return _event("list_docker_containers", "Docker Containers", summary, command, str(exc), False), {"result": "failed", "summary": summary}


def dispatch_tool(name: str, args: dict):
    if name == "check_cpu_usage":
        return cpu_usage()
    if name == "check_memory_usage":
        return memory_usage()
    if name == "check_disk_usage":
        return disk_usage()
    if name == "check_local_port":
        return local_port(args.get("host", "localhost"), args.get("port", 0))
    if name == "check_http_endpoint":
        return http_endpoint(args.get("url", ""))
    if name == "list_docker_containers":
        return docker_containers()
    summary = f"Tool '{name}' is not implemented in this local demo."
    return _event(name, "Unsupported Tool", summary, name, "Only read-only demo tools are exposed.", False), {"result": "failed", "summary": summary}
