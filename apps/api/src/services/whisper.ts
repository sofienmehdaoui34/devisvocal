import OpenAI from 'openai';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { downloadMedia } from './whatsapp.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function transcribeAudioFromUrl(
  mediaUrl: string,
  mimeType = 'audio/ogg'
): Promise<string> {
  const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'ogg';
  const tmpFile = path.join(os.tmpdir(), `dv_audio_${Date.now()}.${ext}`);

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
