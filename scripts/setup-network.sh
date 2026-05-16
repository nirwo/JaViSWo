#!/usr/bin/env bash
# JaViSWo — home network TLS + DNS setup (no Mac rename required)
#
# What this script does:
#   1. Installs mkcert (via Homebrew) if missing.
#   2. Installs the mkcert root CA into the macOS system keychain so
#      this Mac trusts every cert mkcert generates (one-time sudo).
#   3. Regenerates the cockpit's TLS cert covering localhost, all LAN
#      IPs, and the JaViSWo hostnames (javiswo.local, cockpit.local,
#      jarvis.local) — signed by the mkcert root CA.
#   4. Brings up the Docker DNS container so javiswo.local resolves
#      to this Mac's LAN IP on every device that uses this Mac as
#      its DNS server.
#   5. Prints the steps to install the CA on iPhone and to point
#      devices at this Mac's DNS.
#
# Does NOT rename your Mac. javiswo.local resolves via the Docker
# dnsmasq container, not via Bonjour. iPhone and other Macs need to
# use this Mac's IP as their DNS server (router-wide, or per-device).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COCKPIT_TLS_DIR="$HOME/.cockpit/tls"

bold()   { printf "\033[1m%s\033[0m\n" "$1"; }
green()  { printf "\033[32m%s\033[0m\n" "$1"; }
yellow() { printf "\033[33m%s\033[0m\n" "$1"; }
red()    { printf "\033[31m%s\033[0m\n" "$1"; }

bold "── JaViSWo home network setup ──────────────────────────────────"
echo

# ── 1. Homebrew + mkcert ───────────────────────────────────────────────
if ! command -v brew >/dev/null 2>&1; then
  red "Homebrew not found. Install from https://brew.sh first."
  exit 1
fi

if ! command -v mkcert >/dev/null 2>&1; then
  bold "1. Installing mkcert..."
  brew install mkcert nss
  green "   ✓ mkcert installed"
else
  green "1. ✓ mkcert already installed"
fi
echo

# ── 2. Install root CA in macOS keychain (sudo prompt) ─────────────────
bold "2. Trusting the mkcert root CA on this Mac..."
echo "   This needs sudo to add the CA to the system keychain."
if sudo mkcert -install; then
  green "   ✓ CA trusted by Chrome, Safari, Firefox on this Mac"
else
  yellow "   ⚠ Skipped — you can re-run 'sudo mkcert -install' later."
fi
CAROOT="$(mkcert -CAROOT)"
echo "   CA root at: $CAROOT/rootCA.pem"
echo

# ── 3. Regenerate cockpit cert ─────────────────────────────────────────
bold "3. Regenerating cockpit TLS cert..."
mkdir -p "$COCKPIT_TLS_DIR"
rm -f "$COCKPIT_TLS_DIR/cert.pem" "$COCKPIT_TLS_DIR/key.pem"

LAN_IPS=$(ifconfig | awk '/inet / && $2 != "127.0.0.1" {print $2}' | tr '\n' ' ')
CURRENT_HOSTNAME="$(scutil --get LocalHostName 2>/dev/null || hostname -s)"

# Cert covers BOTH the Mac's existing Bonjour name and the JaViSWo
# aliases — so it works whether you reach the cockpit via the
# Bonjour name or via the Docker-DNS-resolved javiswo.local.
mkcert \
  -key-file "$COCKPIT_TLS_DIR/key.pem" \
  -cert-file "$COCKPIT_TLS_DIR/cert.pem" \
  localhost 127.0.0.1 ::1 \
  "$CURRENT_HOSTNAME.local" "$CURRENT_HOSTNAME" \
  javiswo.local cockpit.local jarvis.local \
  $LAN_IPS

green "   ✓ Cert written to $COCKPIT_TLS_DIR/cert.pem"
echo "   Covers: localhost, $CURRENT_HOSTNAME.local, javiswo.local, cockpit.local, jarvis.local, $LAN_IPS"
echo

# ── 4. Docker DNS ──────────────────────────────────────────────────────
bold "4. Starting Docker DNS (resolves javiswo.local → this Mac's IP)..."

if ! command -v docker >/dev/null 2>&1; then
  yellow "   ⚠ Docker CLI not found. Install Docker Desktop from"
  yellow "     https://docs.docker.com/desktop/install/mac-install/"
  yellow "     then re-run this script."
elif ! docker info >/dev/null 2>&1; then
  yellow "   ⚠ Docker daemon isn't running. Open Docker Desktop and"
  yellow "     wait for the whale icon to settle, then run:"
  yellow "         $REPO_ROOT/docker/up.sh"
