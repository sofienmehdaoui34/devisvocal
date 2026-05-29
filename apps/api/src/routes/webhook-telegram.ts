import { Router, type Request, type Response } from 'express';
import type { WhatsAppInboundMessage } from '@devisvocal/types';
import { handleInboundMessage } from '../agent/dialogue.js';

const router = Router();

// POST /webhook/telegram — Telegram envoie tous les updates ici
router.post('/', async (req: Request, res: Response) => {
  // Répondre immédiatement 200 à Telegram (obligatoire < 1s)
  res.status(200).json({ ok: true });

  try {
    const update = req.body as TelegramUpdate;
    const message = update.message;

    if (!message) return; // ignore les autres types d'update (edited_message, etc.)

    const chatId = String(message.chat.id);

    // Construire le message interne commun (même interface que la version WhatsApp)
    const inbound: WhatsAppInboundMessage = {
      from: chatId,
      message_id: String(message.message_id),
      type: message.voice ? 'audio' : 'text',
      text: message.text,
      audio_url: message.voice?.file_id,      // file_id Telegram (on résout en URL dans whisper)
      audio_mime: message.voice?.mime_type ?? 'audio/ogg',
      timestamp: message.date,
    };

    handleInboundMessage(inbound).catch((err) => {
      console.error(`[telegram-webhook] error for chat ${chatId}:`, err);
    });
  } catch (err) {
    console.error('[telegram-webhook] parse error:', err);
  }
});

export default router;

// ─── Types Telegram ───────────────────────────────────────────────────────────

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  date: number;
  chat: { id: number; type: string; first_name?: string; username?: string };
  from?: { id: number; first_name: string; username?: string };
  text?: string;
  voice?: { file_id: string; duration: number; mime_type?: string; file_size?: number };
  audio?: { file_id: string; mime_type?: string };
  document?: { file_id: string; file_name?: string; mime_type?: string };
}
