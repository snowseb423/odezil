-- =====================================================================
-- EauPartagée — schéma
--
-- Tables, contrôle d'accès (RLS réservée à l'administrateur via
-- public.is_admin()), garde d'inscription et triggers d'intégrité :
--   - prix unitaire figé à la création d'une livraison ;
--   - remplacement rattaché à une livraison verrouillé ;
--   - invariant d'attribution vérifié au commit (contrainte différée) :
--     bottles_f1 = nombre de remplacements rattachés, tous datés (jour
--     à Maurice) au plus tard le jour de la livraison.
--
-- Montants en centimes de roupie (integer). Identifiants UUID fournis
-- par le client (écritures hors ligne idempotentes).
-- =====================================================================


-- ---------------------------------------------------------------------
-- Aucun droit implicite sur les objets créés par les migrations
-- ---------------------------------------------------------------------

-- EXECUTE accordé à PUBLIC par défaut : ne se retire que globalement.
alter default privileges revoke execute on functions from public;
-- Droits que Supabase accorde par défaut dans public aux rôles de l'API.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;


-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

create table public.admin_allowlist (
  email      text primary key
             constraint admin_allowlist_email_format
             check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  created_at timestamptz not null default now()
);
comment on table public.admin_allowlist is
  'Adresse de l''administrateur. Remplie à la main (README), jamais par une migration.';

create table public.price_settings (
  id               uuid primary key,
  unit_price_cents integer not null
                   constraint price_settings_unit_price_positive check (unit_price_cents > 0),
  effective_from   date not null
                   constraint price_settings_effective_from_key unique,
  created_at       timestamptz not null default now()
);
comment on table public.price_settings is
  'Prix TTC d''une bonbonne (centimes), applicable à partir de effective_from.';

