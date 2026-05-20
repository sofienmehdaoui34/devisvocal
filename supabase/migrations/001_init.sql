-- ─── Extensions ─────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ─── Artisans ────────────────────────────────────────────────────────────────
create table artisans (
  id                    uuid primary key default uuid_generate_v4(),
  whatsapp_number       text not null unique,
  nom_entreprise        text,
  siret                 text,
  adresse               text,
  activite              text,
  metier                text,
  email                 text,
  subscription_status   text not null default 'free'
                          check (subscription_status in ('free','active','cancelled','past_due')),
  devis_count           int  not null default 0,
  stripe_customer_id    text unique,
  stripe_subscription_id text unique,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ─── Sessions WhatsApp ────────────────────────────────────────────────────────
create table sessions (
  id               uuid primary key default uuid_generate_v4(),
  artisan_id       uuid references artisans(id) on delete set null,
  whatsapp_number  text not null,
  state            text not null default 'NEW'
                     check (state in (
                       'NEW','ONBOARDING','COLLECTING','EXTRACTING',
                       'CLARIFYING','RECAP_SENT','AWAITING_PAYMENT','COMPLETED'
                     )),
  context          jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index idx_sessions_whatsapp on sessions(whatsapp_number);
create index idx_sessions_state    on sessions(state);

-- ─── Devis ────────────────────────────────────────────────────────────────────
create table devis (
  id                          uuid primary key default uuid_generate_v4(),
  artisan_id                  uuid not null references artisans(id) on delete cascade,
  numero                      text not null unique,
  token                       text not null unique,
  client_nom                  text,
  client_email                text,
  travaux_description         text,
  lignes_json                 jsonb not null default '[]',
  montant_ht                  numeric(10,2) not null default 0,
  tva                         numeric(5,2)  not null default 8.1,
  montant_ttc                 numeric(10,2) not null default 0,
  statut                      text not null default 'brouillon'
                                check (statut in (
                                  'brouillon','en_attente_paiement',
                                  'payé','envoyé'
                                )),
  pdf_url                     text,
  expires_at                  timestamptz not null default (now() + interval '24 hours'),
  created_at                  timestamptz not null default now(),
  paid_at                     timestamptz,
  delivered_at                timestamptz
);

create index idx_devis_artisan   on devis(artisan_id);
create index idx_devis_token     on devis(token);
create index idx_devis_statut    on devis(statut);
create index idx_devis_expires   on devis(expires_at);

-- ─── Paiements ───────────────────────────────────────────────────────────────
create table paiements (
  id                  uuid primary key default uuid_generate_v4(),
  devis_id            uuid not null references devis(id) on delete cascade,
  stripe_payment_id   text not null unique,
  montant             numeric(10,2) not null,
  statut              text not null default 'pending'
                        check (statut in ('pending','succeeded','failed','refunded')),
  created_at          timestamptz not null default now()
);

create index idx_paiements_devis on paiements(devis_id);

-- ─── Séquence numéro devis ────────────────────────────────────────────────────
create sequence devis_numero_seq start 1;

create or replace function generate_devis_numero()
returns trigger language plpgsql as $$
begin
  if new.numero is null or new.numero = '' then
    new.numero := 'DV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('devis_numero_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

create trigger set_devis_numero
  before insert on devis
  for each row
  execute function generate_devis_numero();

-- ─── updated_at auto ─────────────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger artisans_updated_at before update on artisans
  for each row execute function set_updated_at();

create trigger sessions_updated_at before update on sessions
  for each row execute function set_updated_at();

-- ─── RLS (désactivé pour MVP — service_role key côté backend) ────────────────
alter table artisans  disable row level security;
alter table sessions  disable row level security;
alter table devis     disable row level security;
alter table paiements disable row level security;
