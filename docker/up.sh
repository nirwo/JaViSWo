#!/usr/bin/env bash
# JaViSWo — bring up Docker DNS (and optionally nginx).
#
# Usage:
#   ./docker/up.sh                # DNS only with family-safe filtering
#   ./docker/up.sh nginx          # DNS + nginx on 80/443
#   UPSTREAM_PROFILE=clean ./docker/up.sh   # override profile

set -euo pipefail

cd "$(dirname "$0")"

# ── Profile → upstream IP pairs ────────────────────────────────────────
# Pick the upstreams based on .env UPSTREAM_PROFILE (or env override).
# family   = Cloudflare Family + AdGuard Family (kid-safe, ads blocked)
# clean    = Cloudflare Malware + AdGuard Default (ads+malware, no porn block)
# adblock  = AdGuard Default + Cloudflare (aggressive ad block, no porn)
# vanilla  = 1.1.1.1 + 8.8.8.8 (no filtering at all)
apply_profile() {
  local profile="${1:-family}"
  case "$profile" in
    family)  echo "1.1.1.3 94.140.14.15" ;;
    clean)   echo "1.1.1.2 94.140.14.14" ;;
    adblock) echo "94.140.14.14 1.1.1.1" ;;
    vanilla) echo "1.1.1.1 8.8.8.8" ;;
    *)       echo "1.1.1.3 94.140.14.15" ;;  # default to family
  esac
}

# ── Generate .env if missing ───────────────────────────────────────────
if [[ ! -f .env ]]; then
  cp .env.example .env
  HOST_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '127.0.0.1')"
  ROUTER_IP="$(netstat -nr 2>/dev/null | awk '/^default/ && $2 ~ /^[0-9]+\./ {print $2; exit}' || echo '1.1.1.1')"
  PROFILE="${UPSTREAM_PROFILE:-family}"
  read -r UP1 UP2 <<< "$(apply_profile "$PROFILE")"

  sed -i.bak "s|^HOST_IP=.*|HOST_IP=${HOST_IP}|" .env
  sed -i.bak "s|^ROUTER_IP=.*|ROUTER_IP=${ROUTER_IP}|" .env
  sed -i.bak "s|^UPSTREAM_PROFILE=.*|UPSTREAM_PROFILE=${PROFILE}|" .env
  sed -i.bak "s|^UPSTREAM_DNS_1=.*|UPSTREAM_DNS_1=${UP1}|" .env
  sed -i.bak "s|^UPSTREAM_DNS_2=.*|UPSTREAM_DNS_2=${UP2}|" .env
  rm -f .env.bak
  echo "Wrote .env:"
  echo "  HOST_IP=${HOST_IP}"
  echo "  ROUTER_IP=${ROUTER_IP}"
  echo "  UPSTREAM_PROFILE=${PROFILE} → ${UP1} + ${UP2}"
else
  # .env exists — but allow env override of profile this run
  if [[ -n "${UPSTREAM_PROFILE:-}" ]]; then
    read -r UP1 UP2 <<< "$(apply_profile "$UPSTREAM_PROFILE")"
    sed -i.bak "s|^UPSTREAM_PROFILE=.*|UPSTREAM_PROFILE=${UPSTREAM_PROFILE}|" .env
    sed -i.bak "s|^UPSTREAM_DNS_1=.*|UPSTREAM_DNS_1=${UP1}|" .env
    sed -i.bak "s|^UPSTREAM_DNS_2=.*|UPSTREAM_DNS_2=${UP2}|" .env
    rm -f .env.bak
    echo "Switched profile to ${UPSTREAM_PROFILE} → ${UP1} + ${UP2}"
  fi
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
PROFILE=$(grep '^UPSTREAM_PROFILE=' .env | cut -d= -f2)
echo "Content filter active: UPSTREAM_PROFILE=${PROFILE}"
case "$PROFILE" in
  family)  echo "  Blocking: malware, phishing, adult content, ads, trackers" ;;
  clean)   echo "  Blocking: malware, trackers, ads (NOT adult content)" ;;
  adblock) echo "  Blocking: ads and trackers (no other filtering)" ;;
  vanilla) echo "  No filtering — raw public DNS" ;;
esac
echo
echo "Switch profile any time:"
echo "    UPSTREAM_PROFILE=clean   ./docker/up.sh   # toggle to ads-only"
echo "    UPSTREAM_PROFILE=vanilla ./docker/up.sh   # disable filtering"
echo
echo "Next: set this Mac's IP as DNS server on the device(s) you want"
echo "to use. See docker/README.md for router / per-device steps."
