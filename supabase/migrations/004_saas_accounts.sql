-- ─── Espace client SaaS — Phase A (Jalon R1) ─────────────────────────────────
-- 1) Table `clients` (référencée par le code mais jamais créée → bug latent :
--    la sauvegarde du carnet client échouait en silence). Idempotent.
create table if not exists clients (
  id             uuid primary key default uuid_generate_v4(),
  artisan_id     uuid not null references artisans(id) on delete cascade,
  nom            text,
  email          text,
  telephone      text,
  adresse        text,
  type_chantier  text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_clients_artisan on clients(artisan_id);

drop trigger if exists clients_updated_at on clients;
create trigger clients_updated_at before update on clients
  for each row execute function set_updated_at();

alter table clients disable row level security;

-- 2) Rattachement d'un compte web (Supabase Auth) à une fiche artisan.
--    auth_user_id = id du user Supabase Auth ; le téléphone reste la clé de
--    rattachement (vérifié par un code envoyé via le bot).
alter table artisans add column if not exists auth_user_id uuid unique;
alter table artisans add column if not exists link_code text;
alter table artisans add column if not exists link_code_expires timestamptz;
