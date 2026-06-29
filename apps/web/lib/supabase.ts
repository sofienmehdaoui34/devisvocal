import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Client Supabase navigateur, initialisé paresseusement : on ne le crée qu'au
// moment d'un appel (effet / handler côté client), jamais au prerender SSR —
// ainsi un build sans variables d'env ne casse pas (les pages restent rendables).
let _client: SupabaseClient | null = null;

export function getSupabaseBrowser(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Supabase non configuré : définissez NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  }
  _client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return _client;
}
