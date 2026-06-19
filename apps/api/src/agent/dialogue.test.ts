import { describe, it, expect } from 'vitest';
import { getDevise, detectDeviseIntent, inferMetier } from './dialogue.js';

describe('getDevise (devise selon préfixe téléphonique)', () => {
  it('FR → EUR 20%', () => {
    expect(getDevise('+33612345678')).toEqual({ devise: 'EUR', tva: 20 });
    expect(getDevise('0033612345678')).toEqual({ devise: 'EUR', tva: 20 });
  });

  it('BE → EUR 21%', () => {
    expect(getDevise('+32470000000')).toEqual({ devise: 'EUR', tva: 21 });
  });

  it('défaut (CH) → CHF 8.1%', () => {
    expect(getDevise('+41790000000')).toEqual({ devise: 'CHF', tva: 8.1 });
  });
});

describe('detectDeviseIntent (changement explicite de devise)', () => {
  it('détecte une bascule en euros', () => {
    expect(detectDeviseIntent('mets-le plutôt en euros')).toEqual({ devise: 'EUR', tva: 20 });
  });

  it('détecte une bascule en francs suisses', () => {
    expect(detectDeviseIntent('facture en CHF')).toEqual({ devise: 'CHF', tva: 8.1 });
  });

  it('ne se déclenche pas sur un simple montant', () => {
    expect(detectDeviseIntent('le total est de 5000 CHF environ')).toBeNull();
  });

  it('reste null si les deux devises sont mentionnées (ambigu)', () => {
    expect(detectDeviseIntent('en euros ou en chf ?')).toBeNull();
  });
});

describe('inferMetier (détection du métier)', () => {
  it('reconnaît un plombier', () => {
    expect(inferMetier('remplacement chaudière et robinet')).toBe('plombier');
  });

  it('reconnaît un électricien', () => {
    expect(inferMetier('mise aux normes du tableau électrique')).toBe('electricien');
  });

  it('renvoie null si aucun mot-clé', () => {
    expect(inferMetier('bla bla quelque chose')).toBeNull();
  });
});
