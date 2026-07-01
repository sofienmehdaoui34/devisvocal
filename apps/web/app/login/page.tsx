'use client';

import { useState } from 'react';
import { getSupabaseBrowser } from '../../lib/supabase';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

  const handleSubmit = async () => {
    if (!isEmail(email)) {
      setError('Adresse email invalide.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const supabase = getSupabaseBrowser();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/app` },
      });
      if (error) {
        setError(error.message);
        return;
      }
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inattendue.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-md w-full">
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">📋</div>
          <h1 className="text-2xl font-bold text-gray-900">Espace client</h1>
          <p className="text-gray-500 text-sm mt-1">Connectez-vous pour retrouver vos devis.</p>
        </div>

        {sent ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center" role="status">
            <div className="text-3xl mb-2">📧</div>
            <p className="font-semibold text-emerald-800">Vérifiez vos emails</p>
            <p className="text-emerald-600 text-sm mt-1">
              On vous a envoyé un lien de connexion à <strong>{email}</strong>. Cliquez dessus pour entrer.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Votre email</label>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                aria-label="Adresse email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                placeholder="vous@exemple.ch"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 text-center" role="alert">⚠️ {error}</p>
            )}

            <button
              onClick={handleSubmit}
              disabled={loading}
              aria-busy={loading}
              className="w-full bg-brand hover:bg-brand-dark text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? 'Envoi…' : 'Recevoir mon lien de connexion'}
            </button>
            <p className="text-xs text-gray-400 text-center">
              Pas de mot de passe : on vous envoie un lien magique par email.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
