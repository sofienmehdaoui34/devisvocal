import { describe, it, expect, vi } from 'vitest';
import { withRetry, withTimeout } from './retry.js';

describe('withRetry', () => {
  it('retourne le résultat au premier succès (sans réessai)', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(fn, { retries: 2, baseMs: 1 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('réessaie sur échec puis réussit', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue('ok');
    await expect(withRetry(fn, { retries: 2, baseMs: 1 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('abandonne après N essais et propage la dernière erreur', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always'));
    await expect(withRetry(fn, { retries: 2, baseMs: 1 })).rejects.toThrow('always');
    expect(fn).toHaveBeenCalledTimes(3); // 1 essai initial + 2 réessais
  });
});

describe('withTimeout', () => {
  it('résout si la promesse aboutit dans les temps', async () => {
    await expect(withTimeout(Promise.resolve(42), 50)).resolves.toBe(42);
  });

  it('rejette si le délai est dépassé', async () => {
    const slow = new Promise((res) => setTimeout(() => res('late'), 50));
    await expect(withTimeout(slow, 10, 'opération test')).rejects.toThrow(/délai dépassé/);
  });
});
