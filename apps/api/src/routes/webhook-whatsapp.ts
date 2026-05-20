import { Router, type Request, type Response } from 'express';
import type { WhatsAppInboundMessage } from '@devisvocal/types';
import { handleInboundMessage } from '../agent/dialogue.js';

const router = Router();

// Vérification webhook 360dialog (GET)
router.get('/', (req: Request, res: Response) => {
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (token === process.env.WHATSAPP_WEBHOOK_SECRET) {
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Forbidden');
  }
});

// Réception messages (POST)
router.post('/', async (req: Request, res: Response) => {
  // Répondre immédiatement 200 à 360dialog
  res.status(200).json({ status: 'ok' });

  try {
    const body = req.body as WebhookBody;
    const contacts = body.contacts ?? [];
    const messages = body.messages ?? [];

    for (const message of messages) {
      const from = message.from;
      const contact = contacts.find((c) => c.wa_id === from);

      const inbound: WhatsAppInboundMessage = {
        from,
        message_id: message.id,
        type: message.type as WhatsAppInboundMessage['type'],
        text: message.text?.body,
        audio_url: message.audio?.id,
        audio_mime: message.audio?.mime_type,
        timestamp: parseInt(message.timestamp, 10),
      };

      // Traitement asynchrone — ne pas bloquer le 200
      handleInboundMessage(inbound).catch((err) => {
        console.error(`[webhook] error processing message from ${from}:`, err);
      });
    }
  } catch (err) {
    console.error('[webhook] parse error:', err);
  }
});

export default router;

// ─── Types 360dialog ─────────────────────────────────────────────────────────

interface WebhookBody {
  contacts?: Array<{ profile: { name: string }; wa_id: string }>;
  messages?: Array<{
    from: string;
    id: string;
    timestamp: string;
    type: string;
    text?: { body: string };
    audio?: { id: string; mime_type: string };
    image?: { id: string; mime_type: string };
    document?: { id: string; filename: string; mime_type: string };
  }>;
}
