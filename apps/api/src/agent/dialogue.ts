import type { Session, Artisan, WhatsAppInboundMessage, SessionContext, Metier } from '@devisvocal/types';
import {
  findOrCreateArtisan,
  updateArtisan,
  getActiveSession,
  createSession,
  updateSession,
  completeSession,
  createDevis,
  incrementDevisCount,
  uploadPdf,
} from '../services/supabase.js';
import {
  sendText,
  sendDocument,
  getMediaUrl,
  MSG,
} from '../services/telegram.js';
import { transcribeAudioFromUrl } from '../services/whisper.js';
import {
  extractDevisFromText,
  computeTotals,
  buildRecapMessage,
  buildQuestionsMessage,
} from '../services/claude.js';
import { searchEntrepriseByName, searchEntrepriseBySiret } from '../services/entreprise.js';
import { createCheckoutSession, createOrGetStripeCustomer } from '../services/stripe.js';
import { sendDevisEmail } from '../services/email.js';
import { generateDevisToken } from '../utils/token.js';
import { generateDevisPdf } from '@devisvocal/pdf';

const APP_URL = process.env.APP_URL ?? 'https://app.devisvocal.ch';
const MAX_CLARIFICATION_ROUNDS = 2;

// ─── Point d'entrée principal ─────────────────────────────────────────────────

export async function handleInboundMessage(msg: WhatsAppInboundMessage): Promise<void> {
  const artisan = await findOrCreateArtisan(msg.from);

  let session = await getActiveSession(msg.from);
  if (!session) {
    session = await createSession(msg.from, artisan.id);
  }

  // Résoudre le texte (audio → Whisper si nécessaire)
  let text = '';
  if (msg.type === 'audio' && msg.audio_url) {
    await sendText(msg.from, MSG.attente_transcription());
    const mediaUrl = await getMediaUrl(msg.audio_url);
    text = await transcribeAudioFromUrl(mediaUrl, msg.audio_mime);
  } else {
    text = msg.text ?? '';
  }

  const rawCtx = session.context;
  const ctx: SessionContext = typeof rawCtx === 'string' ? (JSON.parse(rawCtx || '{}') as SessionContext) : (rawCtx as SessionContext) ?? {};

  switch (session.state) {
    case 'NEW':
      await handleNew(msg.from, artisan, session.id, ctx, text);
      break;

    case 'ONBOARDING':
      await handleOnboarding(msg.from, artisan, session.id, ctx, text);
      break;

    case 'COLLECTING':
      await handleCollecting(msg.from, artisan, session.id, ctx, text);
      break;

    case 'CLARIFYING':
      await handleClarifying(msg.from, artisan, session.id, ctx, text);
      break;

    case 'RECAP_SENT':
      await handleRecapResponse(msg.from, artisan, session.id, ctx, text);
      break;

    case 'AWAITING_PAYMENT':
      await sendText(msg.from, `Votre lien de paiement est déjà actif :\n${ctx.stripe_url}\n\nSi vous avez déjà payé, patientez quelques secondes.`);
      break;

    case 'COMPLETED':
      // Démarrer un nouveau devis
      const newSession = await createSession(msg.from, artisan.id);
      await handleNew(msg.from, artisan, newSession.id, {}, text);
      break;

    default:
      await sendText(msg.from, MSG.erreur_generique());
  }
}

// ─── États ────────────────────────────────────────────────────────────────────

async function handleNew(
  from: string,
  artisan: Artisan,
  sessionId: string,
  ctx: SessionContext,
  _text: string
): Promise<void> {
  // Si artisan déjà onboardé → aller directement à COLLECTING
  if (artisan.nom_entreprise && artisan.email) {
    await updateSession(sessionId, 'COLLECTING', ctx);
    await sendText(from, MSG.demande_travaux());
    return;
  }

  await updateSession(sessionId, 'ONBOARDING', { ...ctx, onboarding_step: 'nom' });
  await sendText(from, MSG.accueil());
}

