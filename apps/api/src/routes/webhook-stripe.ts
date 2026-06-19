import { Router, type Request, type Response } from 'express';
import { constructWebhookEvent } from '../services/stripe.js';
import { handlePaymentSuccess } from '../agent/dialogue.js';
import { safeError } from '../utils/errors.js';

const router = Router();

// Ce handler doit recevoir le raw body (configuré dans index.ts)
router.post('/', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;

  let event;
  try {
    event = await constructWebhookEvent(req.body as Buffer, sig);
  } catch (err) {
    console.error('[stripe-webhook] signature verification failed:', safeError(err));
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
      };

      if (session.payment_status === 'paid') {
        // Le canal de renvoi est re-dérivé dans handlePaymentSuccess à partir
        // du numéro de l'artisan (devis → artisan.whatsapp_number).
        await handlePaymentSuccess(session.id, session.payment_intent);
      }
    }
  } catch (err) {
    console.error('[stripe-webhook] handler error:', safeError(err));
  }
});

export default router;
