import { Router, type Request, type Response } from 'express';
import { getDevisByToken, getArtisanById } from '../services/supabase.js';
import { verifyDevisToken } from '../utils/token.js';
import { createCheckoutSession } from '../services/stripe.js';

const router = Router();

const APP_URL = process.env.APP_URL ?? 'https://app.devisvocal.ch';

// GET /api/devis/:token — récupération pour la page web
router.get('/:token', async (req: Request, res: Response) => {
  const { token } = req.params;

  const payload = verifyDevisToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Token invalide ou expiré' });
    return;
  }

  const devis = await getDevisByToken(token);
  if (!devis) {
    res.status(404).json({ error: 'Devis introuvable' });
    return;
  }

  if (new Date(devis.expires_at) < new Date()) {
    res.status(410).json({ error: 'Ce lien a expiré (24h). Retournez sur WhatsApp pour en générer un nouveau.' });
    return;
  }

  const artisan = await getArtisanById(devis.artisan_id);

  res.json({ devis, artisan });
});

// POST /api/devis/:token/pay — création session Stripe Checkout
router.post('/:token/pay', async (req: Request, res: Response) => {
  const { token } = req.params;

  const payload = verifyDevisToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Token invalide ou expiré' });
    return;
  }

  const devis = await getDevisByToken(token);
  if (!devis) {
    res.status(404).json({ error: 'Devis introuvable' });
    return;
  }

  if (devis.statut === 'payé' || devis.statut === 'envoyé') {
    res.status(400).json({ error: 'Ce devis a déjà été payé' });
    return;
  }

  const artisan = await getArtisanById(devis.artisan_id);

  // Mettre à jour l'email client si fourni depuis la page web
  const { client_email } = req.body as { client_email?: string };
  if (client_email) {
    const { updateDevisStatut } = await import('../services/supabase.js');
    await updateDevisStatut(devis.id, devis.statut, { client_email });
  }

  // Si pas de clé Stripe → mode dev, on simule un lien direct
  if (!process.env.STRIPE_SECRET_KEY) {
    res.json({ url: `${APP_URL}/devis/${token}/success?session_id=dev` });
    return;
  }

  try {
    const { url } = await createCheckoutSession({
      devisToken: token,
      devisNumero: devis.numero,
      artisanEmail: artisan?.email,
      stripeCustomerId: artisan?.stripe_customer_id,
      appUrl: APP_URL,
    });
    res.json({ url });
  } catch (err) {
    console.error('[pay] Stripe error:', err);
    res.status(500).json({ error: 'Erreur paiement. Réessayez.' });
  }
});

export default router;