async function handleOnboarding(
  from: string,
  artisan: Artisan,
  sessionId: string,
  ctx: SessionContext,
  text: string
): Promise<void> {
  const step = ctx.onboarding_step ?? 'nom';
  const normalized = text.trim().toUpperCase();

  if (step === 'nom') {
    const nomRecherche = text.trim();
    ctx.nom_recherche = nomRecherche;

    // Recherche Google Maps
    const entreprise = await searchEntrepriseByName(nomRecherche);
    if (entreprise) {
      ctx.entreprise_suggeree = entreprise;
      ctx.onboarding_step = 'siret_confirm';
      await updateSession(sessionId, 'ONBOARDING', ctx);
      await sendText(from, MSG.entreprise_trouvee(entreprise.nom, entreprise.adresse ?? ''));
    } else {
      ctx.onboarding_step = 'siret_manual';
      await updateSession(sessionId, 'ONBOARDING', ctx);
      await sendText(from, MSG.entreprise_non_trouvee());
    }
    return;
  }

  if (step === 'siret_confirm') {
    if (normalized === 'OUI') {
      // Confirmer l'entreprise suggérée
      const e = ctx.entreprise_suggeree!;
      await updateArtisan(artisan.id, {
        nom_entreprise: e.nom,
        siret: e.siret,
        adresse: e.adresse,
        activite: e.activite,
      });
      ctx.onboarding_step = 'email';
      await updateSession(sessionId, 'ONBOARDING', ctx);
      await sendText(from, MSG.onboarding_email(e.nom));
    } else {
      // Correction manuelle
      ctx.entreprise_suggeree = undefined;
      ctx.onboarding_step = 'siret_manual';
      await updateSession(sessionId, 'ONBOARDING', ctx);
      await sendText(from, `D'accord ! Quel est le nom exact de votre entreprise ?`);
    }
    return;
  }

  if (step === 'siret_manual') {
    const input = text.trim();

    if (normalized === 'PASSER') {
      // Continuer sans SIRET
      const nom = ctx.nom_recherche ?? input;
      await updateArtisan(artisan.id, { nom_entreprise: nom });
      ctx.onboarding_step = 'email';
      await updateSession(sessionId, 'ONBOARDING', ctx);
      await sendText(from, MSG.onboarding_email(nom));
      return;
    }

    // Vérifier si c'est un SIRET (14 chiffres)
    const isSiret = /^\d{14}$/.test(input.replace(/\s/g, ''));
    if (isSiret) {
      const info = await searchEntrepriseBySiret(input);
      const nom = info?.nom ?? ctx.nom_recherche ?? input;
      await updateArtisan(artisan.id, {
        nom_entreprise: nom,
        siret: input.replace(/\s/g, ''),
        adresse: info?.adresse,
        activite: info?.activite,
      });
      ctx.onboarding_step = 'email';
      await updateSession(sessionId, 'ONBOARDING', ctx);
      await sendText(from, MSG.onboarding_email(nom));
    } else {
      // C'est un nom d'entreprise manuel
      await updateArtisan(artisan.id, { nom_entreprise: input });
      ctx.nom_recherche = input;
      ctx.onboarding_step = 'email';
      await updateSession(sessionId, 'ONBOARDING', ctx);
      await sendText(from, MSG.onboarding_email(input));
    }
    return;
  }

  if (step === 'email') {
    const email = text.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
      await sendText(from, `Format email invalide. Veuillez retaper votre adresse email (ex: contact@monentreprise.ch)`);
      return;
    }

    // Créer client Stripe (optionnel — on le fait au moment du paiement si clé absente)
    let stripeCustomerId = artisan.stripe_customer_id;
    if (!stripeCustomerId && process.env.STRIPE_SECRET_KEY) {
      try {
        stripeCustomerId = await createOrGetStripeCustomer(
          email,
          artisan.nom_entreprise ?? 'Artisan',
          from
        );
      } catch (e) {
        console.warn('[onboarding] Stripe customer creation skipped:', e);
      }
    }

    await updateArtisan(artisan.id, { email, stripe_customer_id: stripeCustomerId });
    ctx.onboarding_step = 'done';
    await updateSession(sessionId, 'COLLECTING', ctx);

    await sendText(from, `Parfait ! 🎉 Bienvenue sur DevisVocal !\n\n${MSG.demande_travaux()}`);
    return;
  }
}

