import { Router, type Request, type Response } from 'express';
import express from 'express';
import type { WhatsAppInboundMessage } from '@devisvocal/types';
import { handleInboundMessage } from '../agent/dialogue.js';
import { whatsappChannel } from '../services/whatsapp.js';
import { safeError } from '../utils/errors.js';

const router = Router();

// ─── Vérification webhook Twilio (GET, optionnel) ─────────────────────────────

router.get('/', (_req: Request, res: Response) => {
  res.status(200).send('OK');
});

// ─── Réception messages Twilio WhatsApp (POST) ───────────────────────────────
// Twilio envoie du application/x-www-form-urlencoded

router.post('/', express.urlencoded({ extended: false }), async (req: Request, res: Response) => {
  // Répondre avec TwiML vide (obligatoire < 1s)
  res.status(200).type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

  try {
    const body   = req.body as Record<string, string>;
    const rawFrom = body.From ?? '';
    const from   = rawFrom.replace('whatsapp:', ''); // +41791234567
    const text   = body.Body ?? '';
    const numMedia = parseInt(body.NumMedia ?? '0', 10);
    const mediaUrl  = body.MediaUrl0;
    const mediaMime = body.MediaContentType0;

    if (!from) return;

    // Détecter le type : audio si media avec mime audio/*
    const isAudio = numMedia > 0 && mediaMime?.startsWith('audio/');

    const inbound: WhatsAppInboundMessage = {
      from,
      message_id: body.MessageSid ?? Date.now().toString(),
      type: isAudio ? 'audio' : 'text',
      text: text || undefined,
      audio_url: isAudio ? mediaUrl : undefined,
      audio_mime: isAudio ? mediaMime : undefined,
      timestamp: Math.floor(Date.now() / 1000),
    };

    handleInboundMessage(inbound, whatsappChannel).catch((err) => {
      console.error(`[whatsapp-webhook] error for ${from}:`, safeError(err));
    });
  } catch (err) {
    console.error('[whatsapp-webhook] parse error:', safeError(err));
  }
});

export default router;
