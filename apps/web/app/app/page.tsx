'use client';

import { useEffect, useState, useCallback } from 'react';
import type { Devis, Artisan } from '@devisvocal/types';
import { getSupabaseBrowser } from '../../lib/supabase';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const deviseFromTva = (tva: number): 'CHF' | 'EUR' => (tva >= 15 ? 'EUR' : 'CHF');
const fmt = (n: number, tva: number) => {
  const devise = deviseFromTva(tva);
  const sep = devise === 'CHF' ? "'" : ' ';
  return `${devise} ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, sep)}`;
};

const STATUT_LABEL: Record<string, { txt: string; cls: string }> = {
  brouillon: { txt: 'Brouillon', cls: 'bg-gray-100 text-gray-600' },
  en_attente_paiement: { txt: 'En attente', cls: 'bg-amber-100 text-amber-700' },
  payé: { txt: 'Payé', cls: 'bg-emerald-100 text-emerald-700' },
  envoyé: { txt: 'Envoyé', cls: 'bg-emerald-100 text-emerald-700' },
};

interface MeResponse {
  linked: boolean;
  artisan?: Artisan;
  devis?: Devis[];
}

export default function DashboardPage() {
  const [authLoading, setAuthLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  const [me, setMe] = useState<MeResponse | null>(null);
  const [meLoading, setMeLoading] = useState(false);

  // Rattachement
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [linkStep, setLinkStep] = useState<'phone' | 'code'>('phone');
  const [linkMsg, setLinkMsg] = useState<string | null>(null);
  const [linkErr, setLinkErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ── Session Supabase ──
  useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      try {
        const supabase = getSupabaseBrowser();
        const { data } = await supabase.auth.getSession();
        setToken(data.session?.access_token ?? null);
        const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
          setToken(session?.access_token ?? null);
        });
        unsub = () => listener.subscription.unsubscribe();
      } catch (e) {
        setConfigError(e instanceof Error ? e.message : 'Supabase non configuré.');
      } finally {
        setAuthLoading(false);
      }
    })();
    return () => unsub?.();
  }, []);

  const loadMe = useCallback(async () => {
    if (!token) return;
    setMeLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/account/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as MeResponse;
      setMe(res.ok ? data : { linked: false });
    } catch {
      setMe({ linked: false });
    } finally {
      setMeLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) loadMe();
  }, [token, loadMe]);

  const requestCode = async () => {
    setLinkErr(null);
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/account/link/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) {
        setLinkErr('Impossible d’envoyer le code. Vérifiez le numéro.');
        return;
      }
      setLinkStep('code');
      setLinkMsg('Si ce numéro est connu, un code vous a été envoyé sur WhatsApp/Telegram.');
    } catch {
      setLinkErr('Erreur réseau. Réessayez.');
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    setLinkErr(null);
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/account/link/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ phone, code }),
      });
      const data = (await res.json().catch(() => ({}))) as { linked?: boolean; error?: string };
      if (!res.ok || !data.linked) {
        setLinkErr(data.error ?? 'Code incorrect ou expiré.');
        return;
      }
      await loadMe();
    } catch {
      setLinkErr('Erreur réseau. Réessayez.');
    } finally {
      setBusy(false);
    }
  };

  // ── Rendus ──
  if (authLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand" />
      </main>
    );
  }

  if (configError) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow p-8 max-w-md text-center" role="alert">
          <div className="text-4xl mb-4">⚙️</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Configuration manquante</h1>
          <p className="text-gray-500 text-sm">{configError}</p>
        </div>
      </main>
    );
  }

  if (!token) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow p-8 max-w-md text-center">
          <div className="text-4xl mb-4">🔒</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Connexion requise</h1>
          <p className="text-gray-500 text-sm mb-5">Connectez-vous pour accéder à vos devis.</p>
          <a href="/login" className="inline-block bg-brand hover:bg-brand-dark text-white font-semibold px-6 py-3 rounded-xl transition-colors">
            Se connecter
          </a>
        </div>
      </main>
    );
  }

  // Connecté mais compte pas encore rattaché → flux de rattachement
  if (me && !me.linked) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-md w-full">
          <div className="text-center mb-6">
            <div className="text-4xl mb-2">🔗</div>
            <h1 className="text-2xl font-bold text-gray-900">Reliez votre compte</h1>
            <p className="text-gray-500 text-sm mt-1">
              Pour retrouver vos devis, reliez ce compte à votre numéro WhatsApp.
            </p>
          </div>

          {linkStep === 'phone' ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Votre numéro WhatsApp</label>
                <input
                  type="tel"
                  aria-label="Numéro WhatsApp"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+41 79 123 45 67"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                />
              </div>
              {linkErr && <p className="text-sm text-red-600 text-center" role="alert">⚠️ {linkErr}</p>}
              <button
                onClick={requestCode}
                disabled={busy || phone.trim().length < 6}
                aria-busy={busy}
                className="w-full bg-brand hover:bg-brand-dark text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-60"
              >
                {busy ? 'Envoi…' : 'Recevoir le code sur WhatsApp'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {linkMsg && <p className="text-sm text-emerald-600 text-center">{linkMsg}</p>}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Code reçu (6 chiffres)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label="Code de rattachement"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-brand"
                />
              </div>
              {linkErr && <p className="text-sm text-red-600 text-center" role="alert">⚠️ {linkErr}</p>}
              <button
                onClick={verifyCode}
                disabled={busy || code.trim().length < 4}
                aria-busy={busy}
                className="w-full bg-brand hover:bg-brand-dark text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-60"
              >
                {busy ? 'Vérification…' : 'Relier mon compte'}
              </button>
              <button
                onClick={() => { setLinkStep('phone'); setCode(''); setLinkErr(null); }}
                className="w-full text-gray-500 text-sm hover:text-gray-700"
              >
                ← Changer de numéro
              </button>
            </div>
          )}
        </div>
      </main>
    );
  }

  // Rattaché → dashboard
  const artisan = me?.artisan;
  const devis = me?.devis ?? [];

  return (
    <main className="min-h-screen py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="bg-brand text-white rounded-2xl p-6 mb-6">
          <p className="text-blue-200 text-sm font-medium uppercase tracking-wide">Espace client</p>
          <h1 className="text-2xl font-bold mt-1">{artisan?.nom_entreprise ?? 'Mon entreprise'}</h1>
          <p className="text-blue-200 text-sm mt-1">{devis.length} devis</p>
        </div>

        {/* Profil société (lecture) */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Ma société</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-gray-700">
            <p><span className="text-gray-400">Entreprise :</span> {artisan?.nom_entreprise ?? '—'}</p>
            <p><span className="text-gray-400">Email :</span> {artisan?.email ?? '—'}</p>
            <p><span className="text-gray-400">Téléphone :</span> {artisan?.telephone ?? '—'}</p>
            <p><span className="text-gray-400">Adresse :</span> {artisan?.adresse ?? '—'}</p>
          </div>
        </div>

        {/* Liste des devis */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <p className="font-bold text-gray-900">Mes devis</p>
            {meLoading && <span className="text-xs text-gray-400">Chargement…</span>}
          </div>

          {devis.length === 0 ? (
            <p className="px-6 py-10 text-center text-gray-500 text-sm">
              Aucun devis pour l’instant. Dictez-en un sur WhatsApp ! 🎤
            </p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {devis.map((d) => {
                const s = STATUT_LABEL[d.statut] ?? { txt: d.statut, cls: 'bg-gray-100 text-gray-600' };
                return (
                  <li key={d.id}>
                    <a
                      href={`/devis/${d.token}`}
                      className="flex items-center justify-between gap-3 px-6 py-4 hover:bg-gray-50/60 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900 truncate">{d.numero}</p>
                        <p className="text-gray-500 text-sm truncate">
                          {d.client_nom ?? 'Client —'} · {new Date(d.created_at).toLocaleDateString('fr-CH')}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-semibold text-gray-900">{fmt(d.montant_ttc, d.tva)}</p>
                        <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full ${s.cls}`}>{s.txt}</span>
                      </div>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">Généré par DevisVocal — SnapSolution</p>
      </div>
    </main>
  );
}
