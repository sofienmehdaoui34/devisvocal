// ─── Devis offerts (Jalon 3) ─────────────────────────────────────────────────
// Les N premiers devis d'un artisan sont gratuits (lève le frein à l'achat).
// Configurable via FREE_DEVIS_LIMIT (défaut 3).
const parsed = Number.parseInt(process.env.FREE_DEVIS_LIMIT ?? '', 10);
export const FREE_DEVIS_LIMIT = Number.isFinite(parsed) && parsed >= 0 ? parsed : 3;

// Nombre de devis offerts encore disponibles (devis_count = devis déjà facturés).
export function freeDevisRemaining(devisCount: number, limit = FREE_DEVIS_LIMIT): number {
  return Math.max(0, limit - (devisCount ?? 0));
}

// Le prochain devis est-il offert ?
export function isDevisFree(devisCount: number, limit = FREE_DEVIS_LIMIT): boolean {
  return freeDevisRemaining(devisCount, limit) > 0;
}
