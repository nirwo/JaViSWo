#!/usr/bin/env bash
# JaViSWo — home network TLS setup
#
# One-shot script that:
#   1. Installs mkcert (via Homebrew) if missing
#   2. Installs the mkcert root CA into the macOS keychain so this Mac
#      trusts every cert mkcert generates — no more browser warnings.
#   3. (Optional) Sets the macOS LocalHostName so the cockpit is reachable
#      as <name>.local via Bonjour from any device on the LAN.
#   4. Regenerates the cockpit's TLS cert covering localhost, all LAN
#      IPs, and <name>.local — signed by the mkcert root CA.
#   5. Prints next steps for installing the CA on iPhone (so Safari
#      also trusts the cockpit's cert).
#
# Run on the Mac that hosts the cockpit:
#   ./scripts/setup-network.sh

set -euo pipefail

COCKPIT_TLS_DIR="$HOME/.cockpit/tls"
DEFAULT_NAME="javiswo"

bold()   { printf "\033[1m%s\033[0m\n" "$1"; }
green()  { printf "\033[32m%s\033[0m\n" "$1"; }
yellow() { printf "\033[33m%s\033[0m\n" "$1"; }
red()    { printf "\033[31m%s\033[0m\n" "$1"; }

bold "── JaViSWo home network TLS setup ───────────────────────────────"
echo

# ── Step 1: brew + mkcert ───────────────────────────────────────────────
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

# ── Step 2: install root CA in macOS keychain ──────────────────────────
bold "2. Installing local root CA in macOS keychain..."
mkcert -install
green "   ✓ CA trusted by this Mac (Chrome, Safari, Firefox)"
CAROOT="$(mkcert -CAROOT)"
echo "   CA root at: $CAROOT/rootCA.pem"
echo

# ── Step 3: optional LocalHostName ─────────────────────────────────────
CURRENT_HOSTNAME="$(scutil --get LocalHostName 2>/dev/null || hostname -s)"
bold "3. mDNS hostname"
echo "   Current LocalHostName: $CURRENT_HOSTNAME"
echo "   Reachable as: $CURRENT_HOSTNAME.local"
echo
read -r -p "   Rename this Mac to '$DEFAULT_NAME' for friendly URL javiswo.local? [y/N] " resp
NEW_NAME=""
if [[ "$resp" =~ ^[Yy]$ ]]; then
  NEW_NAME="$DEFAULT_NAME"
elif [[ "$resp" =~ ^[a-zA-Z][a-zA-Z0-9-]*$ ]]; then
  NEW_NAME="$resp"
fi

if [[ -n "$NEW_NAME" ]]; then
  yellow "   Setting LocalHostName to '$NEW_NAME' (requires sudo)..."
  sudo scutil --set LocalHostName "$NEW_NAME"
  green "   ✓ Bonjour name set. Reachable as $NEW_NAME.local from any device on the LAN."
  CURRENT_HOSTNAME="$NEW_NAME"
else
  yellow "   Skipped. Using existing name: $CURRENT_HOSTNAME.local"
fi
echo

# ── Step 4: regenerate cert ────────────────────────────────────────────
bold "4. Regenerating cockpit TLS cert..."
mkdir -p "$COCKPIT_TLS_DIR"
rm -f "$COCKPIT_TLS_DIR/cert.pem" "$COCKPIT_TLS_DIR/key.pem"

# Gather LAN IPs
LAN_IPS=$(ifconfig | awk '/inet / && $2 != "127.0.0.1" {print $2}' | tr '\n' ' ')

mkcert \
  -key-file "$COCKPIT_TLS_DIR/key.pem" \
  -cert-file "$COCKPIT_TLS_DIR/cert.pem" \
  localhost 127.0.0.1 ::1 \
  "$CURRENT_HOSTNAME.local" \
  "$CURRENT_HOSTNAME" \
  javiswo.local cockpit.local jarvis.local \
  $LAN_IPS

green "   ✓ Cert written to $COCKPIT_TLS_DIR/cert.pem"
echo "   Covers: localhost, $CURRENT_HOSTNAME.local, javiswo.local, $LAN_IPS"
echo

# ── Step 5: iPhone install instructions ────────────────────────────────
bold "5. iPhone setup (install root CA so Safari trusts the cockpit)"
echo
echo "   The cockpit serves the root CA at:"
echo "       http://$CURRENT_HOSTNAME.local:8787/tls/ca.pem"
echo "       http://$(echo $LAN_IPS | awk '{print $1}'):8787/tls/ca.pem"
echo
echo "   On iPhone:"
echo "   1. Open one of those URLs in Safari (HTTP is fine for downloading)."
echo "   2. Tap 'Allow' when Safari asks to download a configuration profile."
echo "   3. Settings → General → VPN & Device Management → tap the profile → Install."
echo "   4. Settings → General → About → Certificate Trust Settings →"
echo "      toggle ON for 'mkcert development CA <hostname>'."
echo
echo "   After that, https://$CURRENT_HOSTNAME.local:8788 works on iPhone"
echo "   with no SSL warning. Push-to-talk mic works (wake word stays"
echo "   Chrome-only — iOS Safari doesn't support continuous speech)."
echo

# ── Step 6: optional nginx ─────────────────────────────────────────────
bold "6. Optional: serve on standard port 443 via nginx"
echo
echo "   The cockpit currently listens on :8787 (HTTP) and :8788 (HTTPS)."
echo "   To use the standard https://$CURRENT_HOSTNAME.local with no port,"
echo "   install nginx and use the bundled config:"
echo
echo "       brew install nginx"
echo "       sudo cp docs/nginx-cockpit.conf /opt/homebrew/etc/nginx/servers/"
echo "       sudo brew services start nginx"
echo
echo "   Then edit /opt/homebrew/etc/nginx/servers/nginx-cockpit.conf to"
echo "   match your hostname ($CURRENT_HOSTNAME.local) and cert paths,"
echo "   then 'sudo nginx -s reload'."
echo

bold "── Done ────────────────────────────────────────────────────────"
green "Restart the cockpit to pick up the new cert:"
echo "    npm --workspace @cockpit/server run dev"
echo
green "Then open from any device on the LAN:"
echo "    https://$CURRENT_HOSTNAME.local:8788   (Mac, no warning)"
echo "    https://javiswo.local:8788             (also works — alias in cert)"
echo "    Push-to-talk works on iPhone after step 5."
