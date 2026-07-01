import OpenAI from 'openai';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { withRetry, withTimeout } from '../utils/retry.js';

const WHISPER_TIMEOUT_MS = 60_000; // l'audio peut être long

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY manquant — transcription vocale désactivée');
    // maxRetries: 0 → backoff géré par withRetry.
    _openai = new OpenAI({ apiKey: key, maxRetries: 0 });
  }
  return _openai;
}

// Extension de fichier à partir du mime type
function extFromMime(mime?: string): string {
  if (!mime) return '.ogg';
  if (mime.includes('mp4') || mime.includes('m4a')) return '.mp4';
  if (mime.includes('mpeg') || mime.includes('mp3')) return '.mp3';
  if (mime.includes('wav'))                           return '.wav';
  if (mime.includes('webm'))                          return '.webm';
  return '.ogg'; // OGG/Opus — défaut Telegram & WhatsApp
}

/**
 * Transcrit un buffer audio via OpenAI Whisper.
 * Compatible Telegram (OGG/Opus) et WhatsApp Twilio (OGG/MP4).
 */
export async function transcribeAudioBuffer(
  buffer: Buffer,
  mimeType?: string
): Promise<string> {
  const openai = getOpenAI();
  const ext    = extFromMime(mimeType);
  const tmpFile = path.join(os.tmpdir(), `dv_audio_${Date.now()}${ext}`);

  fs.writeFileSync(tmpFile, buffer);
  try {
    const transcription = await withRetry(
      () =>
        withTimeout(
          openai.audio.transcriptions.create({
            // createReadStream à chaque tentative : un stream consommé n'est pas réutilisable.
            file:     fs.createReadStream(tmpFile),
            model:    'whisper-1',
            language: 'fr',
          }),
          WHISPER_TIMEOUT_MS,
          'Whisper transcription'
        ),
      { retries: 2, label: 'whisper' }
    );
    return transcription.text;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}
