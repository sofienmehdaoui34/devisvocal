import Anthropic from '@anthropic-ai/sdk';
import type { ExtractionResult, LigneDevis, Metier } from '@devisvocal/types';
import { withRetry, withTimeout } from '../utils/retry.js';
import { safeJsonParse } from '../utils/json.js';

// maxRetries: 0 → on gère nous-mêmes le backoff via withRetry (évite le cumul).
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 });

const CLAUDE_TIMEOUT_MS = 30_000;

// ─── Helper : strip markdown fences ─────────────────────────────────────────
function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

// Recalcule total_ht = quantite × prix_unitaire (arrondi au centime) pour chaque
// ligne. Source de vérité unique pour les lignes produites par Claude (extraction,
// split, édition) : on ne fait jamais confiance au total_ht renvoyé par le modèle.
export function recomputeLignes(lignes: LigneDevis[]): LigneDevis[] {
  return lignes.map((l) => ({
    ...l,
    total_ht: Math.round(l.quantite * l.prix_unitaire * 100) / 100,
  }));
}

// Formate les prestations connues d'un artisan en indices de prix compacts
// injectés dans le prompt d'extraction (top-N pour ne pas gonfler le contexte).
export function buildPriceHints(
  prestations: Array<{ label: string; unite: string; prix_unitaire: number; devise: string }>,
  limit = 30
): string {
  if (!prestations?.length) return '';
  return prestations
    .slice(0, limit)
    .map((p) => `- ${p.label} : ${p.prix_unitaire} ${p.devise}/${p.unite}`)
    .join('\n');
}

// ─── Tunnel ASSISTÉ : extraction depuis description libre ────────────────────

const EXTRACTION_SYSTEM = `Tu es un assistant spécialisé dans la création de devis pour les artisans.
Tu reçois une description d'un travail et tu extrais les informations pour un devis professionnel.

Règles :
- Estime des prix unitaires réalistes (marché suisse/français selon le contexte)
- Si des "tarifs habituels" sont fournis, réutilise leur prix unitaire quand une prestation correspond (sinon estime au prix marché)
- Si une info est manquante et bloquante, liste-la dans "questions_manquantes" (max 3)
- Regroupe les questions similaires en une seule
- Les unités : h (heures), m² (mètres carrés), m (mètres linéaires), m³, pcs (pièces), forfait, kg
- TVA standard : 8.1% (Suisse) ou 20% (France)
- Sois précis sur les quantités si mentionnées
- Réponds UNIQUEMENT en JSON valide, sans markdown ni backticks`;

export async function extractDevisFromText(
  description: string,
  metier: Metier | string,
  priceHints?: string
): Promise<ExtractionResult> {
  const message = await withRetry(
    () =>
      withTimeout(
        client.messages.create({
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
${priceHints ? `\nTarifs habituels de cet artisan (réutilise ces prix unitaires quand la prestation correspond) :\n${priceHints}\n` : ''}
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
        }),
        CLAUDE_TIMEOUT_MS,
        'Claude extraction'
      ),
    { retries: 2, label: 'claude.extract' }
  );

  const raw = stripFences(message.content[0].type === 'text' ? message.content[0].text.trim() : '{}');
  const parsed = safeJsonParse<ExtractionResult>(raw, 'extraction Claude');

  parsed.lignes = recomputeLignes(parsed.lignes);

  return parsed;
}

// ─── Tunnel RAPIDE : splitter un montant TTC en étapes techniques ────────────

const SPLIT_SYSTEM = `Tu es un expert en devis artisanal. Un artisan te donne la description de ses travaux et un montant TTC global.
Tu dois générer un devis professionnel détaillé en décomposant ce montant en étapes techniques logiques.

Règles ABSOLUES :
- 4 à 6 postes dans l'ordre chronologique du chantier (préparation → réalisation → finitions)
- La somme des total_ht × (1 + tva/100) doit être TRÈS PROCHE du montant TTC fourni
- Prix unitaires cohérents et réalistes
- Si des "tarifs habituels" sont fournis, aligne les postes correspondants sur ces prix
- Réponds UNIQUEMENT en JSON valide, sans markdown ni backticks`;

export async function splitMontantEnLignes(
  description: string,
  montantTTC: number,
  devise = 'CHF',
  priceHints?: string
): Promise<ExtractionResult> {
  const tva = devise === 'CHF' ? 8.1 : 20;
  const montantHT = Math.round((montantTTC / (1 + tva / 100)) * 100) / 100;

  const message = await withRetry(
    () =>
      withTimeout(
        client.messages.create({
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
${priceHints ? `\nTarifs habituels de cet artisan (aligne les postes correspondants) :\n${priceHints}\n` : ''}
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
        }),
        CLAUDE_TIMEOUT_MS,
        'Claude split montant'
      ),
    { retries: 2, label: 'claude.split' }
  );

  const raw = stripFences(message.content[0].type === 'text' ? message.content[0].text.trim() : '{}');
  const parsed = safeJsonParse<ExtractionResult>(raw, 'split Claude');

  // Recalc totals
  parsed.lignes = recomputeLignes(parsed.lignes);

  return parsed;
}

// ─── Édition conversationnelle du récap ──────────────────────────────────────

const EDIT_SYSTEM = `Tu es un assistant qui modifie un devis existant selon une instruction en langage naturel.
Tu reçois la liste des lignes actuelles (JSON) et une instruction de l'artisan.

Ta tâche :
- Applique l'instruction : modifier un prix/une quantité, renommer, AJOUTER ou SUPPRIMER une ligne.
- Les lignes sont numérotées à partir de 1 dans l'ordre fourni ("ligne 2" = 2e ligne).
- Renvoie TOUTES les lignes après modification (pas seulement celles modifiées), dans l'ordre.
- Unités possibles : h, m², m, m³, pcs, forfait, kg.
- Si l'instruction n'est PAS une retouche mais la description d'un NOUVEAU devis
  (chantier différent, repart de zéro), mets "is_new_devis": true et renvoie "lignes": [].

Réponds UNIQUEMENT en JSON valide, sans markdown ni backticks, au format :
{"is_new_devis": false, "lignes": [{"description":"...","quantite":0,"unite":"...","prix_unitaire":0,"total_ht":0}]}`;

