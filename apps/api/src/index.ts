import 'dotenv/config';
import express from 'express';
import webhookTelegram from './routes/webhook-telegram.js';
import webhookWhatsapp from './routes/webhook-whatsapp.js';
import webhookStripe from './routes/webhook-stripe.js';
import devisRouter from './routes/devis.js';
import { setWebhook } from './services/telegram.js';

const app = express();
const PORT = process.env.PORT ?? 3001;

// ─── Stripe webhook — raw body obligatoire AVANT express.json() ───────────────
app.use('/webhook/stripe', express.raw({ type: 'application/json' }), webhookStripe);

// ─── Middlewares globaux ──────────────────────────────────────────────────────
app.use(express.json());

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const origin = req.headers.origin ?? '';
  // Autoriser : localhost, Vercel (*.vercel.app), domaine prod
  const isAllowed =
    !origin ||
    origin.startsWith('http://localhost') ||
    origin.endsWith('.vercel.app') ||
    origin === (process.env.APP_URL ?? '');
  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  }
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/webhook/telegram', webhookTelegram);
app.use('/webhook/whatsapp', webhookWhatsapp);
app.use('/api/devis', devisRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ─── Setup webhook Telegram (appelé au démarrage si APP_URL défini) ───────────
app.get('/setup-webhook', async (_req, res) => {
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
