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
  | 'NEW'              // Premier contact
  | 'ONBOARDING'       // Collecte nom entreprise, SIRET, email, métier
  | 'COLLECTING'       // L'artisan décrit le travail
  | 'EXTRACTING'       // Claude traite le texte (état transitoire)
  | 'CLARIFYING'       // Questions de clarification (max 2 rounds)
  | 'RECAP_SENT'       // Récap envoyé, attente confirmation artisan
  | 'AWAITING_PAYMENT' // Lien Stripe envoyé
  | 'COMPLETED';       // Payé et PDF livré

export interface SessionContext {
  // onboarding
  onboarding_step?: 'nom' | 'siret_confirm' | 'siret_manual' | 'email' | 'done';
  nom_recherche?: string;     // nom tapé pour Google Maps
  entreprise_suggeree?: {     // trouvée via Google Maps / Sirene
    nom: string;
    siret?: string;
    adresse?: string;
    activite?: string;
  };

  // devis en cours
  description_brute?: string;
  clarification_round?: number;     // 0, 1 ou 2 (max 2 allers-retours)
  questions_restantes?: string[];
  question_index?: number;
  reponses_clarification?: Record<string, string>;

  // devis finalisé
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

// ─── Résultat recherche entreprise ───────────────────────────────────────────

export interface EntrepriseInfo {
  nom: string;
  siret?: string;
  adresse?: string;
  activite?: string;
  telephone?: string;
  source: 'google_maps' | 'sirene' | 'manual';
}
