#!/usr/bin/env python3
"""
InventarioIT - Agente Linux
Configurar con variables de entorno:
  INVENTARIO_API_URL=https://inventario.midominio.com/api
  INVENTARIO_AGENT_TOKEN=invagt_...
  INVENTARIO_DELEGATION=Delegacion Norte
"""
import json
import os
import platform
import socket
import subprocess
import sys
import urllib.request

AGENT_VERSION = "1.0.0"


def run(cmd, timeout=10):
    try:
        p = subprocess.run(cmd, shell=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=timeout)
        return p.stdout.strip()
    except Exception:
        return ""


def read_file(path):
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read().strip()
    except Exception:
        return ""


def os_release():
    data = {}
    for line in read_file("/etc/os-release").splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            data[k.lower()] = v.strip().strip('"')
    return data


def first_ipv4():
    out = run("ip -o -4 addr show scope global | awk '{print $4}' | cut -d/ -f1 | head -1")
    return out or None


def first_mac():
    out = run(r"ip link | awk '/link\/ether/ {print $2; exit}'")
    return out or None


def dmidecode_value(key):
    return run(f"(dmidecode -s {key} 2>/dev/null || true) | head -1", timeout=5) or None


def packages():
    if run("command -v dpkg-query"):
        out = run("dpkg-query -W -f='${Package}\t${Version}\t${Architecture}\n'", timeout=30)
        return [
            {"name": p[0], "version": p[1] if len(p) > 1 else "", "vendor": "", "arch": p[2] if len(p) > 2 else ""}
            for p in (line.split("\t") for line in out.splitlines()) if p and p[0]
        ][:5000]
    if run("command -v rpm"):
        out = run("rpm -qa --queryformat '%{NAME}\t%{VERSION}-%{RELEASE}\t%{ARCH}\n'", timeout=30)
        return [
            {"name": p[0], "version": p[1] if len(p) > 1 else "", "vendor": "", "arch": p[2] if len(p) > 2 else ""}
            for p in (line.split("\t") for line in out.splitlines()) if p and p[0]
        ][:5000]
    return []


def json_lines(cmd, keys, timeout=10):
    rows = []
    for line in run(cmd, timeout=timeout).splitlines():
        vals = [x.strip() for x in line.split("|")]
        if any(vals):
            rows.append({k: vals[i] if i < len(vals) else "" for i, k in enumerate(keys)})
    return rows


def main():
    api_url = (os.getenv("INVENTARIO_API_URL") or "").rstrip("/")
    token = os.getenv("INVENTARIO_AGENT_TOKEN") or ""
    delegation = os.getenv("INVENTARIO_DELEGATION") or ""
    if not api_url or not token:
        print("Falta INVENTARIO_API_URL o INVENTARIO_AGENT_TOKEN", file=sys.stderr)
        return 2

    rel = os_release()
    hostname = socket.gethostname()
    serial = dmidecode_value("system-serial-number") or read_file("/sys/class/dmi/id/product_serial") or hostname
    brand = dmidecode_value("system-manufacturer") or read_file("/sys/class/dmi/id/sys_vendor") or "Linux"
    model = dmidecode_value("system-product-name") or read_file("/sys/class/dmi/id/product_name") or platform.machine()
    pretty_os = rel.get("pretty_name") or platform.platform()

    payload = {
        "agent_id": serial or hostname,
        "agent_version": AGENT_VERSION,
        "agent_platform": "linux",
        "delegation": delegation,
        "hostname": hostname,
        "ip": first_ipv4(),
        "mac": first_mac(),
        "os": pretty_os,
        "serial_number": serial,
        "brand": brand,
        "model": model,
        "category": "server",
        "enrich_method": "agent-linux",
        "system_info": {
            "computer": {
                "hostname": hostname,
                "manufacturer": brand,
                "model": model,
                "architecture": platform.machine(),
            },
            "bios": {
                "serial_number": serial,
                "manufacturer": brand,
                "version": dmidecode_value("bios-version"),
                "release_date": dmidecode_value("bios-release-date"),
            },
            "os": {
                "pretty_name": pretty_os,
                "id": rel.get("id"),
                "version": rel.get("version"),
                "kernel": platform.release(),
            },
            "cpu": json_lines("lscpu | awk -F: '/Model name|CPU\\(s\\)|Thread|Core|Socket/ {gsub(/^[ \\t]+/,\"\",$2); print $1\"|\"$2}'", ["key", "value"]),
            "memory": {"meminfo": read_file("/proc/meminfo")},
            "disks": json_lines("lsblk -b -dn -o NAME,MODEL,SIZE,TYPE,SERIAL | sed 's/  */|/g'", ["name", "model", "size", "type", "serial"]),
            "logical_disks": json_lines("df -P -B1 -T | tail -n +2 | awk '{print $1\"|\"$2\"|\"$3\"|\"$4\"|\"$5\"|\"$7}'", ["filesystem", "type", "size", "used", "available", "mount"]),
            "network": json_lines("ip -o addr show scope global | awk '{print $2\"|\"$3\"|\"$4}'", ["interface", "family", "address"]),
        },
        "software": packages(),
    }

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{api_url}/agents/report",
        data=data,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            print(resp.read().decode("utf-8"))
        return 0
    except Exception as e:
        print(f"Error enviando inventario: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
