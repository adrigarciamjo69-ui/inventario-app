#!/usr/bin/env bash
set -euo pipefail

API_URL="${1:-${INVENTARIO_API_URL:-}}"
TOKEN="${2:-${INVENTARIO_AGENT_TOKEN:-}}"
DELEGATION="${3:-${INVENTARIO_DELEGATION:-}}"

if [[ -z "$API_URL" || -z "$TOKEN" ]]; then
  echo "Uso: sudo ./install.sh https://inventario.midominio.com/api invagt_... 'Delegacion'" >&2
  exit 2
fi

install -d -m 0755 /opt/inventario-agent
install -m 0755 "$(dirname "$0")/inventory-agent.py" /opt/inventario-agent/inventory-agent.py
cat >/etc/inventario-agent.env <<EOF
INVENTARIO_API_URL=$API_URL
INVENTARIO_AGENT_TOKEN=$TOKEN
INVENTARIO_DELEGATION=$DELEGATION
EOF
chmod 0600 /etc/inventario-agent.env
install -m 0644 "$(dirname "$0")/inventory-agent.service" /etc/systemd/system/inventory-agent.service
install -m 0644 "$(dirname "$0")/inventory-agent.timer" /etc/systemd/system/inventory-agent.timer
systemctl daemon-reload
systemctl enable --now inventory-agent.timer
systemctl start inventory-agent.service || true
echo "Agente Linux instalado. Timer: inventory-agent.timer"
