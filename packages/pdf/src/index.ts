import puppeteer from 'puppeteer';
import type { Devis, Artisan, LigneDevis } from '@devisvocal/types';

const fmt = (n: number) =>
  `CHF ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, "'")}`;

function buildHtml(devis: Devis, artisan: Artisan): string {
  const dateEmission = new Date(devis.created_at).toLocaleDateString('fr-CH');
  const dateValidite = new Date(new Date(devis.created_at).getTime() + 30 * 86400000).toLocaleDateString('fr-CH');

  const lignesHtml = devis.lignes_json
    .map(
      (l: LigneDevis, i: number) => `
      <tr class="${i % 2 === 0 ? 'even' : 'odd'}">
        <td class="desc">${l.description}</td>
        <td class="center">${l.quantite}</td>
        <td class="center">${l.unite}</td>
        <td class="right">${fmt(l.prix_unitaire)}</td>
        <td class="right bold">${fmt(l.total_ht)}</td>
      </tr>`
    )
    .join('');

  const tvaLabel = `TVA ${devis.tva}%`;
  const sousTotal = devis.montant_ht;
  const tvaMontant = Math.round((sousTotal * devis.tva) / 100 * 100) / 100;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 11px; color: #111827; background: #fff; padding: 40px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
  .company-name { font-size: 22px; font-weight: 700; color: #1a56db; }
  .company-info { color: #6b7280; font-size: 10px; margin-top: 4px; }
  .devis-title { text-align: right; }
  .devis-title h1 { font-size: 20px; font-weight: 700; color: #111827; letter-spacing: 2px; }
  .devis-title .numero { color: #6b7280; font-size: 12px; margin-top: 2px; }
  .devis-title .date { color: #6b7280; font-size: 10px; margin-top: 2px; }
  .divider { border: none; border-top: 1px solid #e5e7eb; margin: 0 0 24px 0; }
  .parties { display: flex; justify-content: space-between; margin-bottom: 32px; }
  .partie { width: 48%; }
  .partie-label { font-size: 8px; font-weight: 700; color: #6b7280; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 8px; }
  .partie-name { font-size: 12px; font-weight: 700; color: #111827; margin-bottom: 2px; }
  .partie-detail { color: #4b5563; font-size: 10px; line-height: 1.5; }
  .section-label { font-size: 8px; font-weight: 700; color: #6b7280; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 8px; }
  .travaux-desc { color: #111827; font-size: 11px; margin-bottom: 24px; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  thead tr { background: #1a56db; color: #fff; }
  thead th { padding: 8px 6px; font-size: 9px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; }
  th.desc, td.desc { text-align: left; width: 45%; padding-left: 10px; }
  th.center, td.center { text-align: center; width: 10%; }
  th.right, td.right { text-align: right; width: 17%; padding-right: 10px; }
  td { padding: 7px 6px; }
  tr.even { background: #fff; }
  tr.odd { background: #f9fafb; }
  .bold { font-weight: 600; }
  .totals { display: flex; justify-content: flex-end; margin-top: 8px; }
  .totals-table { width: 280px; }
  .totals-table tr td { padding: 4px 0; }
  .totals-table .label { color: #6b7280; text-align: right; padding-right: 16px; font-size: 10px; }
  .totals-table .value { text-align: right; font-size: 10px; min-width: 90px; }
  .totals-table .total-row td { border-top: 1px solid #e5e7eb; padding-top: 8px; font-weight: 700; font-size: 12px; color: #111827; }
  .notes { margin-top: 24px; }
  .notes-content { font-size: 10px; color: #4b5563; line-height: 1.5; background: #f9fafb; border-left: 3px solid #1a56db; padding: 10px 14px; border-radius: 2px; }
  .footer { position: fixed; bottom: 24px; left: 40px; right: 40px; border-top: 1px solid #e5e7eb; padding-top: 10px; display: flex; justify-content: space-between; color: #9ca3af; font-size: 9px; }
</style>
</head>
<body>

<div class="header">
  <div>
    <div class="company-name">${artisan.nom_entreprise ?? 'Mon Entreprise'}</div>
    <div class="company-info">
      ${artisan.adresse ?? ''}<br>
      ${artisan.email ?? ''}<br>
      ${artisan.siret ? `SIRET : ${artisan.siret}` : ''}
    </div>
  </div>
  <div class="devis-title">
    <h1>DEVIS</h1>
    <div class="numero">${devis.numero}</div>
    <div class="date">Émis le ${dateEmission}</div>
    <div class="date">Valable jusqu'au ${dateValidite}</div>
  </div>
</div>

<hr class="divider">

<div class="parties">
  <div class="partie">
    <div class="partie-label">Prestataire</div>
    <div class="partie-name">${artisan.nom_entreprise ?? ''}</div>
    <div class="partie-detail">${artisan.adresse ?? ''}</div>
  </div>
  <div class="partie">
    <div class="partie-label">Client</div>
    <div class="partie-name">${devis.client_nom ?? 'À compléter'}</div>
    <div class="partie-detail">${devis.client_email ?? ''}</div>
  </div>
</div>

${devis.travaux_description ? `
<div class="section-label">Objet du devis</div>
<div class="travaux-desc">${devis.travaux_description}</div>
` : ''}

<table>
  <thead>
    <tr>
      <th class="desc">Description</th>
      <th class="center">Qté</th>
      <th class="center">Unité</th>
      <th class="right">Prix unit. HT</th>
      <th class="right">Total HT</th>
    </tr>
  </thead>
  <tbody>
    ${lignesHtml}
  </tbody>
</table>

<div class="totals">
  <table class="totals-table">
    <tr>
      <td class="label">Sous-total HT</td>
      <td class="value">${fmt(sousTotal)}</td>
    </tr>
    <tr>
      <td class="label">${tvaLabel}</td>
      <td class="value">${fmt(tvaMontant)}</td>
    </tr>
    <tr class="total-row">
      <td class="label">TOTAL TTC</td>
      <td class="value">${fmt(devis.montant_ttc)}</td>
    </tr>
  </table>
</div>

<div class="notes">
  <div class="section-label">Conditions</div>
  <div class="notes-content">
    Ce devis est valable 30 jours à compter de la date d'émission.
    Toute commande implique l'acceptation de ces conditions.
    Paiement à 30 jours fin de mois.
  </div>
</div>

<div class="footer">
  <span>Généré par DevisVocal — SnapSolution</span>
  <span>${devis.numero} · ${dateEmission}</span>
</div>

</body>
</html>`;
}

export async function generateDevisPdf(devis: Devis, artisan: Artisan): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(buildHtml(devis, artisan), { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
