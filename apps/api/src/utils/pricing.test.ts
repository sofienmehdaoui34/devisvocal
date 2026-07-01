import { describe, it, expect } from 'vitest';
import { freeDevisRemaining, isDevisFree } from './pricing.js';

describe('freeDevisRemaining', () => {
  it('décompte les devis offerts restants (limite 3)', () => {
    expect(freeDevisRemaining(0, 3)).toBe(3);
    expect(freeDevisRemaining(2, 3)).toBe(1);
    expect(freeDevisRemaining(3, 3)).toBe(0);
  });

  it('ne descend jamais sous zéro', () => {
    expect(freeDevisRemaining(5, 3)).toBe(0);
  });
});

describe('isDevisFree', () => {
  it('offert tant que le quota n’est pas atteint', () => {
    expect(isDevisFree(0, 3)).toBe(true); // 1er
    expect(isDevisFree(2, 3)).toBe(true); // 3e
  });

  it('payant une fois le quota atteint', () => {
    expect(isDevisFree(3, 3)).toBe(false); // 4e
    expect(isDevisFree(10, 3)).toBe(false);
  });

  it('limite 0 → tout est payant', () => {
    expect(isDevisFree(0, 0)).toBe(false);
  });
});
