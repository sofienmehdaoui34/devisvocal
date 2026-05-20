'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';

export default function SuccessPage() {
  const { token } = useParams<{ token: string }>();

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow p-10 max-w-md text-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <span className="text-4xl">✅</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Paiement confirmé !</h1>
        <p className="text-gray-500 mb-6">
          Votre devis PDF est en cours de génération.
          Vous le recevrez par WhatsApp et par email dans quelques secondes.
        </p>
        <Link
          href={`/devis/${token}`}
          className="text-brand font-medium text-sm hover:underline"
        >
          ← Voir le devis
        </Link>
        <p className="text-xs text-gray-400 mt-8">DevisVocal — SnapSolution</p>
      </div>
    </main>
  );
}
