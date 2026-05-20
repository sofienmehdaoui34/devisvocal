import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DevisVocal — SnapSolution',
  description: 'Votre devis professionnel en quelques minutes',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="bg-gray-50 min-h-screen">{children}</body>
    </html>
  );
}