create table public.deliveries (
  id                       uuid primary key,
  delivery_date            date not null,
  -- Total des bonbonnes remplacées par Odezil lors de ce passage.
  bottles_total            integer not null
                           constraint deliveries_bottles_total_range check (bottles_total between 1 and 1000),
  -- Remplacements du Foyer 1 rattachés (figé par l'attribution).
  bottles_f1               integer not null
                           constraint deliveries_bottles_f1_positive check (bottles_f1 >= 0),
  bottles_f2               integer generated always as (bottles_total - bottles_f1) stored
                           constraint deliveries_bottles_f2_positive check (bottles_f2 >= 0),
  -- Figé par trigger d'après le prix en vigueur à delivery_date.
  unit_price_cents_applied integer not null
                           constraint deliveries_unit_price_positive check (unit_price_cents_applied > 0),
  document_path            text,
  note                     text constraint deliveries_note_length check (note is null or char_length(note) <= 500),
  created_at               timestamptz not null default now(),
  constraint deliveries_document_path_format check (
    document_path is null
    or document_path ~ ('^deliveries/' || id::text || '/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$')
  )
);
create index deliveries_delivery_date_idx on public.deliveries (delivery_date);
comment on table public.deliveries is
  'Passages du livreur Odezil. Foyer 2 = bottles_total − bottles_f1 (jamais saisi).';

create table public.replacements (
  id          uuid primary key,
  replaced_at timestamptz not null,
  -- Jour du remplacement à Maurice (UTC+4), jamais en UTC.
  replaced_on date generated always as ((replaced_at at time zone 'Indian/Mauritius')::date) stored,
  note        text constraint replacements_note_length check (note is null or char_length(note) <= 500),
  -- null = en attente ; suppression de la livraison → de nouveau en attente.
  delivery_id uuid references public.deliveries (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index replacements_delivery_id_idx on public.replacements (delivery_id);
create index replacements_pending_idx on public.replacements (replaced_at) where delivery_id is null;
comment on table public.replacements is
  'Journal du Foyer 1 : une ligne = une bonbonne remplacée sur sa fontaine.';

create table public.soa_statements (
  id                  uuid primary key,
  -- Premier jour du mois relevé.
  month               date not null
                      constraint soa_statements_month_key unique
                      constraint soa_statements_month_first_day check (extract(day from month) = 1),
  total_billed_cents  integer not null
                      constraint soa_statements_total_positive check (total_billed_cents >= 0),
  -- Total SOA − total attendu, calculé côté client et figé à l'enregistrement.
  variance_cents      integer not null,
  variance_treatment  text not null default 'pending'
                      constraint soa_statements_variance_treatment
                      check (variance_treatment in ('pending', 'impute_to_f1', 'impute_to_f2', 'split_50_50')),
  -- Part de l'écart imputée au Foyer 2. Division entière : tronquée vers
  -- zéro, le reste revient au Foyer 1 (identique à f2Adjustment() en TS).
  f2_adjustment_cents integer generated always as (
                        case variance_treatment
                          when 'impute_to_f2' then variance_cents
                          when 'split_50_50' then variance_cents / 2
                          else 0
                        end
                      ) stored,
  document_path       text,
  note                text constraint soa_statements_note_length check (note is null or char_length(note) <= 500),
  created_at          timestamptz not null default now(),
  constraint soa_statements_document_path_format check (
    document_path is null
    or (
      document_path ~ '^soa/[0-9]{4}-[0-9]{2}/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$'
      and substr(document_path, 5, 7)
          = lpad(extract(year from month)::integer::text, 4, '0') || '-' || lpad(extract(month from month)::integer::text, 2, '0')
    )
  )
);
comment on table public.soa_statements is
  'Relevés mensuels Odezil (SOA) et traitement de l''écart avec le total attendu.';

create table public.repayments (
  id             uuid primary key,
  repayment_date date not null,
  amount_cents   integer not null
                 constraint repayments_amount_positive check (amount_cents > 0),
  note           text constraint repayments_note_length check (note is null or char_length(note) <= 500),
  created_at     timestamptz not null default now()
);
comment on table public.repayments is 'Remboursements reçus du Foyer 2 (hors application).';

create table public.share_links (
  id         uuid primary key,
  -- SHA-256 (hex) du token ; le token lui-même n'est jamais stocké.
  token_hash text not null
             constraint share_links_token_hash_key unique
             constraint share_links_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
-- Un seul lien actif à la fois.
create unique index share_links_single_active on public.share_links ((true)) where revoked_at is null;
comment on table public.share_links is 'Liens de consultation du Foyer 2 (hash du token uniquement).';


-- ---------------------------------------------------------------------
-- Contrôle d'accès
-- ---------------------------------------------------------------------

-- L'utilisateur du JWT est-il l'administrateur ? Une session Supabase ne
-- prouve rien (n'importe quel compte Google en obtient une) : il faut
--   - l'email du JWT (minuscules) dans admin_allowlist ;
--   - le même email pour le compte auth.uid(), confirmé ;
--   - une session qui n'a pas été ouverte par mot de passe (claim amr),
--     ce qui empêche la prise de contrôle d'un compte pré-créé.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    exists (
      select 1
      from public.admin_allowlist a
      join auth.users u on u.id = auth.uid()
      where a.email = lower(auth.jwt() ->> 'email')
        and lower(u.email) = a.email
        and u.email_confirmed_at is not null
    )
    and not coalesce((auth.jwt() -> 'amr') @> '[{"method": "password"}]'::jsonb, false),
    false
  );
$$;

revoke all on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;

-- Refuse la création de tout compte dont l'adresse n'est pas autorisée
-- (compte Google quelconque, inscription par lien magique…).
create function public.guard_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.admin_allowlist a
    where a.email = lower(btrim(coalesce(new.email, '')))
  ) then
    raise exception 'Adresse non autorisée pour cette application.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_signup() from public, anon, authenticated;

-- Les triggers sur auth.users sont le schéma documenté par Supabase ; si
-- un environnement les interdit, les données restent protégées par la RLS.
do $$
begin
  create trigger eaupartagee_guard_signup
    before insert on auth.users
    for each row execute function public.guard_signup();
exception
  when insufficient_privilege then
    raise notice 'Trigger sur auth.users non autorisé : garde d''inscription désactivée (la RLS protège toujours les données).';
end;
$$;


-- ---------------------------------------------------------------------
-- Prix figé à la création d'une livraison
-- ---------------------------------------------------------------------

-- Prix en vigueur à une date (même règle que priceAt() en TypeScript).
create function public.price_at(p_date date)
returns integer
language sql
stable
set search_path = ''
as $$
  select p.unit_price_cents
  from public.price_settings p
  where p.effective_from <= p_date
  order by p.effective_from desc
  limit 1;
$$;

revoke all on function public.price_at(date) from public, anon, authenticated;
grant execute on function public.price_at(date) to authenticated;

-- Le prix appliqué est calculé ici, jamais fourni par le client. Il ne
-- change plus ensuite, sauf si la date de livraison est corrigée.
create function public.deliveries_freeze_price()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.delivery_date is distinct from old.delivery_date then
    new.unit_price_cents_applied := public.price_at(new.delivery_date);
    if new.unit_price_cents_applied is null then
      raise exception 'Aucun prix unitaire en vigueur au %.', new.delivery_date
        using errcode = '23514';
    end if;
  else
    new.unit_price_cents_applied := old.unit_price_cents_applied;
  end if;
  return new;
end;
$$;

revoke all on function public.deliveries_freeze_price() from public, anon, authenticated;

create trigger deliveries_a_freeze_price
  before insert or update on public.deliveries
  for each row execute function public.deliveries_freeze_price();


-- ---------------------------------------------------------------------
-- Verrou des remplacements rattachés
-- ---------------------------------------------------------------------

-- Un remplacement rattaché à une livraison ne se modifie ni ne se
-- supprime : seul son rattachement (delivery_id) peut changer, par
-- save_delivery() ou par la suppression de la livraison.
create function public.replacements_guard_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.delivery_id is not null then
    if tg_op = 'DELETE' then
      raise exception 'Remplacement rattaché à une livraison : il ne peut pas être supprimé.'
        using errcode = '23514';
    end if;
    if new.id <> old.id
       or new.replaced_at is distinct from old.replaced_at
       or new.note is distinct from old.note then
      raise exception 'Remplacement rattaché à une livraison : il ne peut pas être modifié.'
        using errcode = '23514';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.replacements_guard_lock() from public, anon, authenticated;

create trigger replacements_a_guard_lock
  before update or delete on public.replacements
  for each row execute function public.replacements_guard_lock();


-- ---------------------------------------------------------------------
-- Invariant d'attribution, vérifié au commit
-- ---------------------------------------------------------------------

create function public.assert_delivery_attribution(p_delivery_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery public.deliveries;
  v_count    integer;
  v_late     integer;
begin
  select * into v_delivery from public.deliveries d where d.id = p_delivery_id;
  if not found then
    return;
  end if;
  select count(*), count(*) filter (where r.replaced_on > v_delivery.delivery_date)
    into v_count, v_late
  from public.replacements r
  where r.delivery_id = p_delivery_id;
  if v_count <> v_delivery.bottles_f1 then
    raise exception 'Livraison du % : % remplacement(s) rattaché(s) pour % attendu(s).',
      v_delivery.delivery_date, v_count, v_delivery.bottles_f1
      using errcode = '23514';
  end if;
  if v_late > 0 then
    raise exception 'Livraison du % : un remplacement rattaché est postérieur à la livraison.',
      v_delivery.delivery_date
      using errcode = '23514';
  end if;
end;
$$;

revoke all on function public.assert_delivery_attribution(uuid) from public, anon, authenticated;

create function public.check_delivery_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'deliveries' then
    perform public.assert_delivery_attribution(new.id);
    return null;
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.delivery_id is not null then
    perform public.assert_delivery_attribution(old.delivery_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.delivery_id is not null then
    perform public.assert_delivery_attribution(new.delivery_id);
  end if;
  return null;
end;
$$;

revoke all on function public.check_delivery_attribution() from public, anon, authenticated;

create constraint trigger deliveries_attribution_check
  after insert or update on public.deliveries
  deferrable initially deferred
  for each row execute function public.check_delivery_attribution();

create constraint trigger replacements_attribution_check
  after insert or update or delete on public.replacements
  deferrable initially deferred
  for each row execute function public.check_delivery_attribution();


-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table public.admin_allowlist enable row level security;
alter table public.price_settings  enable row level security;
alter table public.deliveries      enable row level security;
alter table public.replacements    enable row level security;
alter table public.soa_statements  enable row level security;
alter table public.repayments      enable row level security;
alter table public.share_links     enable row level security;

-- Personne d'autre que l'administrateur, et jamais le rôle anonyme.
revoke all on table
  public.admin_allowlist, public.price_settings, public.deliveries, public.replacements,
  public.soa_statements, public.repayments, public.share_links
from anon, authenticated;

-- admin_allowlist : aucun droit, aucune politique (lue par is_admin()).

grant select, delete on public.price_settings to authenticated;
grant insert (id, unit_price_cents, effective_from),
      update (id, unit_price_cents, effective_from)
  on public.price_settings to authenticated;

-- deliveries : prix appliqué jamais écrit par le client (trigger).
grant select, delete on public.deliveries to authenticated;
grant insert (id, delivery_date, bottles_total, bottles_f1, note),
      update (delivery_date, bottles_total, bottles_f1, note, document_path)
  on public.deliveries to authenticated;

-- replacements : delivery_id modifiable pour save_delivery() (security
-- invoker), sous la garde de la contrainte différée et du verrou.
grant select, delete on public.replacements to authenticated;
grant insert (id, replaced_at, note),
      update (id, replaced_at, note, delivery_id)
  on public.replacements to authenticated;

grant select, delete on public.soa_statements to authenticated;
grant insert (id, month, total_billed_cents, variance_cents, variance_treatment, note, document_path),
      update (id, month, total_billed_cents, variance_cents, variance_treatment, note, document_path)
  on public.soa_statements to authenticated;

grant select, delete on public.repayments to authenticated;
grant insert (id, repayment_date, amount_cents, note),
      update (id, repayment_date, amount_cents, note)
  on public.repayments to authenticated;

-- share_links : le hash n'est jamais relu par l'application.
grant select (id, created_at, revoked_at) on public.share_links to authenticated;
grant insert (id, token_hash), update (revoked_at) on public.share_links to authenticated;

create policy "admin : lecture des prix" on public.price_settings
  for select to authenticated using ((select public.is_admin()));
create policy "admin : ajout de prix" on public.price_settings
  for insert to authenticated with check ((select public.is_admin()));
create policy "admin : modification des prix" on public.price_settings
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin : suppression de prix" on public.price_settings
  for delete to authenticated using ((select public.is_admin()));

create policy "admin : lecture des livraisons" on public.deliveries
  for select to authenticated using ((select public.is_admin()));
create policy "admin : ajout de livraisons" on public.deliveries
  for insert to authenticated with check ((select public.is_admin()));
create policy "admin : modification des livraisons" on public.deliveries
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin : suppression de livraisons" on public.deliveries
  for delete to authenticated using ((select public.is_admin()));

create policy "admin : lecture des remplacements" on public.replacements
  for select to authenticated using ((select public.is_admin()));
create policy "admin : ajout de remplacements" on public.replacements
  for insert to authenticated with check ((select public.is_admin()));
create policy "admin : modification des remplacements" on public.replacements
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin : suppression de remplacements" on public.replacements
  for delete to authenticated using ((select public.is_admin()));

create policy "admin : lecture des SOA" on public.soa_statements
  for select to authenticated using ((select public.is_admin()));
create policy "admin : ajout de SOA" on public.soa_statements
  for insert to authenticated with check ((select public.is_admin()));
create policy "admin : modification des SOA" on public.soa_statements
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin : suppression de SOA" on public.soa_statements
  for delete to authenticated using ((select public.is_admin()));

create policy "admin : lecture des remboursements" on public.repayments
  for select to authenticated using ((select public.is_admin()));
create policy "admin : ajout de remboursements" on public.repayments
  for insert to authenticated with check ((select public.is_admin()));
create policy "admin : modification des remboursements" on public.repayments
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin : suppression de remboursements" on public.repayments
  for delete to authenticated using ((select public.is_admin()));

create policy "admin : lecture des liens" on public.share_links
  for select to authenticated using ((select public.is_admin()));
create policy "admin : création de liens" on public.share_links
  for insert to authenticated with check ((select public.is_admin()));
create policy "admin : révocation de liens" on public.share_links
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
