import { describe, it, expect } from 'vitest';
import { escapeHtml } from './index.js';

describe('escapeHtml', () => {
  it('échappe les caractères HTML dangereux (anti-XSS)', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
    );
  });

  it("échappe les apostrophes et esperluettes", () => {
    expect(escapeHtml(`Plomberie & Fils d'Or`)).toBe('Plomberie &amp; Fils d&#39;Or');
  });

  it('renvoie une chaîne vide pour null/undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('convertit les nombres en chaîne', () => {
    expect(escapeHtml(42)).toBe('42');
  });
});
