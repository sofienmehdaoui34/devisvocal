import Anthropic from '@anthropic-ai/sdk';
import type { ExtractionResult, LigneDevis, Metier } from '@devisvocal/types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

  const raw = message.content[0].type === 'text' ? message.content[0].text.trim() : '{}';
  const parsed = JSON.parse(raw) as ExtractionResult;

  // Recalcul sécurisé des totaux
  parsed.lignes = parsed.lignes.map((l: LigneDevis) => ({
    ...l,
    total_ht: Math.round(l.quantite * l.prix_unitaire * 100) / 100,
  }));

  return parsed;
}

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
  artisanNom: string
): string {
  const { montant_ht, montant_ttc } = computeTotals(extraction.lignes);
  const lignesText = extraction.lignes
    .map((l) => `  • ${l.description} — ${l.quantite} ${l.unite} × CHF ${l.prix_unitaire} = CHF ${l.total_ht.toFixed(2)}`)
    .join('\n');

  return `Voici le récap de votre devis 📋

👤 Client : ${extraction.client_nom ?? 'Non précisé'}
🔨 Travaux : ${extraction.description_travaux}
${extraction.date_debut_estimee ? `📅 Début estimé : ${extraction.date_debut_estimee}\n` : ''}
📦 Lignes :
${lignesText}

💰 Montant HT : CHF ${montant_ht.toFixed(2)}
💰 Montant TTC (TVA 8.1%) : CHF ${montant_ttc.toFixed(2)}
${extraction.notes ? `\n📝 Notes : ${extraction.notes}` : ''}

✅ Tapez *OUI* pour générer le devis
✏️ Tapez *CORRIGER* pour modifier quelque chose`;
}

export function buildQuestionsMessage(questions: string[]): string {
  const limited = questions.slice(0, 3);
  const list = limited.map((q, i) => `${i + 1}. ${q}`).join('\n');
  return `Presque prêt ! Il me manque juste :\n\n${list}\n\nRépondez à ces questions pour finaliser votre devis.`;
}
