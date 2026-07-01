import crypto from 'node:crypto';

/**
 * Valide l'en-tête `X-Twilio-Signature` d'une requête webhook Twilio.
 *
 * Algorithme Twilio : concaténer l'URL complète puis, pour chaque paramètre
 * POST trié par clé, `clé + valeur`. HMAC-SHA1 avec l'auth token, encodé base64.
 * https://www.twilio.com/docs/usage/security#validating-requests
 */
export function validateTwilioSignature(
  authToken: string,
  signature: string | undefined,
  url: string,
  params: Record<string, string>
): boolean {
  if (!signature) return false;

  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);

  const expected = crypto
    .createHmac('sha1', authToken)
    .update(Buffer.from(data, 'utf-8'))
    .digest('base64');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false; // longueurs différentes → signature invalide
  }
}
