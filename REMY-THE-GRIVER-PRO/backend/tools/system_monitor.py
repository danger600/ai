"""Live system telemetry (psutil with stdlib/proc fallback), connectivity check, and database health."""
from __future__ import annotations

import os
import platform
import shutil
import socket
import sqlite3
from pathlib import Path
from typing import Any

from backend.core.config import DB_PATH
from backend.database.db import get_database_health

try:
    import psutil  # type: ignore
except ImportError:  # pragma: no cover
    psutil = None


def _read_linux_mem_percent() -> tuple[float, float, float]:
    meminfo = Path("/proc/meminfo")
    if not meminfo.exists():
        return 0.0, 0.0, 0.0
    data: dict[str, int] = {}
    for line in meminfo.read_text(encoding="utf-8", errors="ignore").splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            parts = v.strip().split()
            if parts and parts[0].isdigit():
                data[k] = int(parts[0])
    total_kb = data.get("MemTotal", 0)
    avail_kb = data.get("MemAvailable", data.get("MemFree", 0))
    if total_kb <= 0:
        return 0.0, 0.0, 0.0
    used_kb = max(0, total_kb - avail_kb)
    pct = round((used_kb / total_kb) * 100.0, 1)
    return pct, round(used_kb / (1024 * 1024), 2), round(total_kb / (1024 * 1024), 2)


def check_internet_connectivity(host: str = "1.1.1.1", port: int = 443, timeout_sec: float = 1.5) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout_sec):
            return True
    except OSError:
        return False


def collect_system_telemetry(conn: sqlite3.Connection, db_path: Path | None = None, check_network: bool = False) -> dict[str, Any]:
    disk = shutil.disk_usage(str((db_path or DB_PATH).parent))
    disk_pct = round((disk.used / disk.total) * 100.0, 1) if disk.total else 0.0

    if psutil is not None:
        cpu_pct = float(psutil.cpu_percent(interval=0.1))
        vm = psutil.virtual_memory()
        ram_pct = float(vm.percent)
        ram_used_gb = round(vm.used / (1024 ** 3), 2)
        ram_total_gb = round(vm.total / (1024 ** 3), 2)
        batt = psutil.sensors_battery()
        battery_info = (
            {"percent": round(batt.percent, 1), "plugged_in": bool(batt.power_plugged)}
            if batt is not None
            else None
        )
    else:
        try:
            load1, _, _ = os.getloadavg()
            cores = os.cpu_count() or 1
            cpu_pct = min(100.0, round((load1 / cores) * 100.0, 1))
        except (AttributeError, OSError):
            cpu_pct = 0.0
        ram_pct, ram_used_gb, ram_total_gb = _read_linux_mem_percent()
        battery_info = None

    return {
        "os": f"{platform.system()} {platform.release()}",
        "python_version": platform.python_version(),
        "cpu_percent": cpu_pct,
        "ram_percent": ram_pct,
        "ram_used_gb": ram_used_gb,
        "ram_total_gb": ram_total_gb,
        "disk_percent": disk_pct,
        "disk_free_gb": round(disk.free / (1024 ** 3), 2),
        "battery": battery_info,
        "internet_online": check_internet_connectivity() if check_network else None,
        "database": get_database_health(conn, db_path),
    }
