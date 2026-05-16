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
elif docker ps --filter "name=javiswo-pihole" --filter "status=running" | grep -q javiswo-pihole; then
  green "javiswo-pihole container running"
else
  red "javiswo-pihole container NOT running — try: cd docker && ./up.sh"
  fails=$((fails+1))
fi
echo

# Helper: only return real answers, never error messages.
# dig +short prints query errors ("connection timed out") on stdout, so we
# need to filter them out. A real A-record answer is dotted IPv4/v6 text
# with no spaces or semicolons.
clean_dig() {
  dig @127.0.0.1 +short +time=2 +tries=1 "$@" 2>/dev/null \
    | grep -E '^[0-9a-fA-F\.:]+$' \
    | head -1
}

# 2. DNS resolves our anchors
bold "2. DNS resolution"
for host in javiswo.local cockpit.local jarvis.local; do
  result=$(clean_dig "$host")
  if [[ -z "$result" ]]; then
    red "$host did NOT resolve via 127.0.0.1 (container down?)"
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
result=$(clean_dig cloudflare.com)
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

# Cloudflare's malware.testcategory.com is the reliable filter probe:
# resolves to 0.0.0.0 on the family (1.1.1.3) and security (1.1.1.2)
# tiers, returns a real IP on vanilla 1.1.1.1. If this is blocked, the
# container is correctly pointing at a filtered upstream.
#
# (We don't probe nsfw.testcategory.com — Cloudflare apparently no
# longer classifies that meta-test as adult, so the result is
# misleading. The family resolver itself IS active per the malware
# probe; trust the profile config for adult-content blocking.)
malware_test=$(clean_dig malware.testcategory.com)
if [[ "$malware_test" == "0.0.0.0" ]] || [[ -z "$malware_test" ]]; then
  green "malware.testcategory.com BLOCKED (filter active)"
elif [[ "$PROFILE" == "vanilla" ]]; then
  green "malware.testcategory.com resolved to $malware_test (vanilla — no filter, as expected)"
else
  yellow "malware.testcategory.com resolved to $malware_test"
  yellow "  (expected blocked — re-run docker/up.sh to ensure latest config)"
fi
echo

# 3c. Pi-hole admin UI reachable?
bold "3c. Pi-hole admin UI"
if curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:8053/admin/ 2>/dev/null | grep -qE "200|301|302|401|403"; then
  green "Pi-hole admin UI reachable at http://localhost:8053/admin/"
else
  yellow "Pi-hole admin UI unreachable on http://localhost:8053/admin/"
  yellow "  (container may still be starting; wait 30s and retry)"
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
