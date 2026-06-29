import crypto from 'node:crypto';

// ─── Rattachement compte web ↔ fiche artisan (Phase A) ───────────────────────

/**
 * Normalise un numéro de téléphone pour le rapprochement : ne garde que les
 * chiffres et un éventuel « + » initial. Tolère espaces, points, tirets, etc.
 * Ex: "+41 79 123 45 67" → "+41791234567" ; "0041.79..." → "004179...".
 */
export function normalizePhone(phone: string): string {
  if (!phone) return '';
  const trimmed = phone.trim();
  const plus = trimmed.startsWith('+') ? '+' : '';
  return plus + trimmed.replace(/[^\d]/g, '');
}

/** Code de rattachement à 6 chiffres (envoyé via le bot). */
export function generateLinkCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * Valide un code de rattachement : doit correspondre exactement au code stocké
 * et ne pas être expiré. `nowMs`/`expiresIso` injectables pour les tests.
 */
export function isLinkCodeValid(
  input: string | undefined,
  stored: string | undefined,
  expiresIso: string | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!input || !stored || !expiresIso) return false;
  if (input.trim() !== stored) return false;
  const exp = new Date(expiresIso).getTime();
  return Number.isFinite(exp) && exp > nowMs;
}

/** Durée de validité d'un code de rattachement. */
export const LINK_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
