import 'dotenv/config';
import './config.js'; // valide les variables d'environnement au démarrage
import express from 'express';
import webhookTelegram from './routes/webhook-telegram.js';
import webhookWhatsapp from './routes/webhook-whatsapp.js';
import webhookStripe from './routes/webhook-stripe.js';
import devisRouter from './routes/devis.js';
import accountRouter from './routes/account.js';
import { setWebhook } from './services/telegram.js';

const app = express();
const PORT = process.env.PORT ?? 3001;

// Derrière le proxy Railway : nécessaire pour reconstruire l'URL publique
// (protocole/host) lors de la validation de signature des webhooks.
app.set('trust proxy', true);

// ─── Stripe webhook — raw body obligatoire AVANT express.json() ───────────────
app.use('/webhook/stripe', express.raw({ type: 'application/json' }), webhookStripe);

// ─── Middlewares globaux ──────────────────────────────────────────────────────
app.use(express.json());

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Restreint à l'origine du frontend (APP_URL) plutôt que "*".
const ALLOWED_ORIGIN = process.env.APP_URL ?? '*';
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/webhook/telegram', webhookTelegram);
app.use('/webhook/whatsapp', webhookWhatsapp);
app.use('/api/devis', devisRouter);
app.use('/api/account', accountRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ─── Setup webhook Telegram (protégé par ADMIN_API_TOKEN) ─────────────────────
app.get('/setup-webhook', async (req, res) => {
  const adminToken = process.env.ADMIN_API_TOKEN;
  if (!adminToken || req.headers['x-admin-token'] !== adminToken) {
    res.status(403).json({ error: 'Accès refusé' });
    return;
  }
  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    res.status(400).json({ error: 'APP_URL non défini dans .env' });
    return;
  }
  try {
    await setWebhook(`${appUrl}/webhook/telegram`);
    res.json({ ok: true, webhook: `${appUrl}/webhook/telegram` });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ DevisVocal API running on port ${PORT}`);
  console.log(`   Telegram webhook : ${process.env.TUNNEL_URL ?? 'http://localhost:' + PORT}/webhook/telegram`);
  console.log(`   Web app          : ${process.env.APP_URL ?? 'http://localhost:3000'}`);
});

export default app;
