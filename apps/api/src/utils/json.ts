/**
 * Parse du JSON en levant une erreur claire (et en loggant un extrait de la
 * réponse brute) plutôt qu'une `SyntaxError` opaque qui ferait planter le flux.
 */
export function safeJsonParse<T>(raw: string, label = 'JSON'): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.error(`[parse] ${label} invalide — réponse brute (tronquée):`, raw.slice(0, 500));
    throw new Error(`Réponse ${label} invalide : JSON non parsable`);
  }
}
