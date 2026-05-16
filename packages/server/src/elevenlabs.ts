// JaViSWo — ElevenLabs TTS client
//
// Reads ~/.cockpit/elevenlabs.env at module load. The cockpit server
// proxies TTS requests to ElevenLabs so the API key never reaches the
// browser. If the env file is missing or the key isn't present, the
// /api/jarvis/voice endpoint returns 503 and the frontend falls back
// to browser SpeechSynthesis.
//
// File format (KEY=value, gitignored):
//   ELEVENLABS_API_KEY=sk_...
//   ELEVENLABS_VOICE_ID=JBFqnCBsd6RMkjVDRZzb     # George (British male)
//   ELEVENLABS_MODEL=eleven_turbo_v2_5

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type ElevenLabsConfig = {
  apiKey: string;
  voiceId: string;
  model: string;
};

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  const content = readFileSync(path, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    out[k] = v;
  }
  return out;
}

export function loadElevenLabsConfig(): ElevenLabsConfig | null {
  const envPath = join(homedir(), '.cockpit', 'elevenlabs.env');
  const env = parseEnvFile(envPath);
  // Env vars on the process take precedence over the file.
  const apiKey = process.env.ELEVENLABS_API_KEY ?? env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID ?? env.ELEVENLABS_VOICE_ID;
  const model = process.env.ELEVENLABS_MODEL ?? env.ELEVENLABS_MODEL ?? 'eleven_turbo_v2_5';
  if (!apiKey || !voiceId) return null;
  return { apiKey, voiceId, model };
}

/**
 * Synthesize speech via the ElevenLabs TTS endpoint. Returns the upstream
 * Response so the caller can stream the MP3 body directly to the client
 * without buffering the whole audio in memory.
 *
 * Throws on network failure; returns a Response with non-2xx status for
 * upstream HTTP errors so the caller can surface the upstream error code.
 */
export async function synthesize(
  text: string,
  cfg: ElevenLabsConfig,
  overrides: { voiceId?: string; model?: string } = {},
): Promise<Response> {
  const voiceId = overrides.voiceId ?? cfg.voiceId;
  const model = overrides.model ?? cfg.model;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`;
  return fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': cfg.apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true,
      },
    }),
  });
}
