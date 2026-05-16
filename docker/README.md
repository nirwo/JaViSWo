# JaViSWo home network — Pi-hole DNS + nginx

Resolve `javiswo.local` to this Mac's LAN IP **without renaming the Mac**,
block ads / malware / adult content network-wide, and (optionally) serve
the cockpit on the standard HTTPS port 443.

Pi-hole is the brain: custom DNS records for the JaViSWo aliases,
configurable blocklists, web UI for stats and per-device controls,
DoH/DoT upstream support, and active maintenance. The legacy
`dnsmasq` setup was replaced because it load-balanced across Cloudflare
+ AdGuard with inconsistent blocking — Pi-hole's own blocklists work the
same regardless of which upstream answers.

## What's here

| File | Purpose |
|------|---------|
| `docker-compose.yml` | `pihole/pihole` + optional `nginx` (use `--profile nginx`) |
| `.env.example` | sample env — `HOST_IP`, `ROUTER_IP`, `UPSTREAM_PROFILE`, `PIHOLE_PASSWORD` |
| `nginx/javiswo.conf` | nginx config; mounts the mkcert TLS material from `~/.cockpit/tls/` |
| `up.sh` | one-shot wrapper: detects LAN IP, writes `.env`, generates Pi-hole custom DNS, runs `docker compose up -d` |
| `pihole/etc-pihole/` | Pi-hole's persisted config + adlists + custom DNS (bind-mounted into the container) |

## Pi-hole admin

After `./up.sh`, the web UI is on `http://localhost:8053/admin/`. The
default password is **`changeme`** — change it via `docker/.env`
(`PIHOLE_PASSWORD=...`) then rerun `./up.sh`. The UI is bound to
`127.0.0.1` so the LAN can't reach it; SSH-tunnel if you need remote
access.

In the UI you can:

- **Group Management → Adlists** — add blocklists (StevenBlack hosts,
  OISD, AdGuard DNS filter, nsfw.oisd.nl, etc).
- **Group Management → Domains** — allowlist/denylist individual hosts.
- **Settings → DNS** — change upstream resolvers (or stick with the
  family-safe profile from `.env`).
- **Query Log** — see exactly what each device is asking for and which
  domains got blocked. Useful for debugging "why is X not loading?"

## Quick start

```bash
cd docker
./up.sh           # DNS only — keep the cockpit's own HTTPS on :8788
./up.sh nginx     # DNS + nginx — gets you https://javiswo.local on :443
```

The first run auto-detects the Mac's LAN IP and writes `.env`. Edit
`docker/.env` if you ever change networks or want a static IP.

## DNS — point your devices at this Mac

dnsmasq listens on this Mac at port 53. To use it, devices on the LAN
need to be told this Mac is their DNS server. Two options.

### Option A — Router-wide (recommended)

If your router lets you set custom DNS for the whole LAN, set the
primary DNS to this Mac's IP (e.g., `10.100.102.26`). Every device that
gets a DHCP lease will use it automatically; no per-device config.

### Option B — Per-device

- **macOS:** System Settings → Network → tap your active service → Details
  → DNS tab → click `+` → enter the Mac's IP.
- **iPhone / iPad:** Settings → Wi-Fi → tap the `(i)` next to your network
  → Configure DNS → Manual → Add Server → enter the Mac's IP.
- **Windows:** Settings → Network & Internet → Wi-Fi → Hardware properties
  → DNS server assignment → Edit → IPv4 → enter the Mac's IP.

After that, `https://javiswo.local:8788` (or `https://javiswo.local` if
you ran with `nginx`) works from any of those devices.

## Trust the cert on each device

The cockpit's HTTPS cert is signed by `mkcert`'s local CA. For
warning-free browsing, install that CA on each device:

- **This Mac:** `sudo mkcert -install` once. After that, Chrome / Safari
  / Firefox all trust the cert.
- **iPhone:** open `http://javiswo.local:8787/tls/ca.pem` in Safari →
  Allow → Settings → General → VPN & Device Management → install the
  profile → Settings → General → About → Certificate Trust Settings →
  toggle on for the `mkcert` root.

## Verify

```bash
# Full health check (recommended)
./scripts/dns-health.sh

# Or manual:
dig @127.0.0.1 javiswo.local +short    # → Mac's LAN IP
dig @127.0.0.1 cloudflare.com +short   # → real IP (upstream alive)
```

## Content filtering — block ads, malware, and adult content

dnsmasq doesn't filter on its own — but it forwards every non-JaViSWo
query upstream to whatever DNS server you choose. By default, it
forwards to **Cloudflare Family + AdGuard Family**, both of which
block malware, phishing, ads, trackers, AND adult content. Result:
every device on the LAN that uses this Mac as DNS gets that protection
automatically, with no per-device profile install.

