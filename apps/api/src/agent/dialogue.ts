import type { Artisan, WhatsAppInboundMessage, SessionContext } from '@devisvocal/types';
import {
  findOrCreateArtisan,
  getActiveSession,
  createSession,
  updateSession,
  completeSession,
  completeAllUserSessions,
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
  splitMontantEnLignes,
  computeTotals,
  buildRecapMessage,
  buildQuestionsMessage,
} from '../services/claude.js';
import { createCheckoutSession } from '../services/stripe.js';
import { sendDevisEmail } from '../services/email.js';
import { generateDevisToken } from '../utils/token.js';
import { generateDevisPdf } from '@devisvocal/pdf';

const APP_URL = process.env.APP_URL ?? 'https://app.devisvocal.ch';
const MAX_CLARIFICATION_ROUNDS = 2;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseCtx(raw: unknown): SessionContext {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as SessionContext; } catch { return {}; }
  }
  return raw as SessionContext;
}

function normText(text: string): string {
  return text.trim().toUpperCase();
}

// ─── Point d'entrée principal ─────────────────────────────────────────────────

export async function handleInboundMessage(msg: WhatsAppInboundMessage): Promise<void> {
  const artisan = await findOrCreateArtisan(msg.from);

  let session = await getActiveSession(msg.from);
  if (!session) {
    session = await createSession(msg.from, artisan.id);
  }

  // Audio → Whisper
  let text = '';
  if (msg.type === 'audio' && msg.audio_url) {
    await sendText(msg.from, MSG.attente_transcription());
    const mediaUrl = await getMediaUrl(msg.audio_url);
    text = await transcribeAudioFromUrl(mediaUrl, msg.audio_mime);
  } else {
    text = msg.text ?? '';
  }

  const ctx = parseCtx(session.context);
  const state = session.state;

  // Commande universelle RECOMMENCER
  if (normText(text) === 'RECOMMENCER') {
    await completeAllUserSessions(msg.from);
    const newSession = await createSession(msg.from, artisan.id);
    await updateSession(newSession.id, 'MODE_CHOICE', {});
    await sendText(msg.from, MSG.mode_choice());
    return;
  }

  switch (state) {
    case 'NEW':
      await handleNew(msg.from, session.id);
      break;

    case 'MODE_CHOICE':
      await handleModeChoice(msg.from, session.id, ctx, text);
      break;

    case 'RAPIDE_COLLECTING':
      await handleRapideCollecting(msg.from, artisan, session.id, ctx, text);
      break;

    case 'ASSISTE_COLLECTING':
    case 'COLLECTING': // legacy
      await handleAssisteCollecting(msg.from, artisan, session.id, ctx, text);
      break;

    case 'CLARIFYING':
      await handleClarifying(msg.from, artisan, session.id, ctx, text);
      break;

    case 'RECAP_SENT':
      await handleRecapResponse(msg.from, artisan, session.id, ctx, text);
      break;

    case 'AWAITING_PAYMENT': {
      const n2 = normText(text);
      // L'artisan veut un nouveau devis
      if (n2.includes('NOUVEAU') || n2.includes('AUTRE') || n2.includes('NOUVEAU DEVIS') || n2 === 'NON') {
        await completeAllUserSessions(msg.from);
        const newSession = await createSession(msg.from, artisan.id);
        await handleNew(msg.from, newSession.id);
        return;
      }
      // Lien valide → rappeler
      const linkUrl = ctx.stripe_url ?? (ctx.devis_token ? `${APP_URL}/devis/${ctx.devis_token}` : null);
      if (linkUrl) {
        await sendText(msg.from, MSG.lien_actif(linkUrl));
      } else {
        // Token perdu → repartir de zéro
        await completeAllUserSessions(msg.from);
        const newSession = await createSession(msg.from, artisan.id);
        await handleNew(msg.from, newSession.id);
      }
      break;
    }

    case 'COMPLETED':
    case 'ONBOARDING': // legacy
    default: {
      await completeAllUserSessions(msg.from);
      const newSession = await createSession(msg.from, artisan.id);
      await handleNew(msg.from, newSession.id);
      break;
    }
  }
}

// ─── NEW → question discriminante ────────────────────────────────────────────

async function handleNew(from: string, sessionId: string): Promise<void> {
  await updateSession(sessionId, 'MODE_CHOICE', {});
  await sendText(from, MSG.mode_choice());
}

// ─── MODE_CHOICE ──────────────────────────────────────────────────────────────