async function handleCollecting(
  from: string,
  artisan: Artisan,
  sessionId: string,
  ctx: SessionContext,
  text: string
): Promise<void> {
  // Accumuler la description brute
  ctx.description_brute = ctx.description_brute
    ? `${ctx.description_brute}\n${text}`
    : text;

  ctx.clarification_round = ctx.clarification_round ?? 0;

  await sendText(from, MSG.attente_extraction());
  await updateSession(sessionId, 'EXTRACTING', ctx);

  try {
    const extraction = await extractDevisFromText(
      ctx.description_brute,
      artisan.metier ?? 'autre'
    );

    // Des questions bloquantes existent et on n'a pas dépassé le max
    if (
      extraction.questions_manquantes.length > 0 &&
      (ctx.clarification_round ?? 0) < MAX_CLARIFICATION_ROUNDS
    ) {
      ctx.questions_restantes = extraction.questions_manquantes;
      ctx.question_index = 0;
      ctx.devis_partiel = extraction as unknown as SessionContext['devis_partiel'];
      ctx.clarification_round = (ctx.clarification_round ?? 0) + 1;
      await updateSession(sessionId, 'CLARIFYING', ctx);
      await sendText(from, buildQuestionsMessage(extraction.questions_manquantes));
      return;
    }

    // Génération du récap
    ctx.devis_partiel = extraction as unknown as SessionContext['devis_partiel'];
    await updateSession(sessionId, 'RECAP_SENT', ctx);
    await sendText(from, buildRecapMessage(extraction, artisan.nom_entreprise ?? ''));
  } catch (err) {
    console.error('[dialogue] extraction error', err);
    await updateSession(sessionId, 'COLLECTING', ctx);
    await sendText(from, `Je n'ai pas bien compris. Pouvez-vous décrire les travaux différemment ?`);
  }
}

async function handleClarifying(
  from: string,
  artisan: Artisan,
  sessionId: string,
  ctx: SessionContext,
  text: string
): Promise<void> {
  // Enregistrer la réponse
  const questions = ctx.questions_restantes ?? [];
  const idx = ctx.question_index ?? 0;
  const currentQuestion = questions[idx];

  if (currentQuestion) {
    ctx.reponses_clarification = {
      ...(ctx.reponses_clarification ?? {}),
      [currentQuestion]: text,
    };
    // Ajouter la réponse à la description brute pour ré-extraction
    ctx.description_brute = `${ctx.description_brute ?? ''}\n${currentQuestion}: ${text}`;
  }

  // Re-extraire avec les nouvelles infos
  await sendText(from, MSG.attente_extraction());
  await updateSession(sessionId, 'EXTRACTING', ctx);

  try {
    const extraction = await extractDevisFromText(
      ctx.description_brute ?? text,
      artisan.metier ?? 'autre'
    );

    // Encore des questions et encore un round disponible ?
    if (
      extraction.questions_manquantes.length > 0 &&
      (ctx.clarification_round ?? 0) < MAX_CLARIFICATION_ROUNDS
    ) {
      ctx.questions_restantes = extraction.questions_manquantes;
      ctx.clarification_round = (ctx.clarification_round ?? 0) + 1;
      await updateSession(sessionId, 'CLARIFYING', ctx);
      await sendText(from, buildQuestionsMessage(extraction.questions_manquantes));
      return;
    }

    // On génère avec ce qu'on a
    ctx.devis_partiel = extraction as unknown as SessionContext['devis_partiel'];
    await updateSession(sessionId, 'RECAP_SENT', ctx);
    await sendText(from, buildRecapMessage(extraction, artisan.nom_entreprise ?? ''));
  } catch (err) {
    console.error('[dialogue] clarifying error', err);
    await updateSession(sessionId, 'RECAP_SENT', ctx);
    await sendText(from, `D'accord, je génère le devis avec les informations disponibles.\n\n${MSG.attente_extraction()}`);
  }
}

async function handleRecapResponse(
  from: string,
  artisan: Artisan,
  sessionId: string,
  ctx: SessionContext,
  text: string
): Promise<void> {
  const normalized = text.trim().toUpperCase();

  if (normalized === 'OUI' || normalized === 'YES' || normalized === 'OK') {
    // Créer le devis en base et envoyer le lien Stripe
    await createDevisAndSendLink(from, artisan, sessionId, ctx);
    return;
  }

  if (normalized === 'CORRIGER' || normalized === 'NON' || normalized === 'NO') {
    // Relancer la collecte
    ctx.description_brute = undefined;
    ctx.clarification_round = 0;
    await updateSession(sessionId, 'COLLECTING', ctx);
    await sendText(from, `D'accord ! Redécrivez-moi les travaux avec les corrections.`);
    return;
  }

  // Si l'artisan envoie une correction directe
  ctx.description_brute = text;
  await handleCollecting(from, artisan, sessionId, ctx, text);
}

// ─── Création devis + lien Stripe ─────────────────────────────────────────────

