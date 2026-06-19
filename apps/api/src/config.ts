import 'dotenv/config';
import { z } from 'zod';

/**
 * Validation des variables d'environnement au démarrage.
 *
 * - En production (`NODE_ENV=production`), une variable requise manquante fait
 *   échouer le boot immédiatement avec un message clair.
 * - En dev, on se contente d'un avertissement pour ne pas bloquer le travail
 *   local (le mode dev de `routes/devis.ts` fonctionne sans clé Stripe, etc.).
 */
const isProd = process.env.NODE_ENV === 'production';

// Variables indispensables au fonctionnement nominal.
const requiredSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  APP_URL: z.string().url(),
});

// Variables optionnelles : on prévient si elles manquent (fonctionnalité dégradée).
const optionalVars = [
  'OPENAI_API_KEY', // transcription vocale
  'TELEGRAM_BOT_TOKEN', // canal Telegram
  'TELEGRAM_WEBHOOK_SECRET', // auth webhook Telegram
  'TWILIO_ACCOUNT_SID', // canal WhatsApp
  'TWILIO_AUTH_TOKEN',
  'WHATSAPP_WEBHOOK_SECRET', // auth webhook WhatsApp/Twilio
  'RESEND_API_KEY', // envoi email
  'GOOGLE_MAPS_API_KEY', // onboarding entreprise
] as const;

export function validateEnv(): void {
  const result = requiredSchema.safeParse(process.env);

  if (!result.success) {
    const missing = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    const header = `Variables d'environnement requises invalides ou manquantes:\n${missing}`;

    if (isProd) {
      throw new Error(`[config] ${header}`);
    }
    console.warn(`[config] (dev) ${header}`);
  }

  const missingOptional = optionalVars.filter((v) => !process.env[v]);
  if (missingOptional.length > 0) {
    console.warn(
      `[config] variables optionnelles absentes (fonctionnalités dégradées): ${missingOptional.join(', ')}`
    );
  }
}

validateEnv();