### Pick a profile

Edit `UPSTREAM_PROFILE` in `docker/.env`, or pass it inline:

```bash
UPSTREAM_PROFILE=family   ./docker/up.sh    # kid-safe (default)
UPSTREAM_PROFILE=clean    ./docker/up.sh    # ads + malware, no porn block
UPSTREAM_PROFILE=adblock  ./docker/up.sh    # ads only
UPSTREAM_PROFILE=vanilla  ./docker/up.sh    # no filtering
```

| Profile | Primary DNS | Secondary DNS | Blocks |
|---------|-------------|---------------|--------|
| `family` (default) | Cloudflare 1.1.1.3 | AdGuard 94.140.14.15 | Malware, phishing, ads, trackers, adult content |
| `clean` | Cloudflare 1.1.1.2 | AdGuard 94.140.14.14 | Malware, ads, trackers (no adult filter) |
| `adblock` | AdGuard 94.140.14.14 | Cloudflare 1.1.1.1 | Ads + trackers only |
| `vanilla` | Cloudflare 1.1.1.1 | Google 8.8.8.8 | Nothing — raw DNS |

### Router-local records still work

Even with content filtering active, dnsmasq scopes router lookups to
LAN-only domains:

```
--server=/lan/${ROUTER_IP}        # nas.lan, printer.lan, etc → router
--server=/home.arpa/${ROUTER_IP}  # IETF-standard LAN domain
--server=/in-addr.arpa/${ROUTER_IP}  # reverse lookups for private IPs
```

So your existing router DNS entries (NAS, printer, smart-home devices)
keep resolving through the router, while general internet queries go
through the filtered upstream. Best of both worlds.

### Verify the filter is active

```bash
./scripts/dns-health.sh
```

The health check now queries `malware.testcategory.com` (Cloudflare's
public test domain) and asserts it's blocked. On the `family` profile
it also tests `nsfw.testcategory.com`. Anything that should be blocked
but resolves to a real IP triggers a yellow warning.

## Safety: won't this break my LAN?

Putting the Mac in the DNS path is a real concern. The setup is hardened
against the five obvious ways it could break your network:

| Risk | Mitigation in this setup |
|------|--------------------------|
| **Mac sleeps or shuts down** | Always configure a **secondary DNS** (1.1.1.1 or your router) on each device. macOS/iOS race servers and fall back automatically. Auto-start Docker Desktop on login so the container comes back with the Mac. |
| **Docker container crashes** | `restart: unless-stopped` in compose + healthcheck that queries dnsmasq every 30s; Docker restarts the container if it stops answering. |
| **Router-local DNS records (nas.lan, etc) lost** | dnsmasq forwards unknown queries to **your router first**, then to public DNS. Whatever was in your router's local DNS table keeps working. |
| **Mac's LAN IP changes** | Reserve the Mac's IP in your router's DHCP (pinned by MAC address). Setup script prints this as a checklist item. |
| **The host Mac itself depending on Docker for DNS** | setup-network.sh installs `/etc/resolver/javiswo.local`, `/etc/resolver/cockpit.local`, `/etc/resolver/jarvis.local` — these route ONLY those domains to dnsmasq. Everything else on the Mac uses its normal DNS path, completely independent of the Docker container. |

The mac's per-domain resolver is the most important safeguard — it
means the host Mac (running the cockpit, doing development, etc) can't
break its own DNS even if the Docker container goes haywire.

### What if I don't want the Mac to be DNS for the whole LAN?

You don't have to. Two narrower options:

1. **Just this Mac** — install the resolver files (`/etc/resolver/`) and
   skip the per-device DNS setup on iPhone / others. Only this Mac can
   reach `javiswo.local`; iPhone needs to use the LAN IP
   (`https://10.x.x.x:8788`).

2. **Just this Mac + iPhone** — install resolvers on Mac, manually set
   primary DNS to this Mac's IP + secondary 1.1.1.1 on iPhone only.
   Other devices on the LAN are untouched. Best balance of "JARVIS
   works on iPhone" vs "don't put Mac in everyone's critical path."

3. **Whole LAN** — set router's primary DNS to this Mac, secondary to
   1.1.1.1. Every device gets `javiswo.local` automatically. Highest
   convenience, highest blast radius if Mac is down.

Pick the smallest scope that meets your needs.

## Teardown

```bash
cd docker
docker compose down            # stops both containers, removes them
docker compose down --rmi all  # also delete the images
```
