import { safeError } from './errors.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface RetryOptions {
  retries?: number; // nombre de ré-essais APRÈS le premier (défaut 2)
  baseMs?: number; // délai de base du backoff exponentiel (défaut 500ms)
  label?: string; // libellé pour les logs
}

/**
 * Exécute `fn` avec backoff exponentiel sur erreur.
 * Délais : baseMs, baseMs*2, baseMs*4, …
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  const baseMs = opts.baseMs ?? 500;
  const label = opts.label ? ` ${opts.label}` : '';

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      const delay = baseMs * 2 ** attempt;
      console.warn(
        `[retry${label}] tentative ${attempt + 1}/${retries + 1} échouée — nouvel essai dans ${delay}ms:`,
        safeError(err)
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

/**
 * Rejette avec une erreur explicite si `promise` n'aboutit pas avant `ms`.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label = 'opération'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} : délai dépassé (${ms}ms)`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