else
  pushd "$REPO_ROOT/docker" >/dev/null
  ./up.sh
  popd >/dev/null
  green "   ✓ DNS container running on this Mac at port 53"
fi
echo

# ── 5. macOS per-domain resolver (host-side safety net) ────────────────
PRIMARY_IP=$(echo $LAN_IPS | awk '{print $1}')

bold "5. Install per-domain resolver on this Mac (recommended)"
echo
echo "   This makes ONLY *.javiswo.local queries go to dnsmasq."
echo "   Everything else uses the Mac's normal DNS path — so the Mac"
echo "   itself never depends on the Docker container for general"
echo "   internet resolution."
echo
read -r -p "   Install /etc/resolver/javiswo.local? (needs sudo) [Y/n] " resp
if [[ ! "$resp" =~ ^[Nn]$ ]]; then
  for domain in javiswo.local cockpit.local jarvis.local; do
    sudo mkdir -p /etc/resolver
    echo "nameserver 127.0.0.1" | sudo tee "/etc/resolver/$domain" >/dev/null
    sudo chmod 644 "/etc/resolver/$domain"
  done
  green "   ✓ /etc/resolver/{javiswo,cockpit,jarvis}.local installed"
else
  yellow "   Skipped. The Mac will use whatever its DNS is set to."
fi
echo

# ── 6. Other devices — safer DNS pairing ───────────────────────────────
bold "6. Point your other devices at this Mac as DNS server (with safety)"
echo
echo "   This Mac's IP: $PRIMARY_IP"
echo
yellow "   IMPORTANT: always set TWO DNS servers — Mac first, public DNS second."
yellow "   If this Mac sleeps or the Docker container dies, the device falls"
yellow "   back to the secondary DNS and the LAN doesn't lose internet."
echo
echo "   Per-device setup:"
echo "     macOS:   System Settings → Network → Details → DNS → +$PRIMARY_IP, +1.1.1.1"
echo "     iPhone:  Settings → Wi-Fi → tap (i) → Configure DNS → Manual"
echo "              → Add Server (2x): $PRIMARY_IP and 1.1.1.1"
echo "     Windows: Settings → Network → Wi-Fi → Hardware properties →"
echo "              DNS server → Edit → preferred: $PRIMARY_IP, alternate: 1.1.1.1"
echo
echo "   Router-wide (best, set once for whole LAN):"
echo "     In your router DHCP settings, set primary DNS = $PRIMARY_IP,"
echo "     secondary DNS = 1.1.1.1. Also reserve this Mac's IP by MAC"
echo "     address so it doesn't change across reboots."
echo

# ── 7. iPhone CA install instructions ──────────────────────────────────
bold "7. iPhone setup (install root CA so Safari trusts the cockpit)"
echo
echo "   1. On iPhone Safari, open:"
echo "          http://$PRIMARY_IP:8787/tls/ca.pem"
echo "      (HTTP is fine for downloading the CA itself.)"
echo "   2. Safari prompts 'Allow' to download a configuration profile"
echo "      → tap Allow."
echo "   3. Settings → General → VPN & Device Management → tap the"
echo "      profile → Install."
echo "   4. Settings → General → About → Certificate Trust Settings →"
echo "      toggle ON for 'mkcert development CA <hostname>'."
echo
echo "   After step 5 (DNS) and step 6 (CA), iPhone can open:"
echo "       https://javiswo.local:8788    (cockpit's own HTTPS)"
echo "       https://javiswo.local         (if you brought up nginx)"
echo

bold "── Done ────────────────────────────────────────────────────────"
green "Restart the cockpit to load the new cert (tsx watch auto-reloads):"
echo "    touch packages/server/src/index.ts"
echo
green "Verify DNS works:"
echo "    ./scripts/dns-health.sh           # full health check"
echo "    dig @127.0.0.1 javiswo.local +short    # should print $PRIMARY_IP"
echo
green "To bring up nginx on port 443 (so URL has no port):"
echo "    cd docker && ./up.sh nginx"
echo
yellow "Safety checklist (do all three for robustness):"
echo "    □ Reserve this Mac's IP ($PRIMARY_IP) in your router's DHCP"
echo "    □ Set secondary DNS to 1.1.1.1 on every device (failover)"
echo "    □ Keep Docker Desktop running; auto-start on login via"
echo "      Docker → Settings → General → Start Docker Desktop when you sign in"
