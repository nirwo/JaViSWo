#!/usr/bin/env bash
# JaViSWo — DNS health check
#
# Verifies the Docker dnsmasq container is up, answering for the
# JaViSWo hostnames, and that forwarding to upstream resolvers still
# works. Run after `./docker/up.sh` and any time you suspect DNS is
# broken.

set -uo pipefail

bold()   { printf "\033[1m%s\033[0m\n" "$1"; }
green()  { printf "  \033[32m✓ %s\033[0m\n" "$1"; }
red()    { printf "  \033[31m✗ %s\033[0m\n" "$1"; }
yellow() { printf "  \033[33m⚠ %s\033[0m\n" "$1"; }

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '')"
fails=0

bold "── JaViSWo DNS health check ──────────────────────────────────"
echo

# 1. Container running?
bold "1. Docker container"
if ! docker info >/dev/null 2>&1; then
  red "Docker daemon not running — open Docker Desktop"
  fails=$((fails+1))
elif docker ps --filter "name=javiswo-dns" --filter "status=running" | grep -q javiswo-dns; then
  green "javiswo-dns container running"
else
  red "javiswo-dns container NOT running — try: cd docker && ./up.sh"
  fails=$((fails+1))
fi
echo

# 2. DNS resolves our anchors
bold "2. DNS resolution"
for host in javiswo.local cockpit.local jarvis.local; do
  result=$(dig @127.0.0.1 +short +time=2 "$host" 2>/dev/null | head -1)
  if [[ -z "$result" ]]; then
    red "$host did NOT resolve via 127.0.0.1"
    fails=$((fails+1))
  elif [[ -n "$HOST_IP" && "$result" != "$HOST_IP" ]]; then
    yellow "$host resolved to $result (expected $HOST_IP — re-run setup)"
  else
    green "$host → $result"
  fi
done
echo

# 3. Upstream forwarding still works
bold "3. Upstream forwarding (so the LAN doesn't lose internet)"
result=$(dig @127.0.0.1 +short +time=2 cloudflare.com 2>/dev/null | head -1)
if [[ -z "$result" ]]; then
  red "cloudflare.com did NOT resolve via dnsmasq (forwarding broken)"
  fails=$((fails+1))
else
  green "cloudflare.com → $result (forwarding alive)"
fi
echo

# 3.5. Content filter active?
bold "3b. Content filter (malware + ads + adult blocking)"
PROFILE="unknown"
if [[ -f "$REPO_ROOT/docker/.env" ]]; then
  PROFILE=$(grep '^UPSTREAM_PROFILE=' "$REPO_ROOT/docker/.env" | cut -d= -f2 || echo "?")
fi
echo "  Active profile: $PROFILE"

# Cloudflare provides public test domains that resolve to 0.0.0.0
# (blocked) on family/malware tiers and to a real IP on vanilla.
# These give us a deterministic probe.
malware_test=$(dig @127.0.0.1 +short +time=2 malware.testcategory.com 2>/dev/null | head -1)
adult_test=$(dig @127.0.0.1 +short +time=2 nsfw.testcategory.com 2>/dev/null | head -1)

# Per Cloudflare docs, blocked queries return 0.0.0.0 or no answer.
if [[ "$malware_test" == "0.0.0.0" ]] || [[ -z "$malware_test" ]]; then
  green "malware.testcategory.com BLOCKED (filter active)"
else
  yellow "malware.testcategory.com resolved to $malware_test"
  yellow "  (expected blocked — filter may be off or test domain expired)"
fi

if [[ "$PROFILE" == "family" ]]; then
  if [[ "$adult_test" == "0.0.0.0" ]] || [[ -z "$adult_test" ]]; then
    green "nsfw.testcategory.com BLOCKED (family filter active)"
  else
    yellow "nsfw.testcategory.com resolved to $adult_test"
    yellow "  (expected blocked on family profile)"
  fi
fi
echo

# 4. Router-local records still answer (if router has any)
bold "4. Router-local records (do you have any?)"
if [[ -f /etc/resolv.conf ]]; then
  router=$(netstat -nr 2>/dev/null | awk '/^default/ && $2 ~ /^[0-9]+\./ {print $2; exit}')
  if [[ -n "$router" ]]; then
    # Try a common router-local name (router itself reverse lookup)
    if dig @127.0.0.1 +short +time=2 -x "$router" 2>/dev/null | grep -q '\.'; then
      green "Router PTR record reaches via dnsmasq forwarding"
    else
      yellow "Router PTR doesn't resolve — your router may not advertise local DNS"
    fi
  fi
fi
echo

# 5. Mac's own resolver scope
bold "5. macOS per-domain resolver (host doesn't depend on Docker)"
if [[ -f /etc/resolver/javiswo.local ]]; then
  green "/etc/resolver/javiswo.local exists — host scoped"
  cat /etc/resolver/javiswo.local | sed 's/^/      /'
else
  yellow "/etc/resolver/javiswo.local missing — run scripts/setup-network.sh"
fi
echo

# Summary
if [[ $fails -eq 0 ]]; then
  bold "── All checks passed ✓ ────────────────────────────────────────"
  exit 0
else
  bold "── $fails check(s) failed ✗ ──────────────────────────────────"
  exit 1
fi