async function handleModeChoice(
  from: string,
  sessionId: string,
  ctx: SessionContext,
  text: string
): Promise<void> {
  const n = normText(text);

  if (n === '1' || n.includes('RAPIDE') || n.includes('PRIX') || n.includes('FIXE')) {
    await updateSession(sessionId, 'RAPIDE_COLLECTING', { ...ctx, mode: 'rapide', rapide_step: 'description' });
    await sendText(from, MSG.rapide_demande_description());
    return;
  }

  if (n === '2' || n.includes('AIDE') || n.includes('CHIFFR') || n.includes('ASSIST')) {
    await updateSession(sessionId, 'ASSISTE_COLLECTING', { ...ctx, mode: 'assiste' });
    await sendText(from, MSG.assiste_demande_travaux());
    return;
  }

  // Réponse non reconnue → rappeler les options
  await sendText(from, `Répondez *1* pour le devis rapide ou *2* pour l'aide au chiffrage.`);
}

// ─── TUNNEL RAPIDE ────────────────────────────────────────────────────────────

async function handleRapideCollecting(
  from: string,
  artisan: Artisan,
  sessionId: string,
  ctx: SessionContext,
  text: string
): Promise<void> {
  const step = ctx.rapide_step ?? 'description';

  // Étape 1 : collecter la description
  if (step === 'description') {
    const description = text.trim();
    if (description.length < 5) {
      await sendText(from, `Pouvez-vous décrire les travaux en quelques mots ? (ex: "Pose carrelage 20m²")`);
      return;
    }
    ctx.rapide_description = description;
    ctx.rapide_step = 'montant';
    await updateSession(sessionId, 'RAPIDE_COLLECTING', ctx);
    await sendText(from, MSG.rapide_demande_montant(description));
    return;
  }

  // Étape 2 : collecter le montant
  if (step === 'montant') {
    const cleaned = text.replace(/[^\d.,]/g, '').replace(',', '.');
    const montant = parseFloat(cleaned);

    if (isNaN(montant) || montant <= 0) {
      await sendText(from, `Je n'ai pas compris le montant. Entrez juste le chiffre, ex: *1500* ou *2800.50*`);
      return;
    }

    ctx.rapide_montant_ttc = montant;
    await updateSession(sessionId, 'RAPIDE_COLLECTING', ctx);
    await sendText(from, MSG.rapide_analyse());

    try {
      const extraction = await splitMontantEnLignes(
        ctx.rapide_description ?? '',
        montant,
        'CHF'
      );
      ctx.devis_partiel = extraction as unknown as SessionContext['devis_partiel'];
      await updateSession(sessionId, 'RECAP_SENT', ctx);
      await sendText(from, buildRecapMessage(extraction, montant));
    } catch (err) {
      console.error('[rapide] split error', err);
      await updateSession(sessionId, 'RAPIDE_COLLECTING', { ...ctx, rapide_step: 'description' });
      await sendText(from, `Désolé, je n'ai pas pu analyser ça. Réessayons — décrivez les travaux :`);
    }
    return;
  }
}

// ─── TUNNEL ASSISTÉ ───────────────────────────────────────────────────────────

async function handleAssisteCollecting(
  from: string,
  artisan: Artisan,
  sessionId: string,
  ctx: SessionContext,
  text: string
): Promise<void> {
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

    if (
      extraction.questions_manquantes.length > 0 &&
      ctx.clarification_round < MAX_CLARIFICATION_ROUNDS
    ) {
      ctx.questions_restantes = extraction.questions_manquantes;
      ctx.question_index = 0;
      ctx.devis_partiel = extraction as unknown as SessionContext['devis_partiel'];
      ctx.clarification_round += 1;
      await updateSession(sessionId, 'CLARIFYING', ctx);
      await sendText(from, buildQuestionsMessage(extraction.questions_manquantes));
      return;
    }

    ctx.devis_partiel = extraction as unknown as SessionContext['devis_partiel'];
    await updateSession(sessionId, 'RECAP_SENT', ctx);
    await sendText(from, buildRecapMessage(extraction));
  } catch (err) {
    console.error('[assiste] extraction error', err);
    await updateSession(sessionId, 'ASSISTE_COLLECTING', ctx);
    await sendText(from, `Je n'ai pas bien compris. Pouvez-vous reformuler la description des travaux ?`);
  }
}

async function handleClarifying(
  from: string,
  artisan: Artisan,
  sessionId: string,
  ctx: SessionContext,
  text: string
): Promise<void> {
  const questions = ctx.questions_restantes ?? [];
  const idx = ctx.question_index ?? 0;
  const currentQuestion = questions[idx];

  if (currentQuestion) {
    ctx.reponses_clarification = {
      ...(ctx.reponses_clarification ?? {}),
      [currentQuestion]: text,
    };
    ctx.description_brute = `${ctx.description_brute ?? ''}\n${currentQuestion}: ${text}`;
  }

  await sendText(from, MSG.attente_extraction());
  await updateSession(sessionId, 'EXTRACTING', ctx);

  try {
    const extraction = await extractDevisFromText(
      ctx.description_brute ?? text,
      artisan.metier ?? 'autre'
    );

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

    ctx.devis_partiel = extraction as unknown as SessionContext['devis_partiel'];
    await updateSession(sessionId, 'RECAP_SENT', ctx);
    await sendText(from, buildRecapMessage(extraction));
  } catch (err) {
    console.error('[clarifying] error', err);
    ctx.devis_partiel = ctx.devis_partiel; // keep existing
    await updateSession(sessionId, 'RECAP_SENT', ctx);
    await sendText(from, `Je génère le devis avec les informations disponibles.\n\n${MSG.attente_extraction()}`);
  }
}

