import { Router, type Response } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import {
  getArtisanByAuthUserId,
  findArtisanByPhone,
  setArtisanAuthUser,
  setLinkCode,
  listDevisByArtisan,
} from '../services/supabase.js';
import { normalizePhone, generateLinkCode, isLinkCodeValid, LINK_CODE_TTL_MS } from '../utils/account.js';
import { safeError } from '../utils/errors.js';

const router = Router();

// Envoie le code de rattachement via le bot (WhatsApp si E.164, Telegram sinon).
async function sendCodeViaBot(phone: string, code: string): Promise<void> {
  const msg = `🔐 DevisVocal — votre code de rattachement : *${code}* (valable 10 min). Si vous n'avez rien demandé, ignorez ce message.`;
  if (phone.startsWith('+')) {
    const w = await import('../services/whatsapp.js');
    await w.sendText(phone, msg);
  } else {
    const t = await import('../services/telegram.js');
    await t.sendText(phone, msg);
  }
}

// GET /api/account/me — état du compte connecté + ses devis s'il est rattaché.
router.get('/me', requireAuth, async (req: AuthedRequest, res: Response) => {
  const artisan = await getArtisanByAuthUserId(req.authUser!.id);
  if (!artisan) {
    res.json({ linked: false });
    return;
  }
  const devis = await listDevisByArtisan(artisan.id);
  res.json({ linked: true, artisan, devis });
});

const phoneSchema = z.object({ phone: z.string().trim().min(6).max(40) });
const verifySchema = z.object({
  phone: z.string().trim().min(6).max(40),
  code: z.string().trim().min(4).max(8),
});

// POST /api/account/link/request — envoie un code au n° via le bot.
// Réponse NEUTRE (ne révèle pas si le numéro existe) → anti-énumération.
router.post('/link/request', requireAuth, async (req: AuthedRequest, res: Response) => {
  const parsed = phoneSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Numéro invalide' });
    return;
  }
  const phone = normalizePhone(parsed.data.phone);
  try {
    const artisan = await findArtisanByPhone(phone);
    if (artisan) {
      const code = generateLinkCode();
      const expires = new Date(Date.now() + LINK_CODE_TTL_MS).toISOString();
      await setLinkCode(artisan.id, code, expires);
      await sendCodeViaBot(phone, code);
    }
  } catch (err) {
    console.error('[account] link/request (non-bloquant):', safeError(err));
  }
  res.json({ ok: true });
});

// POST /api/account/link/verify — vérifie le code et rattache le compte.
router.post('/link/verify', requireAuth, async (req: AuthedRequest, res: Response) => {
  const parsed = verifySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Code invalide' });
    return;
  }
  const phone = normalizePhone(parsed.data.phone);
  const artisan = await findArtisanByPhone(phone);

  if (!artisan || !isLinkCodeValid(parsed.data.code, artisan.link_code, artisan.link_code_expires)) {
    res.status(400).json({ error: 'Code incorrect ou expiré' });
    return;
  }
  if (artisan.auth_user_id && artisan.auth_user_id !== req.authUser!.id) {
    res.status(409).json({ error: 'Ce numéro est déjà rattaché à un autre compte.' });
    return;
  }

  await setArtisanAuthUser(artisan.id, req.authUser!.id);
  res.json({ linked: true });
});

export default router;
