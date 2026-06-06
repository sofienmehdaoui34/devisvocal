import type { Artisan, WhatsAppInboundMessage, SessionContext } from '@devisvocal/types';
import type { Channel } from '../services/channel.js';
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
  findClientByName,
  upsertClient,
} from '../services/supabase.js';
import { MSG } from '../services/telegram.js';
import { transcribeAudioBuffer } from '../services/whisper.js';
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

// Construit le bon canal (WhatsApp si numéro E.164 avec "+", Telegram sinon)
async function channelFromNumber(number: string): Promise<Channel> {
  if (number.startsWith('+')) {
    const w = await import('../services/whatsapp.js');
    return { sendText: w.sendText, sendDocument: w.sendDocument, getMediaUrl: w.getMediaUrl, downloadMedia: w.downloadMedia };
  }
  const t = await import('../services/telegram.js');
  return { sendText: t.sendText, sendDocument: t.sendDocument, getMediaUrl: t.getMediaUrl, downloadMedia: t.downloadMedia };
}

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

// Devise + TVA selon préfixe du numéro de téléphone
function getDevise(from: string): { devise: string; tva: number } {
  if (from.startsWith('+33') || from.startsWith('0033')) return { devise: 'EUR', tva: 20 };
  if (from.startsWith('+32') || from.startsWith('0032')) return { devise: 'EUR', tva: 21 };
  return { devise: 'CHF', tva: 8.1 }; // Suisse par défaut
}

// Détecte une demande explicite de changement de devise dans le chat.
// Ex: "mets-le en CHF", "plutôt en euros", "en francs suisses", "facture en EUR".
// Renvoie null si aucune intention claire (pour ne pas confondre avec "5000 CHF").
function detectDeviseIntent(text: string): { devise: 'CHF' | 'EUR'; tva: number } | null {
  const t = text.toLowerCase();
  const hasChf = /\b(chf|francs?\s*suisses?|francs?\s*ch)\b/.test(t);
  const hasEur = /(\beuros?\b|\beur\b|€)/.test(t);

  // Signaux d'intention : préposition "en <devise>", verbe de bascule, ou message ne contenant QUE la devise.
  const enDevise   = /\ben\s+(chf|francs?(\s*suisses?)?|euros?|eur|€)\b/.test(t);
  const switchVerb = /\b(met|mets|mettre|passe|passer|change|changer|facture|facturer|convertis|convertir|bascule|basculer|plut[oô]t)\b/.test(t);
  const onlyDevise = /^\s*(en\s+)?(chf|francs?(\s*suisses?)?|euros?|eur|€)\s*[.!]*\s*$/.test(t);

  const intention = enDevise || onlyDevise || (switchVerb && (hasChf || hasEur));
  if (!intention) return null;

  if (hasEur && !hasChf) return { devise: 'EUR', tva: 20 };
  if (hasChf && !hasEur) return { devise: 'CHF', tva: 8.1 };
  return null; // ambigu (les deux mentionnés) → on ne devine pas
}

// Détection du métier depuis la description des travaux
import type { Metier } from '@devisvocal/types';
function inferMetier(description: string): Metier | null {
  const d = description.toLowerCase();
  if (/plomb|chaudière|chauffage|sanitaire|robinet|canalisation|wc|douche/.test(d)) return 'plombier';
  if (/électr|câbl|tableau|prise|disjoncteur|éclairage|interrupteur/.test(d))       return 'electricien';
  if (/carrelage|faïence|dallage|joint|céramique/.test(d))                           return 'carreleur';
  if (/peinture|enduit|crépi|façade|lasure|mur|plafond/.test(d))                     return 'peintre';
  if (/maçon|béton|parpaing|fondation|mur porteur|terrassement/.test(d))             return 'macon';
  if (/menuiserie|parquet|porte|fenêtre|escalier|volet|bois/.test(d))                return 'menuisier';
  if (/cuisine|plan de travail|meuble cuisine|électroménager/.test(d))               return 'cuisiniste';
  if (/jardin|pelouse|haie|plantation|gazon|taille/.test(d))                         return 'paysagiste';
  if (/nettoyage|ménage|vitrage|entretien|désinfection/.test(d))                     return 'nettoyage';
  if (/déménag|transport|livraison|emballage/.test(d))                               return 'demenageur';
  if (/garage|voiture|auto|mécanique|pneu|vidange/.test(d))                          return 'garagiste';
  return null;
}

