-- ─── Champs indispensables d'un devis ────────────────────────────────────────
-- Colonnes manquantes pour stocker les coordonnées complètes prestataire/client.

-- Téléphone du prestataire (apparaît sur le PDF, manquait à la table artisans)
alter table artisans add column if not exists telephone text;

-- Adresse du client (élément obligatoire d'un devis, manquait à la table devis)
alter table devis add column if not exists client_adresse text;

-- Téléphone du client (au cas où la colonne n'existe pas déjà en prod)
alter table devis add column if not exists client_telephone text;
