// JaViSWo — TLS cert lifecycle
//
// Browsers refuse mic + speech APIs on non-secure origins. http://localhost
// is special-cased, but http://<lan-ip> is not — Chrome blocks
// webkitSpeechRecognition and getUserMedia silently. To make the cockpit
// usable from other devices on the LAN (Mac → iPhone, Mac → another Mac),
// we serve HTTPS on a second port using a self-signed certificate stored
// under ~/.cockpit/tls/.
//
// On first boot we generate the cert by shelling out to `mkcert` if
// installed (yields a locally-trusted cert with no browser warning) or
// `openssl` as a fallback (one-time "Advanced → Proceed" warning per
// device, then trusted for the session).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { hostname, networkInterfaces, homedir } from 'node:os';
import { join } from 'node:path';

const CERT_VALIDITY_DAYS = 825; // Apple's max
const CN = 'JaViSWo Cockpit (self-signed)';

export type TlsMaterial = { keyPath: string; certPath: string };

function tlsDir(): string {
  return join(homedir(), '.cockpit', 'tls');
}

function lanIPs(): string[] {
  const out: string[] = [];
  const ifs = networkInterfaces();
  for (const list of Object.values(ifs)) {
    if (!list) continue;
    for (const ni of list) {
      if (ni.internal) continue;
      if (ni.family !== 'IPv4') continue;
      out.push(ni.address);
    }
  }
  return out;
}

function which(bin: string): string | null {
  try {
    const out = execFileSync('which', [bin], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const path = out.toString('utf-8').trim();
    return path || null;
  } catch {
    return null;
  }
}

// mDNS hostnames — every Mac / iPhone on the LAN can resolve <name>.local
// via Bonjour without any DNS configuration. We include the machine's
// current LocalHostName and any extras from COCKPIT_TLS_EXTRA_HOSTS so the
// cert is valid for whichever name the user opens.
function mdnsHosts(): string[] {
  const out: string[] = [];
  const h = hostname().replace(/\.local$/, '');
  if (h) {
    out.push(`${h}.local`);
    out.push(h);
  }
  const extras = (process.env.COCKPIT_TLS_EXTRA_HOSTS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);
  for (const e of extras) {
    if (!out.includes(e)) out.push(e);
  }
  // Cert SAN covers every TLD we publish the JaViSWo aliases under.
  // .local works only for the host Mac (via /etc/resolver/) — iOS short-
  // circuits *.local to mDNS multicast and won't ask Pi-hole. So we ALSO
  // publish under .lan (de facto convention) and .home.arpa (RFC 8375)
  // — iPhone resolves those via unicast DNS to Pi-hole correctly.
  const aliases = [
    'javiswo.lan', 'cockpit.lan', 'jarvis.lan',
    'javiswo.home.arpa', 'cockpit.home.arpa', 'jarvis.home.arpa',
    'javiswo.local', 'cockpit.local', 'jarvis.local',
  ];
  for (const alias of aliases) {
    if (!out.includes(alias)) out.push(alias);
  }
  return out;
}

export function getCaRootPath(): string | null {
  if (which('mkcert') === null) return null;
  try {
    const out = execFileSync('mkcert', ['-CAROOT'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const dir = out.toString('utf-8').trim();
    if (!dir) return null;
    const ca = join(dir, 'rootCA.pem');
    return existsSync(ca) ? ca : null;
  } catch {
    return null;
  }
}

function existsAndFresh(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const st = statSync(path);
    const ageDays = (Date.now() - st.mtimeMs) / 86_400_000;
    return ageDays < CERT_VALIDITY_DAYS - 30;
  } catch {
    return false;
  }
}

function generateWithMkcert(dir: string, keyPath: string, certPath: string): boolean {
  const ips = lanIPs();
  const hosts = ['localhost', '127.0.0.1', '::1', ...mdnsHosts(), ...ips];
  // mkcert -install requires sudo to add to the system keychain. We try it
  // best-effort but don't fail if it errors — signing certs with the CA
  // root works regardless. The user can run `mkcert -install` once
  // manually to trust the CA on this Mac.
  try {
    execFileSync('mkcert', ['-install'], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    // sudo prompt missing or denied — proceed to sign anyway
  }
  try {
    execFileSync(
      'mkcert',
      ['-key-file', keyPath, '-cert-file', certPath, ...hosts],
      { stdio: ['ignore', 'pipe', 'pipe'], cwd: dir },
    );
    return existsSync(keyPath) && existsSync(certPath);
  } catch (err) {
    console.warn('[cockpit] mkcert sign failed, falling back to openssl:', (err as Error).message);
    return false;
  }
}

function generateWithOpenssl(keyPath: string, certPath: string): boolean {
  const ips = lanIPs();
  const dnsHosts = mdnsHosts();
  // SAN list — localhost + every mDNS .local hostname + every LAN IPv4 so
  // the cert covers wherever the user opens the cockpit from.
  const sanLines = [
    'DNS.1 = localhost',
    ...dnsHosts.map((h, i) => `DNS.${i + 2} = ${h}`),
    'IP.1 = 127.0.0.1',
    'IP.2 = ::1',
    ...ips.map((ip, i) => `IP.${i + 3} = ${ip}`),
  ].join('\n');

  const configBody = `
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_req
prompt = no

[req_distinguished_name]
CN = ${CN}

[v3_req]
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
${sanLines}
`.trim();

  const configPath = join(homedir(), '.cockpit', 'tls', 'openssl.cnf');
  try {
    writeFileSync(configPath, configBody, 'utf-8');
    execFileSync(
      'openssl',
      [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-days', String(CERT_VALIDITY_DAYS),
        '-keyout', keyPath,
        '-out', certPath,
        '-config', configPath,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return existsSync(keyPath) && existsSync(certPath);
  } catch (err) {
    console.error('[cockpit] openssl cert generation failed:', (err as Error).message);
    return false;
  }
}

export function ensureTlsCert(): TlsMaterial | null {
  const dir = tlsDir();
  try { mkdirSync(dir, { recursive: true }); } catch { /* exists */ }

  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');

  if (existsAndFresh(keyPath) && existsAndFresh(certPath)) {
    return { keyPath, certPath };
  }

  const useMkcert = which('mkcert') !== null;
  const ok = useMkcert
    ? generateWithMkcert(dir, keyPath, certPath) || generateWithOpenssl(keyPath, certPath)
    : generateWithOpenssl(keyPath, certPath);

  if (!ok) return null;
  const mode = useMkcert ? 'mkcert (locally trusted)' : 'self-signed (one-time browser warning)';
  console.log(`[cockpit] TLS cert ready at ${certPath} — ${mode}`);
  return { keyPath, certPath };
}

export function readTlsMaterial(m: TlsMaterial): { key: Buffer; cert: Buffer } {
  return {
    key: readFileSync(m.keyPath),
    cert: readFileSync(m.certPath),
  };
}

export function getLanUrls(httpsPort: number): string[] {
  return lanIPs().map((ip) => `https://${ip}:${httpsPort}`);
}
