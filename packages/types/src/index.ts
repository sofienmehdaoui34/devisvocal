// ─── Métiers ─────────────────────────────────────────────────────────────────

export type Metier =
  | 'plombier'
  | 'electricien'
  | 'carreleur'
  | 'peintre'
  | 'macon'
  | 'garagiste'
  | 'paysagiste'
  | 'nettoyage'
  | 'demenageur'
  | 'menuisier'
  | 'cuisiniste'
  | 'autre';

// ─── Session (état de la conversation WhatsApp) ───────────────────────────────

export type SessionState =
  | 'NEW'                 // Premier contact
  | 'MODE_CHOICE'         // Question discriminante envoyée, attente 1 ou 2
  | 'RAPIDE_COLLECTING'   // Tunnel rapide : collecte description + montant
  | 'ASSISTE_COLLECTING'  // Tunnel assisté : description libre → Claude extrait
  | 'CLARIFYING'          // Questions de clarification (max 2 rounds, tunnel assisté)
  | 'RECAP_SENT'          // Récap envoyé, attente OUI/NON
  | 'AWAITING_PAYMENT'    // Lien paiement envoyé
  | 'COMPLETED'           // PDF livré
  // Legacy (compatibilité ascendante)
  | 'ONBOARDING'
  | 'COLLECTING'
  | 'EXTRACTING';

export interface SessionContext {
  // Devise et TVA détectées depuis le numéro de téléphone
  devise?: 'CHF' | 'EUR';
  tva?: number;

  // Tunnel choisi
  mode?: 'rapide' | 'assiste';

  // Tunnel RAPIDE
  rapide_step?: 'description' | 'montant';
  rapide_description?: string;
  rapide_montant_ttc?: number;

  // Tunnel ASSISTÉ
  description_brute?: string;
  clarification_round?: number;
  questions_restantes?: string[];
  question_index?: number;
  reponses_clarification?: Record<string, string>;

  // Devis en cours d'extraction
  devis_partiel?: unknown;

  // Client lié au devis
  client_id?: string;
  client_nom?: string;
  client_email?: string;
  client_telephone?: string;
  client_adresse?: string;

  // Devis finalisé
  devis_id?: string;
  devis_token?: string;
  stripe_url?: string;
}

// ─── Artisan ──────────────────────────────────────────────────────────────────

export type SubscriptionStatus = 'free' | 'active' | 'cancelled' | 'past_due';

export interface Artisan {
  id: string;
  whatsapp_number: string;
  nom_entreprise?: string;
  siret?: string;
  adresse?: string;
  telephone?: string;
  activite?: string;
  metier?: Metier;
  email?: string;
  subscription_status: SubscriptionStatus;
  devis_count: number;
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  created_at: string;
  updated_at: string;
}

// ─── Session DB ───────────────────────────────────────────────────────────────

export interface Session {
  id: string;
  artisan_id?: string;
  whatsapp_number: string;
  state: SessionState;
  context: SessionContext;
  created_at: string;
  updated_at: string;
}

// ─── Devis ────────────────────────────────────────────────────────────────────

export type DevisStatut =
  | 'brouillon'
  | 'en_attente_paiement'
  | 'payé'
  | 'envoyé';

export interface LigneDevis {
  description: string;
  quantite: number;
  unite: string;       // 'h', 'm²', 'forfait', 'pcs', 'm', 'kg', etc.
  prix_unitaire: number;
  total_ht: number;
}

export interface Devis {
  id: string;
  artisan_id: string;
  numero: string;
  token: string;
  client_nom?: string;
  client_email?: string;
  client_adresse?: string;
  client_telephone?: string;
  travaux_description?: string;
  lignes_json: LigneDevis[];
  montant_ht: number;
  tva: number;
  montant_ttc: number;
  statut: DevisStatut;
  pdf_url?: string;
  expires_at: string;
  created_at: string;
  paid_at?: string;
  delivered_at?: string;
}

// ─── Paiement ─────────────────────────────────────────────────────────────────

export interface Paiement {
  id: string;
  devis_id: string;
  stripe_payment_id: string;
  montant: number;
  statut: 'pending' | 'succeeded' | 'failed' | 'refunded';
  created_at: string;
}

// ─── Messages WhatsApp ────────────────────────────────────────────────────────

export type WhatsAppMessageType = 'text' | 'audio' | 'image' | 'document';

export interface WhatsAppInboundMessage {
  from: string;         // numéro E.164
  message_id: string;
  type: WhatsAppMessageType;
  text?: string;
  audio_url?: string;
  audio_mime?: string;
  timestamp: number;
}

// ─── Résultat extraction Claude ───────────────────────────────────────────────

export interface ExtractionResult {
  lignes: LigneDevis[];
  client_nom?: string;
  client_adresse?: string;
  description_travaux: string;
  date_debut_estimee?: string;
  delai_execution?: string;
  notes?: string;
  questions_manquantes: string[];
  confiance: 'haute' | 'moyenne' | 'faible';
}

// ─── Client ───────────────────────────────────────────────────────────────────

export interface Client {
  id: string;
  artisan_id: string;
  nom?: string;
  email?: string;
  telephone?: string;
  adresse?: string;
  type_chantier?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

// ─── Résultat recherche entreprise ───────────────────────────────────────────

export interface EntrepriseInfo {
  nom: string;
  siret?: string;
  adresse?: string;
  activite?: string;
  telephone?: string;
  source: 'google_maps' | 'sirene' | 'manual';
}