/**
 * Applique une retouche en langage naturel aux lignes d'un devis en cours de récap.
 * Renvoie l'extraction mise à jour (mêmes métadonnées, lignes recalculées) et un
 * drapeau `is_new_devis` indiquant que l'instruction décrit en réalité un nouveau
 * devis (auquel cas l'appelant retombe sur le flux de redémarrage).
 */
export async function applyRecapEdit(
  extraction: ExtractionResult,
  instruction: string
): Promise<{ extraction: ExtractionResult; is_new_devis: boolean }> {
  const lignesActuelles = extraction.lignes
    .map((l, i) => `${i + 1}. ${l.description} — ${l.quantite} ${l.unite} × ${l.prix_unitaire}`)
    .join('\n');

  const message = await withRetry(
    () =>
      withTimeout(
        client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 2000,
          system: EDIT_SYSTEM,
          messages: [
            {
              role: 'user',
              content: `Lignes actuelles :
${lignesActuelles}

Instruction de l'artisan :
"""
${instruction}
"""`,
            },
          ],
        }),
        CLAUDE_TIMEOUT_MS,
        'Claude édition récap'
      ),
    { retries: 2, label: 'claude.edit' }
  );

  const raw = stripFences(message.content[0].type === 'text' ? message.content[0].text.trim() : '{}');
  const parsed = safeJsonParse<{ is_new_devis?: boolean; lignes?: LigneDevis[] }>(raw, 'édition Claude');

  if (parsed.is_new_devis) {
    return { extraction, is_new_devis: true };
  }

  return {
    extraction: { ...extraction, lignes: recomputeLignes(parsed.lignes ?? []) },
    is_new_devis: false,
  };
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

// ─── Détecteur d'oublis (Jalon A1) ───────────────────────────────────────────
// Métiers pour lesquels un poste « fournitures / matériel » est généralement attendu.
const METIERS_AVEC_MATERIEL = new Set([
  'plombier', 'electricien', 'carreleur', 'peintre', 'macon', 'menuisier', 'cuisiniste', 'paysagiste',
]);

/**
 * Repère, de façon déterministe (sans appel Claude), les postes souvent oubliés
 * dans un devis : le déplacement, et — selon le métier — les fournitures/matériel.
 * Renvoie des libellés courts à suggérer ; vide si rien d'évident ne manque.
 * Non-bloquant : l'artisan ajoute via l'édition (J1) ou valide tel quel.
 */
export function detectOmissions(lignes: LigneDevis[], metier?: string): string[] {
  const text = (lignes ?? []).map((l) => (l.description ?? '').toLowerCase()).join(' | ');
  const out: string[] = [];

  const hasDeplacement = /d[ée]placement|frais de route|trajet|d[ée]placements/.test(text);
  if (!hasDeplacement) out.push('🚗 le déplacement');

  const hasFournitures = /fourniture|mat[ée]riel|mat[ée]riau|pi[èe]ce|consommable|achat/.test(text);
  if (metier && METIERS_AVEC_MATERIEL.has(metier) && !hasFournitures) {
    out.push('🧰 les fournitures / le matériel');
  }

  return out;
}

export function buildRecapMessage(
  extraction: ExtractionResult,
  opts: { devise?: 'CHF' | 'EUR'; tvaPct?: number; montantTtcOriginal?: number; omissions?: string[] } = {}
): string {
  const devise = opts.devise ?? 'CHF';
  const tvaPct = opts.tvaPct ?? 8.1;
  const { montant_ht, tva, montant_ttc } = computeTotals(extraction.lignes, tvaPct);
  // Format compact : pas de devise ni "HT" par ligne (affichés dans le total),
  // pour tenir en un seul message WhatsApp et économiser le quota Twilio.
  const lignesText = extraction.lignes
    .map((l) => `• ${l.description} : ${l.quantite} ${l.unite} × ${l.prix_unitaire.toFixed(0)} = ${l.total_ht.toFixed(0)}`)
    .join('\n');

  const ttcDisplay = opts.montantTtcOriginal ?? montant_ttc;

  const omissions = opts.omissions ?? [];
  const omissionsLine = omissions.length
    ? `\n⚠️ Rien oublié ? Pensez à : ${omissions.join(' · ')} — dites par ex. « ajoute le déplacement à 80 ».\n`
    : '';

  return `📋 *Récap devis* — ${extraction.description_travaux}
${extraction.client_nom ? `👤 ${extraction.client_nom}\n` : ''}${lignesText}
💰 HT *${montant_ht.toFixed(0)}* · TVA ${tva}% *${(montant_ttc - montant_ht).toFixed(0)}* · TTC *${ttcDisplay.toFixed(2)} ${devise}*${extraction.notes ? `\n📝 ${extraction.notes}` : ''}
${omissionsLine}
✅ *OUI* = générer · ✏️ dites quoi changer (ex: « ligne 2 à 300 », « enlève le déplacement ») · *NON* = tout refaire`;
}

export function buildQuestionsMessage(questions: string[]): string {
  const limited = questions.slice(0, 3);
  const list = limited.map((q, i) => `${i + 1}. ${q}`).join('\n');
  return `Presque prêt ! Il me manque juste quelques infos :\n\n${list}`;
}
