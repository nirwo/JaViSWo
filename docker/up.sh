#!/usr/bin/env bash
# JaViSWo — bring up Docker DNS (and optionally nginx).
#
# Usage:
#   ./docker/up.sh           # DNS only on port 53
#   ./docker/up.sh nginx     # DNS + nginx on 80/443

set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  cp .env.example .env
  HOST_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '127.0.0.1')"
  # Use a delimiter unlikely to appear in IPs
  sed -i.bak "s|^HOST_IP=.*|HOST_IP=${HOST_IP}|" .env
  rm -f .env.bak
  echo "Wrote .env with HOST_IP=${HOST_IP}"
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker daemon isn't running."
  echo "  Open Docker Desktop, wait for the whale icon to settle, then re-run."
  exit 1
fi

if [[ "${1:-}" == "nginx" ]]; then
  docker compose --profile nginx up -d
  echo
  echo "✓ DNS + nginx up. Cockpit reachable at:"
  echo "    https://javiswo.local       (port 443)"
  echo "    https://cockpit.local       (alias)"
  echo "    https://jarvis.local        (alias)"
else
  docker compose up -d dns
  echo
  echo "✓ DNS up. Cockpit reachable at:"
  echo "    https://javiswo.local:8788  (cockpit's own HTTPS port)"
fi
echo
echo "Next: set this Mac's IP as DNS server on the device(s) you want"
echo "to use. See docker/README.md for router / per-device steps."
