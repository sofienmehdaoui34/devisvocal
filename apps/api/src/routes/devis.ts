import { Router, type Request, type Response } from 'express';
import { getDevisByToken, getArtisanById, updateArtisan } from '../services/supabase.js';
import { createCheckoutSession } from '../services/stripe.js';
import { safeError } from '../utils/errors.js';

const router = Router();

const APP_URL = process.env.APP_URL ?? 'https://app.devisvocal.ch';

// GET /api/devis/:token — récupération pour la page web
router.get('/:token', async (req: Request, res: Response) => {
  const { token } = req.params;

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

  const {
    client_nom,
    client_email,
    client_adresse,
    client_telephone,
    artisan_nom_entreprise,
    artisan_prenom,
    artisan_email,
    artisan_telephone,
    artisan_adresse,
    artisan_siret,
  } = req.body as {
    client_nom?: string;
    client_email?: string;
    client_adresse?: string;
    client_telephone?: string;
    artisan_nom_entreprise?: string;
    artisan_prenom?: string;
    artisan_email?: string;
    artisan_telephone?: string;
    artisan_adresse?: string;
    artisan_siret?: string;
  };

  const clean = (v?: string) => {
    const t = v?.trim();
    return t ? t : undefined;
  };

  // ─── Sauvegarde profil artisan (écrase avec ce qui est fourni) ──────────────
  // Non-bloquant : une erreur (ex. colonne absente) ne doit pas casser le paiement.
  if (artisan) {
    const patch: Record<string, string> = {};
    const nom = clean(artisan_nom_entreprise) ?? clean(artisan_prenom);
    if (nom)                          patch.nom_entreprise = nom;
    if (clean(artisan_email))         patch.email = clean(artisan_email)!;
    if (clean(artisan_adresse))       patch.adresse = clean(artisan_adresse)!;
    if (clean(artisan_telephone))     patch.telephone = clean(artisan_telephone)!;
    if (clean(artisan_siret))         patch.siret = clean(artisan_siret)!;
    if (Object.keys(patch).length > 0) {
      try {
        await updateArtisan(artisan.id, patch);
        console.log(`[pay] profil artisan ${artisan.id} mis à jour:`, Object.keys(patch).join(', '));
      } catch (e) {
        console.error('[pay] échec sauvegarde artisan (non-bloquant):', e);
      }
    }
  }

  // ─── Sauvegarde infos client sur le devis (non-bloquant) ────────────────────
  const devisPatch: Record<string, string> = {};
  if (clean(client_nom))        devisPatch.client_nom = clean(client_nom)!;
  if (clean(client_email))      devisPatch.client_email = clean(client_email)!;
  if (clean(client_adresse))    devisPatch.client_adresse = clean(client_adresse)!;
  if (clean(client_telephone))  devisPatch.client_telephone = clean(client_telephone)!;
  if (Object.keys(devisPatch).length > 0) {
    const { updateDevisStatut } = await import('../services/supabase.js');
    try {
      await updateDevisStatut(devis.id, devis.statut, devisPatch);
      console.log(`[pay] infos client devis ${devis.id} sauvées:`, Object.keys(devisPatch).join(', '));
    } catch (e) {
      console.error('[pay] échec sauvegarde client (non-bloquant):', e);
    }
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
    console.error('[pay] Stripe error:', safeError(err));
    res.status(500).json({ error: 'Erreur paiement. Réessayez.' });
  }
});

export default router;
