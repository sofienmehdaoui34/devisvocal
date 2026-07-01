-- ─── Bibliothèque de prix par artisan (Jalon 2) ──────────────────────────────
-- Mémorise les prestations/tarifs habituels d'un artisan pour les réinjecter
-- dans l'extraction des devis suivants (prix cohérents, moins de corrections).
create table prestations (
  id             uuid primary key default uuid_generate_v4(),
  artisan_id     uuid not null references artisans(id) on delete cascade,
  label          text not null,                 -- description normalisée (minuscule, espaces compactés)
  unite          text not null,                 -- h, m², m, m³, pcs, forfait, kg…
  prix_unitaire  numeric(10,2) not null,
  devise         text not null default 'CHF'
                   check (devise in ('CHF','EUR')),
  usage_count    int not null default 1,
  last_used_at   timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (artisan_id, label, unite, devise)
);

create index idx_prestations_artisan on prestations(artisan_id);

-- updated_at auto (réutilise la fonction set_updated_at() définie en 001_init.sql)
create trigger prestations_updated_at before update on prestations
  for each row execute function set_updated_at();

-- RLS désactivé pour MVP (service_role key côté backend), cohérent avec 001.
alter table prestations disable row level security;
