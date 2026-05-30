import Anthropic from '@anthropic-ai/sdk';
import type { ExtractionResult, LigneDevis, Metier } from '@devisvocal/types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Helper : strip markdown fences ─────────────────────────────────────────
function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

// ─── Tunnel ASSISTÉ : extraction depuis description libre ────────────────────

const EXTRACTION_SYSTEM = `Tu es un assistant spécialisé dans la création de devis pour les artisans.
Tu reçois une description d'un travail et tu extrais les informations pour un devis professionnel.

Règles :
- Estime des prix unitaires réalistes (marché suisse/français selon le contexte)
- Si une info est manquante et bloquante, liste-la dans "questions_manquantes" (max 3)
- Regroupe les questions similaires en une seule
- Les unités : h (heures), m² (mètres carrés), m (mètres linéaires), m³, pcs (pièces), forfait, kg
- TVA standard : 8.1% (Suisse) ou 20% (France)
- Sois précis sur les quantités si mentionnées
- Réponds UNIQUEMENT en JSON valide, sans markdown ni backticks`;

export async function extractDevisFromText(
  description: string,
  metier: Metier | string
): Promise<ExtractionResult> {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system: EXTRACTION_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Métier : ${metier}

Description :
"""
${description}
"""

JSON à retourner (exactement ce format) :
{
  "lignes": [{"description":"...","quantite":0,"unite":"...","prix_unitaire":0,"total_ht":0}],
  "client_nom": null,
  "client_adresse": null,
  "description_travaux": "résumé 1-2 phrases",
  "date_debut_estimee": null,
  "delai_execution": null,
  "notes": null,
  "questions_manquantes": [],
  "confiance": "haute"
}`,
      },
    ],
  });

  const raw = stripFences(message.content[0].type === 'text' ? message.content[0].text.trim() : '{}');
  const parsed = JSON.parse(raw) as ExtractionResult;

  parsed.lignes = parsed.lignes.map((l: LigneDevis) => ({
    ...l,
    total_ht: Math.round(l.quantite * l.prix_unitaire * 100) / 100,
  }));

  return parsed;
}

// ─── Tunnel RAPIDE : splitter un montant TTC en étapes techniques ────────────

const SPLIT_SYSTEM = `Tu es un expert en devis artisanal. Un artisan te donne la description de ses travaux et un montant TTC global.
Tu dois générer un devis professionnel détaillé en décomposant ce montant en étapes techniques logiques.

Règles ABSOLUES :
- 4 à 6 postes dans l'ordre chronologique du chantier (préparation → réalisation → finitions)
- La somme des total_ht × (1 + tva/100) doit être TRÈS PROCHE du montant TTC fourni
- Prix unitaires cohérents et réalistes
- Réponds UNIQUEMENT en JSON valide, sans markdown ni backticks`;

export async function splitMontantEnLignes(
  description: string,
  montantTTC: number,
  devise = 'CHF'
): Promise<ExtractionResult> {
  const tva = devise === 'CHF' ? 8.1 : 20;
  const montantHT = Math.round((montantTTC / (1 + tva / 100)) * 100) / 100;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system: SPLIT_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Travaux : "${description}"
Montant TTC : ${montantTTC} ${devise}
TVA : ${tva}%
Montant HT cible : ${montantHT} ${devise}

JSON à retourner :
{
  "lignes": [{"description":"...","quantite":1,"unite":"forfait","prix_unitaire":0,"total_ht":0}],
  "client_nom": null,
  "client_adresse": null,
  "description_travaux": "résumé 1 phrase",
  "date_debut_estimee": null,
  "delai_execution": null,
  "notes": null,
  "questions_manquantes": [],
  "confiance": "haute"
}`,
      },
    ],
  });

  const raw = stripFences(message.content[0].type === 'text' ? message.content[0].text.trim() : '{}');
  const parsed = JSON.parse(raw) as ExtractionResult;

  // Recalc totals
  parsed.lignes = parsed.lignes.map((l: LigneDevis) => ({
    ...l,
    total_ht: Math.round(l.quantite * l.prix_unitaire * 100) / 100,
  }));

  return parsed;
}

// ─── Utilitaires partagés ────────────────────────────────────────────────────

export function computeTotals(
  lignes: LigneDevis[],
  tvaPct = 8.1
): { montant_ht: number; tva: number; montant_ttc: number } {
  const montant_ht = Math.round(lignes.reduce((s, l) => s + l.total_ht, 0) * 100) / 100;
  const tvaMontant = Math.round(montant_ht * tvaPct) / 100;
  const montant_ttc = Math.round((montant_ht + tvaMontant) * 100) / 100;
  return { montant_ht, tva: tvaPct, montant_ttc };
}

export function buildRecapMessage(
  extraction: ExtractionResult,
  montantTtcOriginal?: number
): string {
  const { montant_ht, tva, montant_ttc } = computeTotals(extraction.lignes);
  const lignesText = extraction.lignes
    .map((l) => `• ${l.description} — ${l.quantite} ${l.unite} × ${l.prix_unitaire.toFixed(0)} = ${l.total_ht.toFixed(0)} CHF HT`)
    .join('\n');

  const ttcDisplay = montantTtcOriginal ?? montant_ttc;

  return `📋 *Récap de votre devis*

🔨 ${extraction.description_travaux}
${extraction.client_nom ? `👤 Client : ${extraction.client_nom}\n` : ''}
*Détail des postes :*
${lignesText}

💰 Total HT : *${montant_ht.toFixed(2)} CHF*
💰 TVA ${tva}% : *${(montant_ttc - montant_ht).toFixed(2)} CHF*
💰 Total TTC : *${ttcDisplay.toFixed(2)} CHF*
${extraction.notes ? `\n📝 ${extraction.notes}` : ''}

✅ Tapez *OUI* pour générer le devis et obtenir le lien
✏️ Tapez *NON* pour recommencer`;
}

export function buildQuestionsMessage(questions: string[]): string {
  const limited = questions.slice(0, 3);
  const list = limited.map((q, i) => `${i + 1}. ${q}`).join('\n');
  return `Presque prêt ! Il me manque juste quelques infos :\n\n${list}`;
}
