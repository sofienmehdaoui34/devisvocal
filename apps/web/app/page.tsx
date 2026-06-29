export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 text-center">
      <div className="max-w-md">
        <div className="w-16 h-16 bg-brand rounded-2xl flex items-center justify-center mx-auto mb-6">
          <span className="text-white text-3xl">📋</span>
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-3">DevisVocal</h1>
        <p className="text-gray-500 mb-8">
          Générez vos devis professionnels en quelques minutes via WhatsApp.
        </p>
        <a
          href="https://wa.me/41XXXXXXXXX"
          className="inline-flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white font-semibold px-6 py-3 rounded-xl transition-colors"
        >
          <span>💬</span> Démarrer sur WhatsApp
        </a>
        <p className="mt-6 text-sm text-gray-500">
          Déjà client ?{' '}
          <a href="/login" className="text-brand font-semibold hover:underline">
            Accéder à mon espace
          </a>
        </p>
        <p className="text-xs text-gray-400 mt-4">SnapSolution · devisvocal.ch</p>
      </div>
    </main>
  );
}
