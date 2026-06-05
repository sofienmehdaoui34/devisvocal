import crypto from 'node:crypto';

/**
 * Génère un token court pour l'URL publique du devis.
 * Format : UUID v4 (36 chars) — compatible WhatsApp/Telegram.
 * La sécurité repose sur le secret de l'UUID + expires_at en DB.
 */
export function generateDevisToken(_devisId?: string): string {
  return crypto.randomUUID();
}

/**
 * Vérifie qu'un token a le bon format (UUID).
 * La vérification réelle se fait via la DB (getDevisByToken + expires_at).
 */
export function verifyDevisToken(token: string): { devisId: string } | null {
  // UUID v4 : xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token);
  if (!isUuid) return null;
  // On retourne un objet compatible avec l'interface existante
  // La vraie vérification (expiry, existence) se fait dans la route
  return { devisId: token };
}
