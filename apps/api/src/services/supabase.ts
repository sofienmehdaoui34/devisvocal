import { createClient } from '@supabase/supabase-js';
import type { Artisan, Session, Devis, SessionState, SessionContext, LigneDevis, DevisStatut } from '@devisvocal/types';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export { supabase };

// ─── Artisans ────────────────────────────────────────────────────────────────

export async function findOrCreateArtisan(whatsappNumber: string): Promise<Artisan> {
  const { data, error } = await supabase
    .from('artisans')
    .select('*')
    .eq('whatsapp_number', whatsappNumber)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  if (data) return data as Artisan;

  const { data: created, error: createErr } = await supabase
    .from('artisans')
    .insert({ whatsapp_number: whatsappNumber })
    .select()
    .single();

  if (createErr) throw createErr;
  return created as Artisan;
}

export async function updateArtisan(id: string, patch: Partial<Artisan>): Promise<void> {
  const { error } = await supabase.from('artisans').update(patch).eq('id', id);
  if (error) throw error;
}

export async function getArtisanById(id: string): Promise<Artisan | null> {
  const { data, error } = await supabase
    .from('artisans')
    .select('*')
    .eq('id', id)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return (data as Artisan) ?? null;
}

export async function getArtisanByStripeCustomer(customerId: string): Promise<Artisan | null> {
  const { data, error } = await supabase
    .from('artisans')
    .select('*')
    .eq('stripe_customer_id', customerId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return (data as Artisan) ?? null;
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export async function getActiveSession(whatsappNumber: string): Promise<Session | null> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('whatsapp_number', whatsappNumber)
    .not('state', 'eq', 'COMPLETED')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return (data as Session) ?? null;
}

export async function createSession(whatsappNumber: string, artisanId?: string): Promise<Session> {
  const { data, error } = await supabase
    .from('sessions')
    .insert({ whatsapp_number: whatsappNumber, artisan_id: artisanId, state: 'NEW', context: {} })
    .select()
    .single();

  if (error) throw error;
  return data as Session;
}

export async function updateSession(
  id: string,
  state: SessionState,
  context: SessionContext
): Promise<void> {
  const { error } = await supabase.from('sessions').update({ state, context }).eq('id', id);
  if (error) throw error;
}

export async function completeSession(id: string): Promise<void> {
  const { error } = await supabase.from('sessions').update({ state: 'COMPLETED' }).eq('id', id);
  if (error) throw error;
}

// ─── Devis ────────────────────────────────────────────────────────────────────

export async function createDevis(params: {
  artisanId: string;
  token: string;
  clientNom?: string;
  clientEmail?: string;
  travauxDescription: string;
  lignes: LigneDevis[];
  montantHt: number;
  tva: number;
  montantTtc: number;
}): Promise<Devis> {
  const { data, error } = await supabase
    .from('devis')
    .insert({
      artisan_id: params.artisanId,
      numero: '',
      token: params.token,
      client_nom: params.clientNom,
      client_email: params.clientEmail,
      travaux_description: params.travauxDescription,
      lignes_json: params.lignes,
      montant_ht: params.montantHt,
      tva: params.tva,
      montant_ttc: params.montantTtc,
      statut: 'brouillon',
    })
    .select()
    .single();

  if (error) throw error;
  return data as Devis;
}

export async function getDevisByToken(token: string): Promise<Devis | null> {
  const { data, error } = await supabase
    .from('devis')
    .select('*')
    .eq('token', token)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return (data as Devis) ?? null;
}

export async function getDevisByStripeSession(sessionId: string): Promise<Devis | null> {
  // On cherche dans la table paiements
  const { data, error } = await supabase
    .from('paiements')
    .select('devis_id')
    .eq('stripe_payment_id', sessionId)
    .single();
  if (error || !data) return null;

  return getDevisById(data.devis_id);
}

export async function getDevisById(id: string): Promise<Devis | null> {
  const { data, error } = await supabase
    .from('devis')
    .select('*')
    .eq('id', id)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return (data as Devis) ?? null;
}

export async function updateDevisStatut(
  id: string,
  statut: DevisStatut,
  patch?: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase
    .from('devis')
    .update({ statut, ...patch })
    .eq('id', id);
  if (error) throw error;
}

export async function savePaiement(
  devisId: string,
  stripePaymentId: string,
  montant: number
): Promise<void> {
  const { error } = await supabase.from('paiements').insert({
    devis_id: devisId,
    stripe_payment_id: stripePaymentId,
    montant,
    statut: 'succeeded',
  });
  if (error) throw error;
}

export async function incrementDevisCount(artisanId: string): Promise<void> {
  const artisan = await getArtisanById(artisanId);
  if (!artisan) return;
  await updateArtisan(artisanId, { devis_count: (artisan.devis_count ?? 0) + 1 });
}

// ─── Supabase Storage (PDF) ───────────────────────────────────────────────────

export async function uploadPdf(devisId: string, pdfBuffer: Buffer): Promise<string> {
  const fileName = `devis/${devisId}.pdf`;
  const { error } = await supabase.storage
    .from('pdfs')
    .upload(fileName, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (error) throw error;

  const { data } = supabase.storage.from('pdfs').getPublicUrl(fileName);
  return data.publicUrl;
}