// ─── Point d'entrée principal ─────────────────────────────────────────────────

export async function handleInboundMessage(msg: WhatsAppInboundMessage, channel: Channel): Promise<void> {
  const { sendText, getMediaUrl } = channel;

  const artisan = await findOrCreateArtisan(msg.from);

  let session = await getActiveSession(msg.from);
  if (!session) {
    session = await createSession(msg.from, artisan.id);
  }

  // Audio → Whisper
  let text = '';
  if (msg.type === 'audio' && msg.audio_url) {
    await sendText(msg.from, MSG.attente_transcription());
    try {
      const mediaUrl = await getMediaUrl(msg.audio_url);
      const buffer   = await channel.downloadMedia(mediaUrl);
      text = await transcribeAudioBuffer(buffer, msg.audio_mime);
    } catch (err) {
      console.error('[audio] transcription error:', err);
      await sendText(msg.from, `Désolé, je n'ai pas pu transcrire votre message vocal 😕\nPouvez-vous écrire votre description en texte ?`);
      return;
    }
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

  // Changement de devise demandé dans le chat (ex. frontalier facturant en CHF).
  // On met à jour le contexte ; il sera propagé aux calculs/recap suivants.
  if (text && state !== 'NEW') {
    const intent = detectDeviseIntent(text);
    if (intent && intent.devise !== ctx.devise) {
      ctx.devise = intent.devise;
      ctx.tva = intent.tva;
      await updateSession(session.id, state, ctx);
      // Si le message ne servait qu'à changer la devise → confirmer et s'arrêter là.
      const onlyChange = text.trim().length <= 30;
      if (onlyChange) {
        await sendText(
          msg.from,
          `✅ C'est noté, je passe le devis en *${intent.devise}* (TVA ${intent.tva}%).\nVous pouvez continuer.`
        );
        return;
      }
      // Sinon (devise mentionnée dans une phrase plus longue) on continue le traitement normal.
    }
  }

  switch (state) {
    case 'NEW':
      await handleNew(msg.from, session.id, channel, artisan);
      break;


    case 'MODE_CHOICE':
      await handleModeChoice(msg.from, session.id, ctx, text, channel);
      break;

    case 'RAPIDE_COLLECTING':
      await handleRapideCollecting(msg.from, artisan, session.id, ctx, text, channel);
      break;

    case 'ASSISTE_COLLECTING':
    case 'COLLECTING': // legacy
      await handleAssisteCollecting(msg.from, artisan, session.id, ctx, text, channel);
      break;

    case 'CLARIFYING':
      await handleClarifying(msg.from, artisan, session.id, ctx, text, channel);
      break;

    case 'RECAP_SENT':
      await handleRecapResponse(msg.from, artisan, session.id, ctx, text, channel);
      break;

    case 'AWAITING_PAYMENT': {
      // N'importe quel message = nouveau devis
      await completeAllUserSessions(msg.from);
      const newSession = await createSession(msg.from, artisan.id);
      await handleNew(msg.from, newSession.id, channel, artisan);
      break;
    }

    case 'COMPLETED':
    case 'ONBOARDING': // legacy
    default: {
      await completeAllUserSessions(msg.from);
      const newSession = await createSession(msg.from, artisan.id);
      await handleNew(msg.from, newSession.id, channel);
      break;
    }
  }
}

// ─── NEW → question discriminante ────────────────────────────────────────────

async function handleNew(from: string, sessionId: string, channel: Channel, artisan?: import('@devisvocal/types').Artisan): Promise<void> {
  const { devise, tva } = getDevise(from);
  await updateSession(sessionId, 'MODE_CHOICE', { devise: devise as 'CHF' | 'EUR', tva });
  const nom = artisan?.nom_entreprise ?? undefined;
  await channel.sendText(from, MSG.mode_choice(nom));
}

// ─── MODE_CHOICE ──────────────────────────────────────────────────────────────

async function handleModeChoice(
  from: string,
  sessionId: string,
  ctx: SessionContext,
  text: string,
  channel: Channel
): Promise<void> {
  const n = normText(text);

  if (n === '1' || n.includes('RAPIDE') || n.includes('PRIX') || n.includes('FIXE')) {
    await updateSession(sessionId, 'RAPIDE_COLLECTING', { ...ctx, mode: 'rapide', rapide_step: 'description' });
    await channel.sendText(from, MSG.rapide_demande_description());
    return;
  }

  if (n === '2' || n.includes('AIDE') || n.includes('CHIFFR') || n.includes('ASSIST')) {
    await updateSession(sessionId, 'ASSISTE_COLLECTING', { ...ctx, mode: 'assiste' });
    await channel.sendText(from, MSG.assiste_demande_travaux());
    return;
  }

  await channel.sendText(from, `Répondez *1* pour le devis rapide ou *2* pour l'aide au chiffrage.`);
}

// ─── Extrait un montant depuis un texte libre ────────────────────────────────
// ex: "Pose carrelage 80m² à 5000 CHF HT" → 5000
function extractMontantFromText(text: string): number | null {
  // Patterns : "1500 chf", "à 2800", "pour 3000€", "5 000 fr", "1'500.50"
  const match = text.match(/(?:à|pour|:\s*)?\b(\d[\d\s'.,]*\d|\d)\s*(?:chf|eur|€|fr\.?|frs?|francs?)?(?:\s*(?:ht|ttc|hors\s*taxe))?\b/i);
  if (!match) return null;
  const cleaned = match[1].replace(/[\s',]/g, '').replace(',', '.');
  const val = parseFloat(cleaned);
  return isNaN(val) || val <= 0 ? null : val;
}

// ─── TUNNEL RAPIDE ────────────────────────────────────────────────────────────

async function handleRapideCollecting(
  from: string,
  artisan: Artisan,
  sessionId: string,
  ctx: SessionContext,
  text: string,
  channel: Channel
): Promise<void> {
  const step = ctx.rapide_step ?? 'description';

  if (step === 'description') {
    const description = text.trim();
    if (description.length < 5) {
      await channel.sendText(from, `Pouvez-vous décrire les travaux en quelques mots ? (ex: "Pose carrelage 20m²")`);
      return;
    }

    // Si le montant est déjà dans la description, on saute l'étape
    const montantDetecte = extractMontantFromText(description);
    if (montantDetecte) {
      ctx.rapide_description = description;
      ctx.rapide_montant_ttc = montantDetecte;
      await updateSession(sessionId, 'RAPIDE_COLLECTING', ctx);
      await channel.sendText(from, MSG.rapide_analyse());
      try {
        const extraction = await splitMontantEnLignes(description, montantDetecte, ctx.devise ?? 'CHF');
        ctx.devis_partiel = extraction as unknown as SessionContext['devis_partiel'];
        await updateSession(sessionId, 'RECAP_SENT', ctx);
        await channel.sendText(from, buildRecapMessage(extraction, { devise: ctx.devise, tvaPct: ctx.tva, montantTtcOriginal: montantDetecte }));
      } catch (err) {
        console.error('[rapide] split error (auto-montant)', err);
        ctx.rapide_step = 'montant';
        await updateSession(sessionId, 'RAPIDE_COLLECTING', ctx);
        await channel.sendText(from, MSG.rapide_demande_montant(description));
      }
      return;
    }

    ctx.rapide_description = description;
    ctx.rapide_step = 'montant';
    await updateSession(sessionId, 'RAPIDE_COLLECTING', ctx);
    await channel.sendText(from, MSG.rapide_demande_montant(description));
    return;
  }

  if (step === 'montant') {
    const cleaned = text.replace(/[^\d.,]/g, '').replace(',', '.');
    const montant = parseFloat(cleaned);

    if (isNaN(montant) || montant <= 0) {
      await channel.sendText(from, `Je n'ai pas compris le montant. Entrez juste le chiffre, ex: *1500* ou *2800.50*`);
      return;
    }

    ctx.rapide_montant_ttc = montant;
    await updateSession(sessionId, 'RAPIDE_COLLECTING', ctx);
    await channel.sendText(from, MSG.rapide_analyse());

    try {
      const extraction = await splitMontantEnLignes(ctx.rapide_description ?? '', montant, ctx.devise ?? 'CHF');
      ctx.devis_partiel = extraction as unknown as SessionContext['devis_partiel'];
      await updateSession(sessionId, 'RECAP_SENT', ctx);
      await channel.sendText(from, buildRecapMessage(extraction, { devise: ctx.devise, tvaPct: ctx.tva, montantTtcOriginal: montant }));
    } catch (err) {
      console.error('[rapide] split error', err);
      await updateSession(sessionId, 'RAPIDE_COLLECTING', { ...ctx, rapide_step: 'description' });
      await channel.sendText(from, `Désolé, je n'ai pas pu analyser ça. Réessayons — décrivez les travaux :`);
    }
  }
}

// ─── TUNNEL ASSISTÉ ───────────────────────────────────────────────────────────

async function handleAssisteCollecting(
  from: string,
  artisan: Artisan,
  sessionId: string,
  ctx: SessionContext,
  text: string,
  channel: Channel
): Promise<void> {
  ctx.description_brute = ctx.description_brute ? `${ctx.description_brute}\n${text}` : text;
  ctx.clarification_round = ctx.clarification_round ?? 0;

  await channel.sendText(from, MSG.attente_extraction());
  // On garde ASSISTE_COLLECTING pendant l'extraction (EXTRACTING peut bloquer la contrainte DB)
  await updateSession(sessionId, 'ASSISTE_COLLECTING', ctx);

  try {
    const extraction = await extractDevisFromText(ctx.description_brute, artisan.metier ?? 'autre');

    if (extraction.questions_manquantes.length > 0 && ctx.clarification_round < MAX_CLARIFICATION_ROUNDS) {
      ctx.questions_restantes = extraction.questions_manquantes;
      ctx.question_index = 0;
      ctx.devis_partiel = extraction as unknown as SessionContext['devis_partiel'];
      ctx.clarification_round += 1;
      await updateSession(sessionId, 'CLARIFYING', ctx);
      await channel.sendText(from, buildQuestionsMessage(extraction.questions_manquantes));
      return;
    }

    ctx.devis_partiel = extraction as unknown as SessionContext['devis_partiel'];
    await updateSession(sessionId, 'RECAP_SENT', ctx);
    await channel.sendText(from, buildRecapMessage(extraction, { devise: ctx.devise, tvaPct: ctx.tva }));
  } catch (err) {
    console.error('[assiste] extraction error', err);
    await updateSession(sessionId, 'ASSISTE_COLLECTING', ctx);
    await channel.sendText(from, `Je n'ai pas bien compris. Pouvez-vous reformuler la description des travaux ?`);
  }
}

async function handleClarifying(
  from: string,
  artisan: Artisan,
  sessionId: string,
  ctx: SessionContext,
  text: string,
  channel: Channel
): Promise<void> {
  const questions = ctx.questions_restantes ?? [];
  const idx = ctx.question_index ?? 0;
  const currentQuestion = questions[idx];

  if (currentQuestion) {
    ctx.reponses_clarification = { ...(ctx.reponses_clarification ?? {}), [currentQuestion]: text };
    ctx.description_brute = `${ctx.description_brute ?? ''}\n${currentQuestion}: ${text}`;
  }

  await channel.sendText(from, MSG.attente_extraction());
  await updateSession(sessionId, 'CLARIFYING', ctx);

  try {
    const extraction = await extractDevisFromText(ctx.description_brute ?? text, artisan.metier ?? 'autre');

    if (extraction.questions_manquantes.length > 0 && (ctx.clarification_round ?? 0) < MAX_CLARIFICATION_ROUNDS) {
      ctx.questions_restantes = extraction.questions_manquantes;
      ctx.clarification_round = (ctx.clarification_round ?? 0) + 1;
      await updateSession(sessionId, 'CLARIFYING', ctx);
      await channel.sendText(from, buildQuestionsMessage(extraction.questions_manquantes));
      return;
    }

    ctx.devis_partiel = extraction as unknown as SessionContext['devis_partiel'];
    await updateSession(sessionId, 'RECAP_SENT', ctx);
    await channel.sendText(from, buildRecapMessage(extraction, { devise: ctx.devise, tvaPct: ctx.tva }));
  } catch (err) {
    console.error('[clarifying] error', err);
    await updateSession(sessionId, 'RECAP_SENT', ctx);
    await channel.sendText(from, `Je génère le devis avec les informations disponibles.\n\n${MSG.attente_extraction()}`);
  }
}

// ─── RECAP_SENT ───────────────────────────────────────────────────────────────

async function handleRecapResponse(
  from: string,
  artisan: Artisan,
  sessionId: string,
  ctx: SessionContext,
  text: string,
  channel: Channel
): Promise<void> {
  const n = normText(text);

  if (n === 'OUI' || n === 'YES' || n === 'OK' || n === "C'EST BON") {
    await createDevisAndSendLink(from, artisan, sessionId, ctx, channel);
    return;
  }

  if (n === 'NON' || n === 'NO' || n === 'CORRIGER' || n === 'NON CORRIGER') {
    const backState = ctx.mode === 'rapide' ? 'RAPIDE_COLLECTING' : 'ASSISTE_COLLECTING';
    const backCtx: SessionContext = ctx.mode === 'rapide'
      ? { ...ctx, rapide_step: 'description', devis_partiel: undefined }
      : { ...ctx, description_brute: undefined, clarification_round: 0, devis_partiel: undefined };
    await updateSession(sessionId, backState, backCtx);
    await channel.sendText(from, ctx.mode === 'rapide'
      ? MSG.rapide_demande_description()
      : `D'accord, redécrivez les travaux avec les corrections :`
    );
    return;
  }

  // Texte libre → correction directe
  if (ctx.mode === 'rapide') {
    await updateSession(sessionId, 'RAPIDE_COLLECTING', { ...ctx, rapide_step: 'description' });
    await handleRapideCollecting(from, artisan, sessionId, { ...ctx, rapide_step: 'description' }, text, channel);
  } else {
    ctx.description_brute = text;
    await handleAssisteCollecting(from, artisan, sessionId, ctx, text, channel);
  }
}

// ─── Création devis + lien ────────────────────────────────────────────────────

async function createDevisAndSendLink(
  from: string,
  artisan: Artisan,
  sessionId: string,
  ctx: SessionContext,
  channel: Channel
): Promise<void> {
  const extraction = ctx.devis_partiel as unknown as {
    lignes: Array<{ description: string; quantite: number; unite: string; prix_unitaire: number; total_ht: number }>;
    client_nom?: string;
    client_adresse?: string;
    description_travaux: string;
    notes?: string;
  };

  if (!extraction?.lignes?.length) {
    await channel.sendText(from, MSG.erreur_generique());
    return;
  }

  // ─── Détection métier (silencieuse, une seule fois) ───────────────────────
  if (!artisan.metier || artisan.metier === 'autre') {
    const metierDetecte = inferMetier(extraction.description_travaux ?? '');
    if (metierDetecte) {
      try { await import('../services/supabase.js').then(m => m.updateArtisan(artisan.id, { metier: metierDetecte })); }
      catch (e) { console.warn('[metier] save error:', e); }
    }
  }

  // ─── Gestion client ────────────────────────────────────────────────────────
  let clientId = ctx.client_id;
  const clientNom = extraction.client_nom ?? ctx.client_nom;
  const clientAdresse = extraction.client_adresse ?? ctx.client_adresse;

  try {
    if (clientNom) {
      // Chercher client existant ou en créer un nouveau
      const existing = clientId ? null : await findClientByName(artisan.id, clientNom);
      const savedClient = await upsertClient(
        artisan.id,
        {
          nom: clientNom,
          adresse: clientAdresse,
          email: ctx.client_email,
          telephone: ctx.client_telephone,
          type_chantier: extraction.description_travaux?.split(' ').slice(0, 5).join(' '),
        },
        existing?.id ?? clientId
      );
      clientId = savedClient.id;
      ctx.client_id = clientId;
    }
  } catch (err) {
    console.warn('[client] upsert error (non-bloquant):', err);
  }

  const { montant_ht, tva, montant_ttc } = computeTotals(extraction.lignes, ctx.tva ?? 8.1);
  const finalToken = generateDevisToken();

  const devis = await createDevis({
    artisanId: artisan.id,
    token: finalToken,
    clientNom,
    clientId,
    travauxDescription: extraction.description_travaux,
    lignes: extraction.lignes,
    montantHt: montant_ht,
    tva,
    montantTtc: montant_ttc,
  });

  await import('../services/supabase.js').then(m =>
    m.updateDevisStatut(devis.id, 'en_attente_paiement', {})
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
  await channel.sendText(from, MSG.lien_devis(linkUrl));
}

// ─── Post-paiement (appelé par le webhook Stripe) ────────────────────────────

export async function handlePaymentSuccess(
  stripeSessionId: string,
  _paymentIntentId: string,
  _channel: Channel
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

  // 1) Enregistre le paiement et marque le devis 'payé' IMMÉDIATEMENT.
  //    Ainsi la page web débloque le devis dès le retour, même si la
  //    génération PDF / l'envoi échoue ensuite (Puppeteer fragile sur Render).
  await savePaiement(devis.id, _paymentIntentId, devis.montant_ttc);
  await updateDevisStatut(devis.id, 'payé', { paid_at: new Date().toISOString() });
  await incrementDevisCount(artisan.id);
  console.log(`[payment] devis ${devis.numero} marqué payé`);

  // 2) Génération PDF + livraison : best-effort, ne doit JAMAIS rejeter
  //    (sinon le webhook Stripe renverra une erreur et rejouera l'event).
  try {
    const channel = await channelFromNumber(artisan.whatsapp_number);
    const pdfBuffer = await generateDevisPdf(devis, artisan);
    const pdfUrl = await uploadPdf(devis.id, pdfBuffer);

    await updateDevisStatut(devis.id, 'envoyé', { pdf_url: pdfUrl, delivered_at: new Date().toISOString() });

    await channel.sendDocument(artisan.whatsapp_number, pdfUrl, `${devis.numero}.pdf`, `Votre devis ${devis.numero} est prêt !`);

    if (artisan.email) {
      await sendDevisEmail({ devis, artisan, pdfBuffer, recipientEmail: artisan.email, isArtisan: true });
    }
    if (devis.client_email) {
      await sendDevisEmail({ devis, artisan, pdfBuffer, recipientEmail: devis.client_email, isArtisan: false });
    }

    const session = await getActiveSession(artisan.whatsapp_number);
    if (session) await completeSession(session.id);

    await channel.sendText(artisan.whatsapp_number, MSG.devis_envoye(devis.numero));
  } catch (err) {
    console.error(`[payment] livraison PDF échouée pour ${devis.numero} (devis déjà payé) :`, err);
  }
}
