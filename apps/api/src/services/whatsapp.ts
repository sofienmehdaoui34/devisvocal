import axios from 'axios';

const BASE_URL = 'https://waba.360dialog.io/v1';

const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    'D360-API-KEY': process.env.WHATSAPP_API_KEY,
    'Content-Type': 'application/json',
  },
});

// ─── Envoi texte ─────────────────────────────────────────────────────────────

export async function sendText(to: string, text: string): Promise<void> {
  await api.post('/messages', {
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text },
  });
}

// ─── Envoi document (PDF) ─────────────────────────────────────────────────────

export async function sendDocument(
  to: string,
  documentUrl: string,
  filename: string,
  caption?: string
): Promise<void> {
  await api.post('/messages', {
    recipient_type: 'individual',
    to,
    type: 'document',
    document: {
      link: documentUrl,
      filename,
      caption: caption ?? '',
    },
  });
}

// ─── Téléchargement fichier audio depuis 360dialog ───────────────────────────

export async function getMediaUrl(mediaId: string): Promise<string> {
  const res = await api.get<{ url: string }>(`/media/${mediaId}`);
  return res.data.url;
}

export async function downloadMedia(mediaUrl: string): Promise<Buffer> {
  const res = await axios.get<ArrayBuffer>(mediaUrl, {
    responseType: 'arraybuffer',
    headers: { 'D360-API-KEY': process.env.WHATSAPP_API_KEY },
  });
  return Buffer.from(res.data);
}

// ─── Messages standards ───────────────────────────────────────────────────────

export const MSG = {
  accueil: () =>
    `Bonjour ! 👷 Je suis *DevisVocal*, votre assistant devis.

Je génère vos devis professionnels en quelques minutes, directement depuis WhatsApp.

Pour commencer, quel est le *nom de votre entreprise* ?`,

  attente_transcription: () => `Je transcris votre message vocal... ⏳`,

  attente_extraction: () => `J'analyse votre description... 🤖`,

  onboarding_email: (nomEntreprise: string) =>
    `Parfait, *${nomEntreprise}* !

Quelle est votre *adresse email* pour recevoir vos devis ?`,

  entreprise_trouvee: (nom: string, adresse: string) =>
    `J'ai trouvé : *${nom}*, ${adresse}.

C'est bien vous ? Répondez *OUI* pour confirmer, ou *NON* pour corriger.`,

  entreprise_non_trouvee: () =>
    `Je n'ai pas trouvé votre entreprise.

Pouvez-vous me donner votre *numéro SIRET* (ou continuer sans) ?
Tapez votre SIRET ou *PASSER* pour continuer.`,

  demande_travaux: () =>
    `Parfait ! 🎉

Maintenant, *décrivez-moi le chantier* en message vocal ou texte :
- La nature des travaux
- Le nom du client (si vous l'avez)
- Les surfaces ou quantités
- Votre estimation de prix (ou je suggère un tarif marché)`,

  lien_devis: (url: string) =>
    `Votre devis est prêt ! 🎉

Téléchargez-le ici *(valable 24h)* :
${url}

Le PDF vous sera envoyé ici et par email après paiement (2.90 CHF).`,

  devis_envoye: (numero: string) =>
    `✅ Votre devis *${numero}* a été payé et envoyé !

Il a été envoyé à votre client par email. Bonne continuation ! 🙌

Tapez n'importe quoi pour créer un nouveau devis.`,

  erreur_generique: () =>
    `Désolé, une erreur s'est produite. 😕
Pouvez-vous réessayer ou taper *RECOMMENCER* ?`,
};
