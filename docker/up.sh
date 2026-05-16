#!/usr/bin/env bash
# JaViSWo — bring up Pi-hole DNS (and optionally nginx).
#
# Pi-hole replaces our earlier dnsmasq + AdGuard combo. It does
# everything dnsmasq did (custom DNS records, forwarding, caching) plus
# its own blocklists and a web UI on http://localhost:8053/admin/.
#
# Usage:
#   ./docker/up.sh                # DNS only with family-safe filtering
#   ./docker/up.sh nginx          # DNS + nginx on 80/443
#   UPSTREAM_PROFILE=clean ./docker/up.sh   # override profile

set -euo pipefail

cd "$(dirname "$0")"

# ── Profile → upstream IP pair (same-provider for consistent blocking) ─
apply_profile() {
  local profile="${1:-family}"
  case "$profile" in
    family)  echo "1.1.1.3 1.0.0.3" ;;             # Cloudflare Family
    clean)   echo "1.1.1.2 1.0.0.2" ;;             # Cloudflare Security
    adblock) echo "94.140.14.14 94.140.15.15" ;;   # AdGuard Default
    vanilla) echo "1.1.1.1 1.0.0.1" ;;             # Cloudflare
    *)       echo "1.1.1.3 1.0.0.3" ;;             # default to family
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
elif [[ -n "${UPSTREAM_PROFILE:-}" ]]; then
  # Switch profile in existing .env
  read -r UP1 UP2 <<< "$(apply_profile "$UPSTREAM_PROFILE")"
  sed -i.bak "s|^UPSTREAM_PROFILE=.*|UPSTREAM_PROFILE=${UPSTREAM_PROFILE}|" .env
  sed -i.bak "s|^UPSTREAM_DNS_1=.*|UPSTREAM_DNS_1=${UP1}|" .env
  sed -i.bak "s|^UPSTREAM_DNS_2=.*|UPSTREAM_DNS_2=${UP2}|" .env
  rm -f .env.bak
  echo "Switched profile to ${UPSTREAM_PROFILE} → ${UP1} + ${UP2}"
fi

# ── Generate Pi-hole custom DNS records from .env ──────────────────────
# Pi-hole reads /etc/pihole/custom.list as a hosts file at startup. We
# write it INSIDE the etc-pihole bind-mount (not as a separate single-
# file mount, which conflicts with the directory mount). Pi-hole picks
# it up on boot.
HOST_IP=$(grep '^HOST_IP=' .env | cut -d= -f2)
mkdir -p pihole/etc-pihole
cat > pihole/etc-pihole/custom.list <<EOF
${HOST_IP} javiswo.local
${HOST_IP} cockpit.local
${HOST_IP} jarvis.local
EOF
echo "Wrote pihole/etc-pihole/custom.list with HOST_IP=${HOST_IP}"

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker daemon isn't running."
  echo "  Open Docker Desktop, wait for the whale icon to settle, then re-run."
  exit 1
fi

if [[ "${1:-}" == "nginx" ]]; then
  docker compose --profile nginx up -d
  echo
  echo "✓ Pi-hole DNS + nginx up. Cockpit reachable at:"
  echo "    https://javiswo.local       (port 443)"
  echo "    https://cockpit.local       (alias)"
  echo "    https://jarvis.local        (alias)"
else
  docker compose up -d dns
  echo
  echo "✓ Pi-hole DNS up. Cockpit reachable at:"
  echo "    https://javiswo.local:8788  (cockpit's own HTTPS port)"
fi
echo
PROFILE=$(grep '^UPSTREAM_PROFILE=' .env | cut -d= -f2)
PASS=$(grep '^PIHOLE_PASSWORD=' .env | cut -d= -f2)
echo "Content filter active: UPSTREAM_PROFILE=${PROFILE}"
case "$PROFILE" in
  family)  echo "  Blocking: malware, phishing, adult content (via Cloudflare Family)" ;;
  clean)   echo "  Blocking: malware (via Cloudflare Security)" ;;
  adblock) echo "  Blocking: ads + trackers (via AdGuard Default)" ;;
  vanilla) echo "  Upstream filtering OFF — only Pi-hole's own adlists apply" ;;
esac
echo
echo "Pi-hole admin UI:  http://localhost:8053/admin/"
echo "Password:          ${PASS}  (change in docker/.env then ./up.sh again)"
echo
echo "Add blocklists via the admin UI for stronger ad/malware coverage:"
echo "  Group Management → Adlists → Add"
echo "    https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts"
echo "    https://big.oisd.nl/   (large general blocklist)"
echo "    https://nsfw.oisd.nl/  (adult content, supplements family DNS)"
echo
echo "Switch profile any time:"
echo "    UPSTREAM_PROFILE=clean   ./docker/up.sh"
echo "    UPSTREAM_PROFILE=vanilla ./docker/up.sh"
