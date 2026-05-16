# JaViSWo home network — Docker DNS + nginx

Resolve `javiswo.local` to this Mac's LAN IP **without renaming the Mac**.
The setup runs a tiny dnsmasq container that answers DNS for the JaViSWo
hostnames and forwards everything else upstream. Optionally, an nginx
container terminates TLS on port 443 so the cockpit is reachable at
`https://javiswo.local` (no port in the URL).

## What's here

| File | Purpose |
|------|---------|
| `docker-compose.yml` | dnsmasq + optional nginx (use `--profile nginx`) |
| `.env.example` | sample env — `HOST_IP` gets baked into the dnsmasq command |
| `nginx/javiswo.conf` | nginx config the container loads; mounts the mkcert TLS material from `~/.cockpit/tls/` |
| `up.sh` | one-shot wrapper that detects this Mac's LAN IP, writes `.env`, and runs `docker compose up -d` |

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
# from the Mac
dig @127.0.0.1 javiswo.local +short
# → should print the Mac's LAN IP

# from another device (after setting DNS to the Mac's IP)
ping javiswo.local
# → should resolve and ping the Mac
```

## Teardown

```bash
cd docker
docker compose down            # stops both containers, removes them
docker compose down --rmi all  # also delete the images
```
