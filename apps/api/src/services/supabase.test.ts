import { describe, it, expect } from 'vitest';
import type { LigneDevis } from '@devisvocal/types';
import { normalizePrestationLabel, lignesToPrestations } from './supabase.js';

describe('normalizePrestationLabel', () => {
  it('met en minuscule, trim et compacte les espaces', () => {
    expect(normalizePrestationLabel('  Pose   de Carrelage  ')).toBe('pose de carrelage');
  });

  it('gère une valeur vide', () => {
    expect(normalizePrestationLabel('')).toBe('');
  });
});

describe('lignesToPrestations', () => {
  const ligne = (description: string, prix: number, unite = 'forfait'): LigneDevis => ({
    description,
    quantite: 1,
    unite,
    prix_unitaire: prix,
    total_ht: prix,
  });

  it('normalise le label et reporte la devise', () => {
    const out = lignesToPrestations([ligne('Déplacement', 80)], 'CHF');
    expect(out).toEqual([{ label: 'déplacement', unite: 'forfait', prix_unitaire: 80, devise: 'CHF' }]);
  });

  it('ignore les lignes sans prix ou sans label/unité', () => {
    const out = lignesToPrestations(
      [ligne('Gratuit', 0), { description: '', quantite: 1, unite: 'h', prix_unitaire: 50, total_ht: 50 }],
      'EUR'
    );
    expect(out).toHaveLength(0);
  });

  it('dédoublonne par (label, unité) en gardant la dernière valeur', () => {
    const out = lignesToPrestations([ligne('Heure', 90, 'h'), ligne('heure', 95, 'h')], 'CHF');
    expect(out).toHaveLength(1);
    expect(out[0].prix_unitaire).toBe(95);
  });
});
