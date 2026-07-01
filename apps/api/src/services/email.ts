import { Resend } from 'resend';
import type { Devis, Artisan } from '@devisvocal/types';
import { escapeHtml } from '@devisvocal/pdf';
import { safeError } from '../utils/errors.js';

// Lazy init — retourne null si la clé n'est pas configurée
let _resend: Resend | null = null;
const getResend = (): Resend | null => {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('[email] RESEND_API_KEY manquant — envoi email désactivé');
    return null;
  }
  _resend = new Resend(key);
  return _resend;
};

// Expéditeur : par défaut le domaine de test Resend (marche sans vérif DNS).
// Pour la prod, définir EMAIL_FROM avec un domaine vérifié sur Resend.
const FROM = `${process.env.EMAIL_FROM_NAME ?? 'DevisVocal'} <${process.env.EMAIL_FROM ?? 'onboarding@resend.dev'}>`;

export async function sendDevisEmail(params: {
  devis: Devis;
  artisan: Artisan;
  pdfBuffer: Buffer;
  recipientEmail: string;
  isArtisan: boolean;
}): Promise<void> {
  const { devis, artisan, pdfBuffer, recipientEmail, isArtisan } = params;
  const subject = isArtisan
    ? `✅ Votre devis ${devis.numero} est disponible`
    : `Devis ${devis.numero} — ${artisan.nom_entreprise}`;

  const body = isArtisan
    ? artisanEmailHtml(devis, artisan)
    : clientEmailHtml(devis, artisan);

  const resend = getResend();
  if (!resend) return; // Email désactivé si pas de clé Resend

  try {
    const { data, error } = await resend.emails.send({
      from: FROM,
      to: recipientEmail,
      subject,
      html: body,
      attachments: [
        {
          filename: `${devis.numero}.pdf`,
          content: pdfBuffer,
        },
      ],
    });
    if (error) {
      console.error('[email] Resend a refusé l\'envoi:', JSON.stringify(error));
    } else {
      console.log(`[email] envoyé à ${recipientEmail} (id=${data?.id}) pour devis ${devis.numero}`);
    }
  } catch (err) {
    // Non-bloquant : on log mais on ne fait pas planter la livraison du PDF
    console.error('[email] sendDevisEmail exception:', safeError(err));
  }
}

function artisanEmailHtml(devis: Devis, artisan: Artisan): string {
  return `
<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>body{font-family:Arial,sans-serif;color:#111;max-width:600px;margin:0 auto;padding:20px}
.header{background:#1a56db;color:#fff;padding:24px;border-radius:8px 8px 0 0}
.body{padding:24px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:0 0 8px 8px}
.badge{background:#d1fae5;color:#065f46;padding:4px 12px;border-radius:99px;font-size:12px;font-weight:600;display:inline-block;margin-bottom:16px}
.footer{color:#9ca3af;font-size:11px;margin-top:24px;text-align:center}</style>
</head><body>
<div class="header">
  <h2 style="margin:0">DevisVocal — SnapSolution</h2>
</div>
<div class="body">
  <div class="badge">✅ Devis payé</div>
  <h3>Bonjour ${escapeHtml(artisan.nom_entreprise ?? '')} !</h3>
  <p>Votre devis <strong>${escapeHtml(devis.numero)}</strong> a été payé et généré avec succès.</p>
  <p>Vous trouverez le PDF en pièce jointe à cet email.</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
  <p><strong>Montant HT :</strong> CHF ${devis.montant_ht.toFixed(2)}</p>
  <p><strong>Montant TTC :</strong> CHF ${devis.montant_ttc.toFixed(2)}</p>
  <p><strong>Client :</strong> ${escapeHtml(devis.client_nom ?? 'Non renseigné')}</p>
  <div class="footer">DevisVocal by SnapSolution — devisvocal.ch</div>
</div>
</body></html>`;
}

function clientEmailHtml(devis: Devis, artisan: Artisan): string {
  return `
<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>body{font-family:Arial,sans-serif;color:#111;max-width:600px;margin:0 auto;padding:20px}
.header{background:#1a56db;color:#fff;padding:24px;border-radius:8px 8px 0 0}
.body{padding:24px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:0 0 8px 8px}
.footer{color:#9ca3af;font-size:11px;margin-top:24px;text-align:center}</style>
</head><body>
<div class="header">
  <h2 style="margin:0">Devis de ${escapeHtml(artisan.nom_entreprise ?? 'votre prestataire')}</h2>
</div>
<div class="body">
  <p>Bonjour ${escapeHtml(devis.client_nom ?? '')},</p>
  <p>Veuillez trouver ci-joint votre devis <strong>${escapeHtml(devis.numero)}</strong>.</p>
  <p>N'hésitez pas à contacter votre prestataire pour toute question.</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
  <p><strong>Montant TTC :</strong> CHF ${devis.montant_ttc.toFixed(2)}</p>
  <p><strong>Valable :</strong> 30 jours à compter de l'émission</p>
  <div class="footer">Devis généré via DevisVocal by SnapSolution</div>
</div>
</body></html>`;
}
