import { describe, it, expect, vi } from 'vitest';
import { safeJsonParse } from './json.js';

describe('safeJsonParse', () => {
  it('parse du JSON valide', () => {
    expect(safeJsonParse<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('lève une erreur claire (sans SyntaxError opaque) sur JSON invalide', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => safeJsonParse('pas du json', 'extraction')).toThrow(/extraction invalide/);
  });
});
