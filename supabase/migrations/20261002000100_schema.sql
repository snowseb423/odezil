-- EauPartagée — schéma de base.
-- Montants en centimes de roupie (integer), dates en type `date`.
-- Foyer A = Macoua (admin), foyer B = Cardinal (beaux-parents).

create type public.variance_treatment as enum (
  'pending',
  'impute_to_a',
  'impute_to_b',
  'split_50_50'
);

-- Adresses autorisées à administrer l'application (utilisée par is_admin()).
-- Alimentée par `npm run seed:admin` à partir de ADMIN_EMAIL, jamais via l'API.
create table public.admin_allowlist (
  email text primary key,
  created_at timestamptz not null default now(),
  constraint admin_allowlist_email_lowercase check (email = lower(email)),
  constraint admin_allowlist_email_format check (email like '_%@_%')
);

-- Prix unitaire d'une bonbonne avec date d'effet.
create table public.price_settings (
  id uuid primary key default gen_random_uuid(),
  unit_price_cents integer not null,
  effective_from date not null,
  created_at timestamptz not null default now(),
  constraint price_settings_unit_price_positive check (unit_price_cents > 0),
  constraint price_settings_effective_from_unique unique (effective_from)
);

-- Prix initial : Rs 240 TTC, en vigueur pour toute livraison.
insert into public.price_settings (unit_price_cents, effective_from)
values (24000, '2000-01-01');

-- Livraisons, d'après le bon de livraison manuscrit (source de vérité).
create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  delivery_date date not null,
  bottles_a integer not null,
  bottles_b integer not null,
  -- Figé à l'insertion par trigger d'après le prix en vigueur à delivery_date.
  unit_price_cents_applied integer not null,
  photo_path text,
  note text,
  created_at timestamptz not null default now(),
  constraint deliveries_bottles_a_non_negative check (bottles_a >= 0),
  constraint deliveries_bottles_b_non_negative check (bottles_b >= 0),
  constraint deliveries_bottles_positive check (bottles_a + bottles_b > 0),
  constraint deliveries_unit_price_positive check (unit_price_cents_applied > 0)
);

create index deliveries_delivery_date_idx on public.deliveries (delivery_date);

-- Fixe le prix appliqué : dernier prix dont effective_from <= delivery_date.
-- Toute valeur envoyée par le client est ignorée.
-- `security invoker` (volontaire) : la recherche se fait avec les droits de
-- l'appelant. L'admin voit tous les prix ; un compte non autorisé n'en voit
-- aucun et reçoit toujours la même erreur, quelle que soit la date (pas
-- d'oracle sur les dates d'effet). postgres et service_role voient tout.
create function public.deliveries_freeze_unit_price()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_price integer;
begin
  select p.unit_price_cents
    into v_price
    from public.price_settings p
   where p.effective_from <= new.delivery_date
   order by p.effective_from desc
   limit 1;

  if v_price is null then
    raise exception 'Aucun prix unitaire en vigueur au %', new.delivery_date
      using errcode = 'P0001';
  end if;

  new.unit_price_cents_applied := v_price;
  return new;
end;
$$;

create trigger deliveries_freeze_unit_price
before insert on public.deliveries
for each row execute function public.deliveries_freeze_unit_price();

-- Relevés mensuels Odezil (SOA) : total seul, servant au rapprochement.
create table public.soa_statements (
  id uuid primary key default gen_random_uuid(),
  month date not null,
  total_billed_cents integer not null,
  -- total SOA − total attendu des livraisons du mois, figé à l'enregistrement.
  variance_cents integer not null,
  variance_treatment public.variance_treatment not null default 'pending',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint soa_statements_month_unique unique (month),
  constraint soa_statements_month_first_day check (extract(day from month) = 1),
  constraint soa_statements_total_non_negative check (total_billed_cents >= 0)
);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger soa_statements_set_updated_at
before update on public.soa_statements
for each row execute function public.set_updated_at();

-- Remboursements reçus du foyer Cardinal (hors app).
create table public.repayments (
  id uuid primary key default gen_random_uuid(),
  repayment_date date not null,
  amount_cents integer not null,
  note text,
  created_at timestamptz not null default now(),
  constraint repayments_amount_positive check (amount_cents > 0)
);

create index repayments_repayment_date_idx on public.repayments (repayment_date);

-- Liens privés de la page Cardinal : seul le hash du token est stocké.
create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint share_links_token_hash_unique unique (token_hash),
  constraint share_links_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$')
);

-- Un seul lien actif à la fois.
create unique index share_links_single_active
  on public.share_links ((revoked_at is null))
  where revoked_at is null;

-- Une révocation est définitive : revoked_at ne peut plus changer ensuite.
create function public.share_links_revocation_is_final()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'Un lien révoqué ne peut pas être réactivé'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger share_links_revocation_is_final
before update on public.share_links
for each row execute function public.share_links_revocation_is_final();

-- Il reste toujours au moins un prix (sinon plus aucune livraison ne peut être saisie).
-- `security definer` : le contrôle porte sur toute la table, quel que soit l'appelant.
create function public.price_settings_keep_one()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.price_settings) then
    raise exception 'Impossible de supprimer le dernier prix unitaire'
      using errcode = 'P0001';
  end if;
  return null;
end;
$$;

create trigger price_settings_keep_one
after delete on public.price_settings
for each statement execute function public.price_settings_keep_one();
