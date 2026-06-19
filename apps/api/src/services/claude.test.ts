import { describe, it, expect } from 'vitest';
import type { ExtractionResult, LigneDevis } from '@devisvocal/types';
import { computeTotals, buildRecapMessage } from './claude.js';

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
});