// ─── RECAP_SENT ───────────────────────────────────────────────────────────────

async function handleRecapResponse(
  from: string,
  artisan: Artisan,
  sessionId: string,
  ctx: SessionContext,
  text: string
): Promise<void> {
  const n = normText(text);

  if (n === 'OUI' || n === 'YES' || n === 'OK' || n === 'C\'EST BON') {
    await createDevisAndSendLink(from, artisan, sessionId, ctx);
    return;
  }

  if (n === 'NON' || n === 'NO' || n === 'CORRIGER' || n === 'NON CORRIGER') {
    // Retour au bon tunnel
    const backState = ctx.mode === 'rapide' ? 'RAPIDE_COLLECTING' : 'ASSISTE_COLLECTING';
    const backCtx: SessionContext = ctx.mode === 'rapide'
      ? { ...ctx, rapide_step: 'description', devis_partiel: undefined }
      : { ...ctx, description_brute: undefined, clarification_round: 0, devis_partiel: undefined };
    await updateSession(sessionId, backState, backCtx);
    await sendText(from, ctx.mode === 'rapide'
      ? MSG.rapide_demande_description()
      : `D'accord, redécrivez les travaux avec les corrections :`
    );
    return;
  }

  // Texte libre → traiter comme correction directe
  if (ctx.mode === 'rapide') {
    await updateSession(sessionId, 'RAPIDE_COLLECTING', { ...ctx, rapide_step: 'description' });
    await handleRapideCollecting(from, artisan, sessionId, { ...ctx, rapide_step: 'description' }, text);
  } else {
    ctx.description_brute = text;
    await handleAssisteCollecting(from, artisan, sessionId, ctx, text);
  }
}

// ─── Création devis + lien ────────────────────────────────────────────────────

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

  const finalToken = generateDevisToken(devis.id);
  await import('../services/supabase.js').then(m =>
    m.updateDevisStatut(devis.id, 'en_attente_paiement', { token: finalToken })
  );

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
    linkUrl = `${APP_URL}/devis/${finalToken}`;
  }

  ctx.devis_id = devis.id;
  ctx.devis_token = finalToken;
  await updateSession(sessionId, 'AWAITING_PAYMENT', ctx);
  await sendText(from, MSG.lien_devis(linkUrl));
}

// ─── Post-paiement ────────────────────────────────────────────────────────────

export async function handlePaymentSuccess(
  stripeSessionId: string,
  _paymentIntentId: string
): Promise<void> {
  const { getArtisanById, updateDevisStatut, savePaiement, getDevisByToken } = await import('../services/supabase.js');
  const { getCheckoutSession } = await import('../services/stripe.js');

  const stripeSession = await getCheckoutSession(stripeSessionId);
  const devisToken = stripeSession.metadata?.devis_token;
  if (!devisToken) throw new Error('devis_token missing from Stripe metadata');

  const devis = await getDevisByToken(devisToken);
  if (!devis) throw new Error(`Devis non trouvé pour token ${devisToken}`);

  const artisan = await getArtisanById(devis.artisan_id);
  if (!artisan) throw new Error(`Artisan non trouvé ${devis.artisan_id}`);

  await savePaiement(devis.id, _paymentIntentId, devis.montant_ttc);

  const pdfBuffer = await generateDevisPdf(devis, artisan);
  const pdfUrl = await uploadPdf(devis.id, pdfBuffer);

  await updateDevisStatut(devis.id, 'payé', {
    pdf_url: pdfUrl,
    paid_at: new Date().toISOString(),
  });

  await incrementDevisCount(artisan.id);

  await sendDocument(artisan.whatsapp_number, pdfUrl, `${devis.numero}.pdf`, `Votre devis ${devis.numero} est prêt !`);

  if (artisan.email) {
    await sendDevisEmail({ devis, artisan, pdfBuffer, recipientEmail: artisan.email, isArtisan: true });
  }
  if (devis.client_email) {
    await sendDevisEmail({ devis, artisan, pdfBuffer, recipientEmail: devis.client_email, isArtisan: false });
  }

  await updateDevisStatut(devis.id, 'envoyé', { delivered_at: new Date().toISOString() });

  const session = await getActiveSession(artisan.whatsapp_number);
  if (session) await completeSession(session.id);

  await sendText(artisan.whatsapp_number, MSG.devis_envoye(devis.numero));
}
