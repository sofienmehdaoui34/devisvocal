import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getDevisByToken, getArtisanById, updateArtisan } from '../services/supabase.js';
import { createCheckoutSession } from '../services/stripe.js';
import { isDevisFree, freeDevisRemaining } from '../utils/pricing.js';
import { safeError } from '../utils/errors.js';

const router = Router();

const APP_URL = process.env.APP_URL ?? 'https://app.devisvocal.ch';

// ─── Validation du corps de POST /:token/pay ──────────────────────────────────
const optionalStr = (max: number) => z.string().trim().max(max).optional();
// Email optionnel : on traite la chaîne vide comme absente.
const optionalEmail = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().trim().email().max(200).optional()
);

const payBodySchema = z
  .object({
    client_nom: optionalStr(200),
    client_email: optionalEmail,
    client_adresse: optionalStr(300),
    client_telephone: optionalStr(40),
    artisan_nom_entreprise: optionalStr(200),
    artisan_prenom: optionalStr(100),
    artisan_email: optionalEmail,
    artisan_telephone: optionalStr(40),
    artisan_adresse: optionalStr(300),
    artisan_siret: optionalStr(60),
  })
  .strip();

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
  const is_free = artisan ? isDevisFree(artisan.devis_count) : false;
  const free_remaining = artisan ? freeDevisRemaining(artisan.devis_count) : 0;

  res.json({ devis, artisan, is_free, free_remaining });
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

  const parsedBody = payBodySchema.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    res.status(400).json({
      error: 'Données invalides',
      details: parsedBody.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
    return;
  }
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
  } = parsedBody.data;

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

  // ─── Devis offerts : les N premiers devis de l'artisan sont gratuits ────────
  // Pas de Stripe : on génère et livre directement, puis on renvoie l'utilisateur
  // sur la page du devis (qui s'affichera « payé », détail + PDF débloqués).
  if (artisan && isDevisFree(artisan.devis_count)) {
    try {
      const { deliverFreeDevis } = await import('../agent/dialogue.js');
      await deliverFreeDevis(devis.id);
      res.json({ url: `${APP_URL}/devis/${token}`, free: true });
    } catch (e) {
      console.error('[pay] génération du devis offert échouée:', safeError(e));
      res.status(500).json({ error: 'Erreur lors de la génération. Réessayez.' });
    }
    return;
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

// POST /api/devis/:id/redeliver — reprise de livraison (admin)
// Pour les devis payés mais dont la génération/envoi du PDF a échoué.
router.post('/:id/redeliver', async (req: Request, res: Response) => {
  const adminToken = process.env.ADMIN_API_TOKEN;
  if (!adminToken || req.headers['x-admin-token'] !== adminToken) {
    res.status(403).json({ error: 'Accès refusé' });
    return;
  }

  const { id } = req.params;
  const { getDevisById } = await import('../services/supabase.js');
  const devis = await getDevisById(id);
  if (!devis) {
    res.status(404).json({ error: 'Devis introuvable' });
    return;
  }
  if (devis.statut !== 'payé') {
    res.status(409).json({ error: `Reprise impossible (statut actuel : ${devis.statut})` });
    return;
  }

  const artisan = await getArtisanById(devis.artisan_id);
  if (!artisan) {
    res.status(404).json({ error: 'Artisan introuvable' });
    return;
  }

  const { deliverDevis } = await import('../agent/dialogue.js');
  await deliverDevis(devis, artisan);
  res.json({ ok: true, devis_id: devis.id });
});

export default router;
