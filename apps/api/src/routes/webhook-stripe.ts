import { Router, type Request, type Response } from 'express';
import type { Channel } from '../services/channel.js';
import { constructWebhookEvent } from '../services/stripe.js';
import { handlePaymentSuccess } from '../agent/dialogue.js';
import * as telegram from '../services/telegram.js';
import * as whatsapp from '../services/whatsapp.js';

const router = Router();

// ─── Détecte le canal selon l'identifiant ────────────────────────────────────
// Telegram : ID numérique sans "+"  (ex: 1739274808)
// WhatsApp  : numéro E.164 avec "+" (ex: +41791234567)

function channelFor(number: string): Channel {
  if (number.startsWith('+')) {
    return {
      sendText:      whatsapp.sendText,
      sendDocument:  whatsapp.sendDocument,
      getMediaUrl:   whatsapp.getMediaUrl,
      downloadMedia: whatsapp.downloadMedia,
    };
  }
  return {
    sendText:      telegram.sendText,
    sendDocument:  telegram.sendDocument,
    getMediaUrl:   telegram.getMediaUrl,
    downloadMedia: telegram.downloadMedia,
  };
}

// Ce handler doit recevoir le raw body (configuré dans index.ts)
router.post('/', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;

  let event;
  try {
    event = await constructWebhookEvent(req.body as Buffer, sig);
  } catch (err) {
    console.error('[stripe-webhook] signature verification failed:', err);
    res.status(400).send(`Webhook Error: ${(err as Error).message}`);
    return;
  }

  res.status(200).json({ received: true });

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as {
        id: string;
        payment_status: string;
        payment_intent: string;
        metadata?: { artisan_number?: string };
      };

      if (session.payment_status === 'paid') {
        const artisanNumber = session.metadata?.artisan_number ?? '';
        const channel = channelFor(artisanNumber);
        await handlePaymentSuccess(session.id, session.payment_intent, channel);
      }
    }
  } catch (err) {
    console.error('[stripe-webhook] handler error:', err);
  }
});

export default router;
