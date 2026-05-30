import axios from 'axios';

const BASE = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

// ─── Envoi texte ─────────────────────────────────────────────────────────────

export async function sendText(chatId: string, text: string): Promise<void> {
  await axios.post(`${BASE()}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
  });
}

// ─── Envoi document (PDF) ─────────────────────────────────────────────────────

export async function sendDocument(
  chatId: string,
  documentUrl: string,
  filename: string,
  caption?: string
): Promise<void> {
  await axios.post(`${BASE()}/sendDocument`, {
    chat_id: chatId,
    document: documentUrl,
    caption: caption ?? '',
    parse_mode: 'Markdown',
  });
}

// ─── Téléchargement fichier audio depuis Telegram ────────────────────────────

export async function getMediaUrl(fileId: string): Promise<string> {
  const res = await axios.get<{ ok: boolean; result: { file_path: string } }>(
    `${BASE()}/getFile`,
    { params: { file_id: fileId } }
  );
  const filePath = res.data.result.file_path;
  return `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`;
}

export async function downloadMedia(mediaUrl: string): Promise<Buffer> {
  const res = await axios.get<ArrayBuffer>(mediaUrl, { responseType: 'arraybuffer' });
  return Buffer.from(res.data);
}

// ─── Configurer le webhook Telegram ──────────────────────────────────────────

export async function setWebhook(webhookUrl: string): Promise<void> {
  const res = await axios.post<{ ok: boolean; description: string }>(
    `${BASE()}/setWebhook`,
    { url: webhookUrl, allowed_updates: ['message'] }
  );
  console.log('✅ Telegram webhook set:', res.data);
}

// ─── Messages ────────────────────────────────────────────────────────────────

export const MSG = {

  // Question discriminante — premier message
  mode_choice: () =>
    `👷 Bienvenue sur *DevisVocal* !

Je génère vos devis professionnels en quelques minutes.

Comment souhaitez-vous créer votre devis ?

*1️⃣ Mon prix est fixé* → je génère un PDF pro en 1 min
*2️⃣ Aide-moi à chiffrer* → on construit ensemble

Répondez *1* ou *2*`,

  // Tunnel RAPIDE
  rapide_demande_description: () =>
    `Parfait ! 💨 Devis rapide.

Décrivez les travaux en quelques mots :
_(ex: "Pose parquet chêne 40m²", "Rénovation salle de bain complète", "Peinture appartement 3 pièces")_`,

  rapide_demande_montant: (description: string) =>
    `✅ *${description}*

Quel est votre montant total TTC ?
_(ex: 1500, 2800.50)_`,

  rapide_analyse: () => `Je décompose votre devis en étapes professionnelles... 🤖`,

  // Tunnel ASSISTÉ
  assiste_demande_travaux: () =>
    `Parfait ! Décrivez-moi le chantier :

• La nature des travaux
• Les surfaces ou quantités
• Le nom du client _(optionnel)_
• Votre estimation de prix _(optionnel, sinon je suggère le tarif marché)_

En message vocal ou texte 🎤`,

  attente_extraction: () => `J'analyse votre description... 🤖`,
  attente_transcription: () => `Je transcris votre message vocal... ⏳`,

  // Lien devis
  lien_devis: (url: string) =>
    `✅ Votre devis est prêt !

Validez et téléchargez-le ici *(valable 24h)* :
${url}

Le PDF vous sera envoyé ici après paiement *(2.90 CHF)*.`,

  // Post-paiement
  devis_envoye: (numero: string) =>
    `✅ Votre devis *${numero}* a été généré et envoyé !

Bonne continuation 🙌

Tapez n'importe quoi pour créer un nouveau devis.`,

  // Erreurs
  erreur_generique: () =>
    `Désolé, une erreur s'est produite 😕\nTapez *RECOMMENCER* pour réessayer.`,

  lien_actif: (url: string) =>
    `Votre devis est en attente de paiement :\n${url}\n\nSi vous avez déjà payé, patientez quelques secondes.\n\nPour créer un *nouveau devis*, tapez *NOUVEAU*.`,
};
