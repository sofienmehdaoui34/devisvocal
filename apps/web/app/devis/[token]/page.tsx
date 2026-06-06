'use client';

import { useEffect, useState, useTransition } from 'react';
import { useParams } from 'next/navigation';
import type { Devis, Artisan } from '@devisvocal/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const fmt = (n: number) => `CHF ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, "'")}`;

export default function DevisPage() {
  const { token } = useParams<{ token: string }>();

  const [devis, setDevis] = useState<Devis | null>(null);
  const [artisan, setArtisan] = useState<Artisan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Infos client (email pour recevoir le PDF)
  const [clientEmail, setClientEmail] = useState('');

  // Infos artisan (collectées si manquantes)
  const [artisanNom, setArtisanNom] = useState('');
  const [artisanEmail, setArtisanEmail] = useState('');
  const [artisanTel, setArtisanTel] = useState('');
  const [artisanAdresse, setArtisanAdresse] = useState('');

  useEffect(() => {
    fetch(`${API_URL}/api/devis/${token}`)
      .then((r) => r.json())
      .then((data: { devis: Devis; artisan: Artisan; error?: string }) => {
        if (data.error) {
          setError(data.error);
        } else {
          setDevis(data.devis);
          setArtisan(data.artisan);
          setClientEmail(data.devis.client_email ?? '');
          // Pré-remplir ce qu'on a déjà
          setArtisanNom(data.artisan?.nom_entreprise ?? '');
          setArtisanEmail(data.artisan?.email ?? '');
        }
      })
      .catch(() => setError('Impossible de charger le devis.'));
  }, [token]);

  // Profil artisan incomplet ?
  const profileIncomplet = artisan && (!artisan.nom_entreprise || !artisan.email);

  const handlePay = () => {
    startTransition(async () => {
      const res = await fetch(`${API_URL}/api/devis/${token}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_email: clientEmail || undefined,
          artisan_nom_entreprise: artisanNom || undefined,
          artisan_email: artisanEmail || undefined,
          artisan_telephone: artisanTel || undefined,
          artisan_adresse: artisanAdresse || undefined,
        }),
      });
      const data = await res.json() as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error ?? 'Erreur lors du paiement.');
      }
    });
  };

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow p-8 max-w-md text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Lien invalide</h1>
          <p className="text-gray-500">{error}</p>
        </div>
      </main>
    );
  }

  if (!devis) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand" />
      </main>
    );
  }

  const isExpired = new Date(devis.expires_at) < new Date();
  const isPaid = devis.statut === 'payé' || devis.statut === 'envoyé';

  return (
    <main className="min-h-screen py-8 px-4">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="bg-brand text-white rounded-2xl p-6 mb-6">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-blue-200 text-sm font-medium uppercase tracking-wide">Devis</p>
              <h1 className="text-2xl font-bold mt-1">{devis.numero}</h1>
              <p className="text-blue-200 text-sm mt-1">
                {artisan?.nom_entreprise ?? 'Votre entreprise'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold">{fmt(devis.montant_ttc)}</p>
              <p className="text-blue-200 text-sm">TTC</p>
            </div>
          </div>
        </div>

        {/* Statut payé */}
        {isPaid && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6 flex items-center gap-3">
            <span className="text-2xl">✅</span>
            <div>
              <p className="font-semibold text-green-800">Devis payé</p>
              <p className="text-green-600 text-sm">Le PDF a été envoyé par Telegram/WhatsApp et email.</p>
            </div>
          </div>
        )}

        {/* Expiré */}
        {isExpired && !isPaid && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-6 flex items-center gap-3">
            <span className="text-2xl">⏰</span>
            <div>
              <p className="font-semibold text-orange-800">Lien expiré</p>
              <p className="text-orange-600 text-sm">Retournez sur le bot pour générer un nouveau lien.</p>
            </div>
          </div>
        )}

        {/* Devis */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-6">

          {/* Parties */}
          <div className="grid grid-cols-2 gap-4 p-6 border-b border-gray-100">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Prestataire</p>
              <p className="font-semibold text-gray-900">{artisan?.nom_entreprise ?? '—'}</p>
              {artisan?.adresse && <p className="text-gray-500 text-sm">{artisan.adresse}</p>}
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Client</p>
              <p className="font-semibold text-gray-900">{devis.client_nom ?? '—'}</p>
            </div>
          </div>

          {/* Objet */}
          {devis.travaux_description && (
            <div className="px-6 py-4 border-b border-gray-100">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Objet</p>
              <p className="text-gray-700">{devis.travaux_description}</p>
            </div>
          )}

          {/* Lignes — floutées tant que le devis n'est pas payé */}
          <div className="relative">
            <div
              className={`overflow-x-auto transition ${
                !isPaid ? 'blur-sm select-none pointer-events-none' : ''
              }`}
              aria-hidden={!isPaid}
            >
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <th className="px-6 py-3 text-left">Description</th>
                    <th className="px-4 py-3 text-center">Qté</th>
                    <th className="px-4 py-3 text-center">Unité</th>
                    <th className="px-4 py-3 text-right">PU HT</th>
                    <th className="px-6 py-3 text-right">Total HT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {devis.lignes_json.map((ligne, i) => (
                    <tr key={i} className="hover:bg-gray-50/50">
                      <td className="px-6 py-4 text-gray-900">{ligne.description}</td>
                      <td className="px-4 py-4 text-center text-gray-600">{ligne.quantite}</td>
                      <td className="px-4 py-4 text-center text-gray-600">{ligne.unite}</td>
                      <td className="px-4 py-4 text-right text-gray-600">{fmt(ligne.prix_unitaire)}</td>
                      <td className="px-6 py-4 text-right font-semibold text-gray-900">{fmt(ligne.total_ht)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Overlay cadenas — masque le détail tant que !isPaid */}
            {!isPaid && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/30">
                <div className="bg-white rounded-xl shadow-lg border border-gray-100 px-6 py-5 text-center max-w-xs mx-4">
                  <div className="text-3xl mb-2">🔒</div>
                  <p className="font-bold text-gray-900">Détail du devis verrouillé</p>
                  <p className="text-gray-500 text-sm mt-1">
                    {devis.lignes_json.length} poste{devis.lignes_json.length > 1 ? 's' : ''} · Total
                    visible ci-dessous
                  </p>
                  <p className="text-brand text-sm font-semibold mt-2">
                    Payez 2.90 CHF pour débloquer le détail et le PDF
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Totaux — détail HT/TVA masqué tant que !isPaid, TTC toujours visible */}
          <div className="border-t border-gray-100 px-6 py-4 space-y-2">
            {isPaid ? (
              <>
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Sous-total HT</span>
                  <span>{fmt(devis.montant_ht)}</span>
                </div>
                <div className="flex justify-between text-sm text-gray-600">
                  <span>TVA {devis.tva}%</span>
                  <span>{fmt(Math.round(devis.montant_ht * devis.tva / 100 * 100) / 100)}</span>
                </div>
              </>
            ) : (
              <div className="flex justify-between text-sm text-gray-400 italic">
                <span>Détail HT / TVA</span>
                <span>🔒 après paiement</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-lg text-gray-900 pt-2 border-t border-gray-100">
              <span>TOTAL TTC</span>
              <span className="text-brand">{fmt(devis.montant_ttc)}</span>
            </div>
          </div>
        </div>

        {/* Zone paiement */}
        {!isPaid && !isExpired && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">
            <h2 className="font-bold text-gray-900 text-lg">Télécharger le PDF — 2.90 CHF</h2>

            {/* Profil artisan — affiché seulement si incomplet */}
            {profileIncomplet && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-3">
                <p className="text-sm font-semibold text-blue-800">
                  Complétez votre profil — apparaîtra sur tous vos PDFs
                </p>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Nom / Entreprise <span className="text-blue-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={artisanNom}
                      onChange={(e) => setArtisanNom(e.target.value)}
                      placeholder="Plomberie Dupont"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Email pro</label>
                    <input
                      type="email"
                      value={artisanEmail}
                      onChange={(e) => setArtisanEmail(e.target.value)}
                      placeholder="contact@plomberie-dupont.ch"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Téléphone</label>
                    <input
                      type="tel"
                      value={artisanTel}
                      onChange={(e) => setArtisanTel(e.target.value)}
                      placeholder="+41 79 123 45 67"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Adresse</label>
                    <input
                      type="text"
                      value={artisanAdresse}
                      onChange={(e) => setArtisanAdresse(e.target.value)}
                      placeholder="Rue des Artisans 12, 1201 Genève"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Email client */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email de votre client pour recevoir le PDF (optionnel)
              </label>
              <input
                type="email"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                placeholder="client@exemple.com"
                className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
              />
            </div>

            <button
              onClick={handlePay}
              disabled={isPending}
              className="w-full bg-brand hover:bg-brand-dark text-white font-semibold py-3.5 rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {isPending ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  Redirection...
                </>
              ) : (
                <>💳 Payer 2.90 CHF et télécharger</>
              )}
            </button>

            <p className="text-xs text-gray-400 text-center">
              Paiement sécurisé par Stripe · CB, Apple Pay, Google Pay
            </p>
          </div>
        )}

        <p className="text-center text-xs text-gray-400 mt-6">
          Généré par DevisVocal — SnapSolution
        </p>
      </div>
    </main>
  );
}
