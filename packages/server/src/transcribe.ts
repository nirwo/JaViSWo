import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type TranscribeResult = {
  ok: boolean;
  text?: string;
  model_used?: string;
  duration_ms?: number;
  error?: { code: string; tried: string[]; detail?: string };
};

async function runProcess(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let so = '';
    let se = '';
    child.stdout.on('data', (d) => { so += d.toString('utf-8'); });
    child.stderr.on('data', (d) => { se += d.toString('utf-8'); });
    const t = setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs ?? 120_000);
    child.on('exit', (code) => {
      clearTimeout(t);
      resolve({ code: code ?? 0, stdout: so, stderr: se });
    });
  });
}

function whichSync(cmd: string): boolean {
  try {
    execFileSync('which', [cmd], { stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch { return false; }
}

async function convertToWav(inPath: string, outPath: string): Promise<boolean> {
  if (!whichSync('ffmpeg')) return false;
  const r = await runProcess('ffmpeg', [
    '-y', '-i', inPath, '-ar', '16000', '-ac', '1', outPath,
  ], { timeoutMs: 20_000 });
  return r.code === 0;
}

async function transcribeWithOpenAiCli(wavPath: string, tmp: string): Promise<string | null> {
  if (!whichSync('whisper')) return null;
  const r = await runProcess('whisper', [
    wavPath,
    '--model', 'base',
    '--output_format', 'txt',
    '--output_dir', tmp,
    '--language', 'en',
  ], { timeoutMs: 180_000 });
  if (r.code !== 0) return null;
  const base = wavPath.split('/').pop()!.replace(/\.[^.]+$/, '');
  try { return readFileSync(join(tmp, base + '.txt'), 'utf-8').trim() || null; } catch { return null; }
}

async function transcribeWithOpenAiApi(audioBytes: Buffer): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const form = new FormData();
  const blob = new Blob([audioBytes], { type: 'audio/webm' });
  form.append('file', blob, 'audio.webm');
  form.append('model', 'whisper-1');
  form.append('language', 'en');
  try {
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!r.ok) return null;
    const j = await r.json() as { text?: string };
    return (j.text || '').trim() || null;
  } catch { return null; }
}

export async function transcribe(audioBuf: Buffer, sourceFormat: string): Promise<TranscribeResult> {
  const start = Date.now();
  const tmp = mkdtempSync(join(tmpdir(), 'cockpit-stt-'));
  const ext = sourceFormat.includes('webm') ? '.webm'
    : sourceFormat.includes('wav') ? '.wav'
    : '.audio';
  const inPath = join(tmp, 'in' + ext);
  const wavPath = join(tmp, 'in.wav');
  writeFileSync(inPath, audioBuf);

  const tried: string[] = [];
  let usedWav = inPath;

  if (ext !== '.wav') {
    const ok = await convertToWav(inPath, wavPath);
    if (ok) {
      usedWav = wavPath;
    } else {
      tried.push('ffmpeg-convert-failed');
    }
  }

  async function tryBackend(
    name: string,
    fn: () => Promise<string | null>,
  ): Promise<string | null> {
    tried.push(name);
    try { return await fn(); } catch { return null; }
  }

  try {
    // Try openai-whisper CLI first (confirmed installed at /opt/anaconda3/bin/whisper)
    let text = await tryBackend('whisper-cli', () => transcribeWithOpenAiCli(usedWav, tmp));
    if (text === null) {
      text = await tryBackend('openai-api', () => transcribeWithOpenAiApi(audioBuf));
    }

    if (text === null) {
      return { ok: false, error: { code: 'NO_BACKEND', tried } };
    }

    // The last backend in `tried` is always the one that succeeded,
    // because we return immediately on first non-null result.
    const modelUsed = tried[tried.length - 1];

    return { ok: true, text, model_used: modelUsed, duration_ms: Date.now() - start };
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}
