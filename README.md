# DevisVocal — MVP

Agent conversationnel WhatsApp qui génère des devis professionnels PDF via messages vocaux.

**Stack** : Node.js + Express · Next.js · Supabase · 360dialog · Whisper · Claude · Stripe · Resend · Railway + Vercel

---

## Architecture

```
WhatsApp vocal/texte
    ↓ 360dialog webhook
    ↓ POST /webhook/whatsapp
Backend API (Node.js / Railway)
    ├── Whisper — transcription audio
    ├── Claude — extraction champs devis + dialogue
    ├── Google Maps — recherche entreprise onboarding
    └── Supabase — PostgreSQL + Storage PDF
            ↓ lien JWT 24h
SaaS Web (Next.js / Vercel)
    ├── /devis/[token] — aperçu devis + formulaire
    └── Stripe Checkout (2.90 CHF)
            ↓ webhook stripe
    Génération PDF (Puppeteer)
    Envoi WhatsApp + Email (Resend)
```

---

## Setup rapide

### 1. Prérequis

- Node.js 20+, pnpm 9+
- Compte Supabase (gratuit)
- Compte 360dialog (WhatsApp BSP, ~49€/mois)
- Clés API : Anthropic, OpenAI, Stripe, Resend, Google Maps

### 2. Installation

```bash
git clone <repo>
cd DevisVocal
cp .env.example .env   # remplir les variables
pnpm install
```

### 3. Base de données Supabase

1. Créer un projet sur [supabase.com](https://supabase.com)
2. Aller dans **SQL Editor** et exécuter `supabase/migrations/001_init.sql`
3. Dans **Storage**, créer un bucket public nommé `pdfs`

### 4. Lancer en dev

```bash
# Terminal 1 — API
pnpm --filter @devisvocal/api dev

# Terminal 2 — Web
pnpm --filter @devisvocal/web dev

# Exposer l'API pour 360dialog (ngrok)
ngrok http 3001
```

### 5. Configurer 360dialog

- Webhook URL : `https://your-ngrok.ngrok.io/webhook/whatsapp`
- Verify token : valeur de `WHATSAPP_WEBHOOK_SECRET`

### 6. Configurer Stripe webhook

```bash
stripe listen --forward-to localhost:3001/webhook/stripe
```

---

## Flux complet

```
1. Artisan envoie un message WhatsApp
2. [ONBOARDING] Nom entreprise → Google Maps → confirmation SIRET
3. [ONBOARDING] Email artisan → création client Stripe
4. [COLLECTING]  Artisan décrit les travaux (vocal ou texte)
5. Whisper transcrit le vocal
6. Claude extrait : lignes, quantités, prix, client
7. [CLARIFYING]  Max 2 rounds de questions (max 3 questions/message)
8. [RECAP_SENT]  Récap envoyé → artisan tape OUI
9. [AWAITING_PAYMENT] Lien JWT 24h envoyé
10. Artisan ouvre la page web → voit l'aperçu → paie 2.90 CHF
11. Stripe webhook → PDF généré (Puppeteer) → uploadé Supabase Storage
12. PDF envoyé par WhatsApp + Email (Resend)
```

---

## Variables d'environnement

| Variable | Description |
|---|---|
| `SUPABASE_URL` | URL du projet Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé service role Supabase |
| `ANTHROPIC_API_KEY` | Clé Claude API |
| `OPENAI_API_KEY` | Clé Whisper (OpenAI) |
| `WHATSAPP_API_KEY` | Clé 360dialog |
| `WHATSAPP_WEBHOOK_SECRET` | Token verify webhook |
| `GOOGLE_MAPS_API_KEY` | Google Maps Places API |
| `STRIPE_SECRET_KEY` | Clé secrète Stripe |
| `STRIPE_WEBHOOK_SECRET` | Secret webhook Stripe |
| `STRIPE_PRICE_DEVIS` | Prix par devis (défaut : 2.90) |
| `RESEND_API_KEY` | Clé Resend (emails) |
| `APP_URL` | URL du frontend (ex: https://app.devisvocal.ch) |
| `JWT_SECRET` | Secret JWT pour les tokens devis (min 32 chars) |

---

## Deploy

**Backend → Railway**
```bash
# railway.toml déjà configuré
railway up
```

**Frontend → Vercel**
```bash
vercel --cwd apps/web
```

---

## KPIs MVP (60 jours)

- 20 artisans beta actifs
- Taux de completion > 60%
- Taux de paiement après lien > 30%
- Temps moyen génération < 3 min
- NPS > 7/10

---

## Onboarding 360dialog (à faire avant de coder)

1. Créer compte Meta Business Manager (SnapSolution)
2. Prendre un numéro virtuel dédié (ex. Twilio ~1$/mois)
3. S'inscrire sur [360dialog.com](https://360dialog.com)
4. Embedded Signup (connexion Facebook Admin)
5. Enregistrer le numéro → récupérer la clé API
6. Timing estimé : 2-3 jours ouvrés

---

*DevisVocal by SnapSolution — MVP Phase 1*
