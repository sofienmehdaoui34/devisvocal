import { describe, it, expect } from 'vitest';
import { generateDevisToken, verifyDevisToken } from './token.js';

describe('token devis', () => {
  it('génère un UUID v4 vérifiable', () => {
    const token = generateDevisToken();
    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(verifyDevisToken(token)).toEqual({ devisId: token });
  });

  it('rejette un format non-UUID', () => {
    expect(verifyDevisToken('pas-un-uuid')).toBeNull();
    expect(verifyDevisToken('')).toBeNull();
  });
});
