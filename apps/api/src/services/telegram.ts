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

// ─── Messages standards (identiques à la version WhatsApp) ───────────────────

export const MSG = {
  accueil: () =>
    `Bonjour\\! 👷 Je suis *DevisVocal*, votre assistant devis\\.

Je génère vos devis professionnels en quelques minutes\\.

Pour commencer, quel est le *nom de votre entreprise* ?`,

  attente_transcription: () => `Je transcris votre message vocal\\.\\.\\. ⏳`,

  attente_extraction: () => `J'analyse votre description\\.\\.\\. 🤖`,

  onboarding_email: (nomEntreprise: string) =>
    `Parfait, *${escMd(nomEntreprise)}* \\!

Quelle est votre *adresse email* pour recevoir vos devis ?`,

  entreprise_trouvee: (nom: string, adresse: string) =>
    `J'ai trouvé : *${escMd(nom)}*, ${escMd(adresse)}\\.

C'est bien vous ? Répondez *OUI* pour confirmer, ou *NON* pour corriger\\.`,

  entreprise_non_trouvee: () =>
    `Je n'ai pas trouvé votre entreprise\\.

Pouvez\\-vous me donner votre *numéro SIRET* \\(ou taper *PASSER* pour continuer\\) ?`,

  demande_travaux: () =>
    `Parfait \\! 🎉

Décrivez\\-moi le chantier en message vocal ou texte :
• La nature des travaux
• Le nom du client
• Les surfaces ou quantités
• Votre estimation de prix \\(ou je suggère un tarif marché\\)`,

  lien_devis: (url: string) =>
    `Votre devis est prêt \\! 🎉

Téléchargez\\-le ici \\(*valable 24h*\\) :
${url}

Le PDF vous sera envoyé ici et par email après paiement \\(2\\.90 CHF\\)\\.`,

  devis_envoye: (numero: string) =>
    `✅ Votre devis *${escMd(numero)}* a été payé et envoyé \\!

Bonne continuation \\! 🙌

Tapez n'importe quoi pour créer un nouveau devis\\.`,

  erreur_generique: () =>
    `Désolé, une erreur s'est produite\\. 😕
Tapez *RECOMMENCER* pour réessayer\\.`,
};

// Echapper les caractères spéciaux Markdown v2 Telegram
function escMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}
