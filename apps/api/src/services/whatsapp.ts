import axios from 'axios';
import type { Channel } from './channel.js';
import { safeError } from '../utils/errors.js';
import { withRetry } from '../utils/retry.js';

const HTTP_TIMEOUT_MS = 30_000;

// ─── Helpers Twilio ───────────────────────────────────────────────────────────

const SID   = () => process.env.TWILIO_ACCOUNT_SID   ?? '';
const TOKEN = () => process.env.TWILIO_AUTH_TOKEN     ?? '';
const FROM  = () => toWA(process.env.TWILIO_WHATSAPP_NUMBER ?? '+14155238886');

function msgsUrl() {
  return `https://api.twilio.com/2010-04-01/Accounts/${SID()}/Messages.json`;
}

function toWA(number: string): string {
  return number.startsWith('whatsapp:') ? number : `whatsapp:${number}`;
}

// ─── Envoi texte ──────────────────────────────────────────────────────────────

// WhatsApp/Twilio limite un message à 1600 caractères (erreur 21617).
// On reste sous une marge de sécurité.
const MAX_LEN = 1500;

// Découpe un texte en morceaux ≤ MAX_LEN, en privilégiant les sauts de ligne.
function splitMessage(text: string, max = MAX_LEN): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    // Ligne unique trop longue → on la coupe brutalement.
    if (line.length > max) {
      if (current) { chunks.push(current); current = ''; }
      for (let i = 0; i < line.length; i += max) chunks.push(line.slice(i, i + max));
      continue;
    }
    if ((current ? current.length + 1 : 0) + line.length > max) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function sendText(to: string, text: string): Promise<void> {
  const sid   = SID();
  const token = TOKEN();
  const from  = FROM();

  if (!sid || !token) {
    console.error('[whatsapp] TWILIO_ACCOUNT_SID ou TWILIO_AUTH_TOKEN manquant !');
    return;
  }

  const toAddr = toWA(to);
  const parts = splitMessage(text);
  console.log(`[whatsapp] sendText → ${toAddr} (from: ${from})${parts.length > 1 ? ` [${parts.length} parties]` : ''}`);

  for (const part of parts) {
    try {
      const body = new URLSearchParams({ From: from, To: toAddr, Body: part });
      const res = await withRetry(
        () =>
          axios.post(msgsUrl(), body.toString(), {
            auth: { username: sid, password: token },
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: HTTP_TIMEOUT_MS,
          }),
        { retries: 2, label: 'twilio.sendText' }
      );
      console.log(`[whatsapp] message envoyé SID=${res.data?.sid} status=${res.data?.status}`);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        console.error('[whatsapp] Twilio API error:', err.response?.status, JSON.stringify(err.response?.data));
      } else {
        console.error('[whatsapp] sendText error:', safeError(err));
      }
      throw err;
    }
  }
}

// ─── Envoi document (PDF) ─────────────────────────────────────────────────────

export async function sendDocument(
  to: string,
  documentUrl: string,
  _filename: string,
  caption?: string
): Promise<void> {
  const sid   = SID();
  const token = TOKEN();
  const from  = FROM();

  if (!sid || !token) {
    console.error('[whatsapp] TWILIO_ACCOUNT_SID ou TWILIO_AUTH_TOKEN manquant !');
    return;
  }

  try {
    const body = new URLSearchParams({
      From: from,
      To: toWA(to),
      Body: caption ?? '',
      MediaUrl: documentUrl,
    });
    await withRetry(
      () =>
        axios.post(msgsUrl(), body.toString(), {
          auth: { username: sid, password: token },
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: HTTP_TIMEOUT_MS,
        }),
      { retries: 2, label: 'twilio.sendDocument' }
    );
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      console.error('[whatsapp] Twilio sendDocument error:', err.response?.status, JSON.stringify(err.response?.data));
    } else {
      console.error('[whatsapp] sendDocument error:', safeError(err));
    }
    throw err;
  }
}

// ─── Media — Twilio fournit l'URL directement dans le webhook ─────────────────

export async function getMediaUrl(mediaUrl: string): Promise<string> {
  return mediaUrl; // déjà une URL complète côté Twilio
}

export async function downloadMedia(mediaUrl: string): Promise<Buffer> {
  const res = await withRetry(
    () =>
      axios.get<ArrayBuffer>(mediaUrl, {
        responseType: 'arraybuffer',
        auth: { username: SID(), password: TOKEN() },
        timeout: HTTP_TIMEOUT_MS,
      }),
    { retries: 2, label: 'twilio.downloadMedia' }
  );
  return Buffer.from(res.data);
}

// ─── Canal Twilio WhatsApp (implémente Channel) ───────────────────────────────

export const whatsappChannel: Channel = {
  sendText,
  sendDocument,
  getMediaUrl,
  downloadMedia,
};