async function createDevisAndSendLink(
  from: string,
  artisan: Artisan,
  sessionId: string,
  ctx: SessionContext
): Promise<void> {
  const extraction = ctx.devis_partiel as unknown as {
    lignes: Array<{ description: string; quantite: number; unite: string; prix_unitaire: number; total_ht: number }>;
    client_nom?: string;
    description_travaux: string;
    notes?: string;
  };

  if (!extraction?.lignes?.length) {
    await sendText(from, MSG.erreur_generique());
    return;
  }

  const { montant_ht, tva, montant_ttc } = computeTotals(extraction.lignes);
  const token = generateDevisToken('pending');

  const devis = await createDevis({
    artisanId: artisan.id,
    token,
    clientNom: extraction.client_nom,
    travauxDescription: extraction.description_travaux,
    lignes: extraction.lignes,
    montantHt: montant_ht,
    tva,
    montantTtc: montant_ttc,
  });

  // Re-générer le token avec le vrai ID
  const finalToken = generateDevisToken(devis.id);
  await import('../services/supabase.js').then(m =>
    m.updateDevisStatut(devis.id, 'en_attente_paiement', { token: finalToken })
  );

  // Créer la session Stripe (optionnel si clé absente — mode test sans paiement)
  let linkUrl: string;
  if (process.env.STRIPE_SECRET_KEY) {
    try {
      const { url: stripeUrl } = await createCheckoutSession({
        devisToken: finalToken,
        devisNumero: devis.numero,
        artisanEmail: artisan.email,
        stripeCustomerId: artisan.stripe_customer_id,
        appUrl: APP_URL,
      });
      ctx.stripe_url = stripeUrl;
      linkUrl = stripeUrl;
    } catch (e) {
      console.warn('[createDevis] Stripe skipped:', e);
      linkUrl = `${APP_URL}/devis/${finalToken}`;
    }
  } else {
    // Mode dev — lien direct sans paiement
    linkUrl = `${APP_URL}/devis/${finalToken}`;
  }

  ctx.devis_id = devis.id;
  ctx.devis_token = finalToken;
  await updateSession(sessionId, 'AWAITING_PAYMENT', ctx);

  await sendText(from, MSG.lien_devis(linkUrl));
}

// ─── Post-paiement : génération PDF + livraison ────────────────────────────────

export async function handlePaymentSuccess(
  stripeSessionId: string,
  paymentIntentId: string
): Promise<void> {
  const { getDevisByStripeSession, getArtisanById, updateDevisStatut, savePaiement } = await import('../services/supabase.js');

  // Retrouver via les métadonnées Stripe → token stocké dans la session checkout
  const { getCheckoutSession } = await import('../services/stripe.js');
  const stripeSession = await getCheckoutSession(stripeSessionId);
  const devisToken = stripeSession.metadata?.devis_token;
  if (!devisToken) throw new Error('devis_token missing from Stripe metadata');

  const { getDevisByToken } = await import('../services/supabase.js');
  const devis = await getDevisByToken(devisToken);
  if (!devis) throw new Error(`Devis non trouvé pour token ${devisToken}`);

  const artisan = await getArtisanById(devis.artisan_id);
  if (!artisan) throw new Error(`Artisan non trouvé ${devis.artisan_id}`);

  // Enregistrer le paiement
  await savePaiement(devis.id, paymentIntentId, devis.montant_ttc);

  // Générer le PDF
  const pdfBuffer = await generateDevisPdf(devis, artisan);

  // Uploader dans Supabase Storage
  const { uploadPdf: upload } = await import('../services/supabase.js');
  const pdfUrl = await upload(devis.id, pdfBuffer);

  // Mettre à jour le statut
  await updateDevisStatut(devis.id, 'payé', {
    pdf_url: pdfUrl,
    paid_at: new Date().toISOString(),
  });

  await incrementDevisCount(artisan.id);

  // Envoyer PDF par WhatsApp
  await sendDocument(
    artisan.whatsapp_number,
    pdfUrl,
    `${devis.numero}.pdf`,
    `Votre devis ${devis.numero} est prêt !`
  );

  // Envoyer PDF par email à l'artisan
  if (artisan.email) {
    await sendDevisEmail({
      devis,
      artisan,
      pdfBuffer,
      recipientEmail: artisan.email,
      isArtisan: true,
    });
  }

  // Envoyer PDF par email au client si renseigné
  if (devis.client_email) {
    await sendDevisEmail({
      devis,
      artisan,
      pdfBuffer,
      recipientEmail: devis.client_email,
      isArtisan: false,
    });
  }

  // Marquer devis envoyé
  await updateDevisStatut(devis.id, 'envoyé', { delivered_at: new Date().toISOString() });

  // Compléter la session WhatsApp
  const session = await getActiveSession(artisan.whatsapp_number);
  if (session) await completeSession(session.id);

  // Dernier message WhatsApp
  await sendText(artisan.whatsapp_number, MSG.devis_envoye(devis.numero));
}

