import OpenAI from 'openai';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getMediaUrl, downloadMedia } from './telegram.js';

let _openai: OpenAI | null = null;
function getOpenAI() {
  if (!_openai) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY manquant — transcription vocale désactivée');
    _openai = new OpenAI({ apiKey: key });
  }
  return _openai;
}

/**
 * Transcrit un audio Telegram (file_id) via Whisper.
 * Telegram envoie des fichiers OGG/Opus pour les messages vocaux.
 */
export async function transcribeAudioFromUrl(
  fileId: string,
  _mimeType = 'audio/ogg'
): Promise<string> {
  const openai = getOpenAI();
  // Résoudre le file_id en URL de téléchargement
  const mediaUrl = await getMediaUrl(fileId);

  const tmpFile = path.join(os.tmpdir(), `dv_audio_${Date.now()}.ogg`);
  const buffer = await downloadMedia(mediaUrl);
  fs.writeFileSync(tmpFile, buffer);

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile),
      model: 'whisper-1',
      language: 'fr',
    });
    return transcription.text;
  } finally {
    fs.unlinkSync(tmpFile);
  }
}
