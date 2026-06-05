import axios from 'axios';
import type { Channel } from './channel.js';

// ─── Helpers Twilio ───────────────────────────────────────────────────────────

const SID   = () => process.env.TWILIO_ACCOUNT_SID   ?? '';
const TOKEN = () => process.env.TWILIO_AUTH_TOKEN     ?? '';
const FROM  = () => process.env.TWILIO_WHATSAPP_NUMBER ?? 'whatsapp:+14155238886';

function msgsUrl() {
  return `https://api.twilio.com/2010-04-01/Accounts/${SID()}/Messages.json`;
}

function toWA(number: string): string {
  return number.startsWith('whatsapp:') ? number : `whatsapp:${number}`;
}

// ─── Envoi texte ──────────────────────────────────────────────────────────────

export async function sendText(to: string, text: string): Promise<void> {
  const sid   = SID();
  const token = TOKEN();
  const from  = FROM();

  if (!sid || !token) {
    console.error('[whatsapp] TWILIO_ACCOUNT_SID ou TWILIO_AUTH_TOKEN manquant !');
    return;
  }

  const toAddr = toWA(to);
  console.log(`[whatsapp] sendText → ${toAddr} (from: ${from})`);

  try {
    const body = new URLSearchParams({ From: from, To: toAddr, Body: text });
    const res = await axios.post(msgsUrl(), body.toString(), {
      auth: { username: sid, password: token },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    console.log(`[whatsapp] message envoyé SID=${res.data?.sid} status=${res.data?.status}`);
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      console.error('[whatsapp] Twilio API error:', err.response?.status, JSON.stringify(err.response?.data));
    } else {
      console.error('[whatsapp] sendText error:', err);
    }
    throw err;
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
    await axios.post(msgsUrl(), body.toString(), {
      auth: { username: sid, password: token },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      console.error('[whatsapp] Twilio sendDocument error:', err.response?.status, JSON.stringify(err.response?.data));
    } else {
      console.error('[whatsapp] sendDocument error:', err);
    }
    throw err;
  }
}

// ─── Media — Twilio fournit l'URL directement dans le webhook ─────────────────

export async function getMediaUrl(mediaUrl: string): Promise<string> {
  return mediaUrl; // déjà une URL complète côté Twilio
}

export async function downloadMedia(mediaUrl: string): Promise<Buffer> {
  const res = await axios.get<ArrayBuffer>(mediaUrl, {
    responseType: 'arraybuffer',
    auth: { username: SID(), password: TOKEN() },
  });
  return Buffer.from(res.data);
}

// ─── Canal Twilio WhatsApp (implémente Channel) ───────────────────────────────

export const whatsappChannel: Channel = {
  sendText,
  sendDocument,
  getMediaUrl,
};
