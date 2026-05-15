#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "[cockpit] installing dependencies…"
  npm install
fi

echo "[cockpit] starting on ${COCKPIT_HOST:-0.0.0.0}:${COCKPIT_PORT:-8787}"
echo "[cockpit] Mac LAN IP:  $(ipconfig getifaddr en0 2>/dev/null || echo unknown)"
echo "[cockpit] open http://localhost:${COCKPIT_PORT:-8787} or the LAN IP above from any device"

exec npm --workspace @cockpit/server run dev
