// Variables d'environnement factices pour les tests : permettent d'importer les
// modules qui instancient des clients (Supabase, Stripe, Anthropic…) sans erreur
// et sans effectuer d'appel réseau (les fonctions réseau sont mockées par test).
process.env.SUPABASE_URL ??= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';
process.env.ANTHROPIC_API_KEY ??= 'test-anthropic-key';
process.env.STRIPE_SECRET_KEY ??= 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_dummy';
process.env.APP_URL ??= 'http://localhost:3000';
