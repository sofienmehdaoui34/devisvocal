import { describe, it, expect, vi } from 'vitest';
import type { ExtractionResult, LigneDevis } from '@devisvocal/types';

// Mock du SDK Anthropic : on contrôle la réponse de messages.create sans réseau.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock };
  },
}));

import { computeTotals, buildRecapMessage, recomputeLignes, applyRecapEdit, buildPriceHints, detectOmissions } from './claude.js';

const ligne = (prix: number): LigneDevis => ({
  description: 'Poste',
  quantite: 1,
  unite: 'forfait',
  prix_unitaire: prix,
  total_ht: prix,
});

describe('computeTotals', () => {
  it('calcule HT, TVA et TTC (TVA suisse 8.1%)', () => {
    const r = computeTotals([ligne(100), ligne(50)], 8.1);
    expect(r.montant_ht).toBe(150);
    expect(r.tva).toBe(8.1);
    expect(r.montant_ttc).toBeCloseTo(162.15, 2);
  });

  it('gère une liste vide', () => {
    const r = computeTotals([], 20);
    expect(r.montant_ht).toBe(0);
    expect(r.montant_ttc).toBe(0);
  });
});

describe('recomputeLignes', () => {
  it('recalcule total_ht = quantite × prix_unitaire (ignore la valeur fournie)', () => {
    const out = recomputeLignes([
      { description: 'Main d’œuvre', quantite: 3, unite: 'h', prix_unitaire: 95, total_ht: 0 },
    ]);
    expect(out[0].total_ht).toBe(285);
  });
});

describe('buildRecapMessage', () => {
  const extraction: ExtractionResult = {
    lignes: Array.from({ length: 6 }, (_, i) => ({ ...ligne(120), description: `Poste numéro ${i + 1}` })),
    description_travaux: 'Rénovation salle de bain complète',
    client_nom: 'M. Martin',
    questions_manquantes: [],
    confiance: 'haute',
  };

  it('tient dans la limite WhatsApp (≤ 1500 caractères)', () => {
    const msg = buildRecapMessage(extraction, { devise: 'CHF', tvaPct: 8.1 });
    expect(msg.length).toBeLessThanOrEqual(1500);
  });

  it('inclut le récap et les options OUI/NON', () => {
    const msg = buildRecapMessage(extraction, { devise: 'CHF', tvaPct: 8.1 });
    expect(msg).toContain('Récap devis');
    expect(msg).toContain('OUI');
    expect(msg).toContain('NON');
  });

  it('invite à éditer une ligne en langage naturel', () => {
    const msg = buildRecapMessage(extraction, { devise: 'CHF', tvaPct: 8.1 });
    expect(msg).toContain('changer');
  });

  it('affiche les oublis suggérés quand ils sont fournis', () => {
    const msg = buildRecapMessage(extraction, { devise: 'CHF', tvaPct: 8.1, omissions: ['🚗 le déplacement'] });
    expect(msg).toContain('Rien oublié');
    expect(msg).toContain('le déplacement');
  });

  it('n’ajoute pas de ligne d’oublis quand il n’y en a pas', () => {
    const msg = buildRecapMessage(extraction, { devise: 'CHF', tvaPct: 8.1 });
    expect(msg).not.toContain('Rien oublié');
  });
});

describe('detectOmissions', () => {
  const l = (description: string): LigneDevis => ({
    description,
    quantite: 1,
    unite: 'forfait',
    prix_unitaire: 100,
    total_ht: 100,
  });

  it('suggère le déplacement quand aucune ligne ne le mentionne', () => {
    expect(detectOmissions([l('Pose carrelage')], 'carreleur')).toContain('🚗 le déplacement');
  });

  it('ne suggère pas le déplacement s’il est déjà présent', () => {
    const out = detectOmissions([l('Pose carrelage'), l('Frais de déplacement')], 'carreleur');
    expect(out.some((o) => o.includes('déplacement'))).toBe(false);
  });

  it('suggère les fournitures pour un métier à matériel sans poste matériel', () => {
    expect(detectOmissions([l('Main d’œuvre')], 'plombier')).toContain('🧰 les fournitures / le matériel');
  });

  it('ne suggère pas les fournitures pour un métier sans matériel attendu', () => {
    const out = detectOmissions([l('Prestation')], 'nettoyage');
    expect(out.some((o) => o.includes('fournitures'))).toBe(false);
  });

  it('ne suggère pas les fournitures si un poste matériel existe', () => {
    const out = detectOmissions([l('Fourniture et pose robinet'), l('Déplacement')], 'plombier');
    expect(out).toHaveLength(0);
  });
});

describe('buildPriceHints', () => {
  const presta = (label: string, prix: number, unite = 'forfait', devise = 'CHF') => ({
    label,
    unite,
    prix_unitaire: prix,
    devise,
  });

  it('formate une liste compacte « label : prix devise/unité »', () => {
    const out = buildPriceHints([presta('déplacement', 80), presta('main d’œuvre', 95, 'h')]);
    expect(out).toContain('- déplacement : 80 CHF/forfait');
    expect(out).toContain('- main d’œuvre : 95 CHF/h');
  });

  it('renvoie une chaîne vide si aucune prestation', () => {
    expect(buildPriceHints([])).toBe('');
  });

  it('tronque au top-N', () => {
    const many = Array.from({ length: 40 }, (_, i) => presta(`poste ${i}`, i + 1));
    const out = buildPriceHints(many, 30);
    expect(out.split('\n')).toHaveLength(30);
  });
});

describe('applyRecapEdit', () => {
  const base: ExtractionResult = {
    lignes: [
      ligne(100),
      { description: 'Déplacement', quantite: 1, unite: 'forfait', prix_unitaire: 80, total_ht: 80 },
    ],
    description_travaux: 'Travaux',
    questions_manquantes: [],
    confiance: 'haute',
  };

  const reply = (obj: unknown) =>
    createMock.mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify(obj) }] });

  it('modifie une ligne et recalcule total_ht, en conservant les métadonnées', async () => {
    reply({
      is_new_devis: false,
      lignes: [
        { description: 'Poste', quantite: 2, unite: 'forfait', prix_unitaire: 150, total_ht: 0 },
        { description: 'Déplacement', quantite: 1, unite: 'forfait', prix_unitaire: 80, total_ht: 80 },
      ],
    });
    const { extraction, is_new_devis } = await applyRecapEdit(base, 'ligne 1 à 150, quantité 2');
    expect(is_new_devis).toBe(false);
    expect(extraction.lignes[0].total_ht).toBe(300); // 2 × 150 recalculé serveur
    expect(extraction.description_travaux).toBe('Travaux');
  });

  it('supprime une ligne', async () => {
    reply({
      is_new_devis: false,
      lignes: [{ description: 'Poste', quantite: 1, unite: 'forfait', prix_unitaire: 100, total_ht: 100 }],
    });
    const { extraction } = await applyRecapEdit(base, 'enlève le déplacement');
    expect(extraction.lignes).toHaveLength(1);
    expect(extraction.lignes[0].description).toBe('Poste');
  });

  it('détecte un nouveau devis (is_new_devis) et conserve l’extraction d’origine', async () => {
    reply({ is_new_devis: true, lignes: [] });
    const { extraction, is_new_devis } = await applyRecapEdit(base, 'en fait, devis pour une toiture neuve 200m²');
    expect(is_new_devis).toBe(true);
    expect(extraction).toBe(base);
  });
});
