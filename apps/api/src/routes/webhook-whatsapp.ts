import { Router, type Request, type Response } from 'express';
import express from 'express';
import type { WhatsAppInboundMessage } from '@devisvocal/types';
import { handleInboundMessage } from '../agent/dialogue.js';
import { whatsappChannel } from '../services/whatsapp.js';
import { validateTwilioSignature } from '../utils/twilio-signature.js';
import { safeError } from '../utils/errors.js';

const router = Router();

// Reconstruit l'URL publique vue par Twilio (pour valider la signature).
// Derrière le proxy Railway, on s'appuie sur WEBHOOK_BASE_URL si défini,
// sinon sur les en-têtes X-Forwarded-* (trust proxy activé dans index.ts).
function publicUrl(req: Request): string {
  const base = process.env.WEBHOOK_BASE_URL;
  if (base) return `${base.replace(/\/$/, '')}${req.originalUrl}`;
  return `${req.protocol}://${req.get('host')}${req.originalUrl}`;
}

// ─── Vérification webhook Twilio (GET, optionnel) ─────────────────────────────

router.get('/', (_req: Request, res: Response) => {
  res.status(200).send('OK');
});

// ─── Réception messages Twilio WhatsApp (POST) ───────────────────────────────
// Twilio envoie du application/x-www-form-urlencoded

router.post('/', express.urlencoded({ extended: false }), async (req: Request, res: Response) => {
  // ─── Authentification Twilio (X-Twilio-Signature) ───────────────────────────
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (authToken) {
    const signature = req.headers['x-twilio-signature'] as string | undefined;
    const ok = validateTwilioSignature(
      authToken,
      signature,
      publicUrl(req),
      req.body as Record<string, string>
    );
    if (!ok) {
      console.warn('[whatsapp-webhook] signature Twilio invalide — requête rejetée');
      res.status(403).send('Invalid signature');
      return;
    }
  } else {
    console.warn('[whatsapp-webhook] TWILIO_AUTH_TOKEN absent — validation de signature désactivée (dev)');
  }

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
