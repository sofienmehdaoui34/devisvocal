import { describe, it, expect } from 'vitest';
import { normalizePhone, generateLinkCode, isLinkCodeValid } from './account.js';

describe('normalizePhone', () => {
  it('garde le + initial et ne conserve que les chiffres', () => {
    expect(normalizePhone('+41 79 123 45 67')).toBe('+41791234567');
    expect(normalizePhone(' +33-6.12.34.56.78 ')).toBe('+33612345678');
  });

  it('sans + → chiffres uniquement', () => {
    expect(normalizePhone('0041 79 123 45 67')).toBe('0041791234567');
  });

  it('gère une entrée vide', () => {
    expect(normalizePhone('')).toBe('');
  });
});

describe('generateLinkCode', () => {
  it('renvoie un code à 6 chiffres', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateLinkCode()).toMatch(/^\d{6}$/);
    }
  });
});

describe('isLinkCodeValid', () => {
  const now = 1_000_000;
  const future = new Date(now + 60_000).toISOString();
  const past = new Date(now - 60_000).toISOString();

  it('valide un code correct non expiré', () => {
    expect(isLinkCodeValid('123456', '123456', future, now)).toBe(true);
  });

  it('rejette un code erroné', () => {
    expect(isLinkCodeValid('000000', '123456', future, now)).toBe(false);
  });

  it('rejette un code expiré', () => {
    expect(isLinkCodeValid('123456', '123456', past, now)).toBe(false);
  });

  it('rejette si code/expiration manquants', () => {
    expect(isLinkCodeValid('123456', undefined, future, now)).toBe(false);
    expect(isLinkCodeValid(undefined, '123456', future, now)).toBe(false);
    expect(isLinkCodeValid('123456', '123456', undefined, now)).toBe(false);
  });
});
