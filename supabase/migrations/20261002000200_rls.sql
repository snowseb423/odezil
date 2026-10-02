-- EauPartagée — contrôle d'accès.
--
-- Piège Google OAuth : n'importe quel compte Google peut obtenir une session
-- Supabase valide (rôle `authenticated`). Une session ne prouve donc rien :
-- chaque politique exige public.is_admin(), qui vérifie l'allowlist.
-- Le rôle `anon` n'a aucun droit et aucune politique.

-- Vrai seulement si :
--   * l'email du JWT (en minuscules) figure dans admin_allowlist ;
--   * il correspond bien à l'utilisateur auth.uid() (défense en profondeur) ;
--   * cet email est confirmé ;
--   * la session n'a pas été ouverte par mot de passe (claim `amr`) : l'admin
--     ne se connecte que par Google ou lien magique. Un tiers qui aurait
--     pré-créé un compte avec mot de passe sur l'adresse de l'admin (avant sa
--     première connexion) ne peut donc pas s'en servir, même si l'adresse est
--     ensuite confirmée.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.admin_allowlist a
      join auth.users u
        on lower(u.email) = a.email
     where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
       and u.id = auth.uid()
       and u.email_confirmed_at is not null
  )
  and not exists (
    -- `amr` : tableau d'objets {method, timestamp} ou de chaînes (RFC 8176).
    select 1
      from jsonb_array_elements(
             case jsonb_typeof(auth.jwt() -> 'amr')
               when 'array' then auth.jwt() -> 'amr'
               else '[]'::jsonb
             end
           ) as entry(value)
     where coalesce(entry.value ->> 'method', entry.value #>> '{}') in ('password', 'anonymous')
  );
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Les fonctions trigger ne doivent pas être appelables via l'API.
revoke execute on function public.deliveries_freeze_unit_price() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.share_links_revocation_is_final() from public, anon, authenticated;
revoke execute on function public.price_settings_keep_one() from public, anon, authenticated;

-- RLS sur toutes les tables.
alter table public.admin_allowlist enable row level security;
alter table public.price_settings enable row level security;
alter table public.deliveries enable row level security;
alter table public.soa_statements enable row level security;
alter table public.repayments enable row level security;
alter table public.share_links enable row level security;

-- On retire les droits accordés par défaut par Supabase, puis on accorde le
-- strict nécessaire à `authenticated` (toujours filtré par is_admin()).
revoke all on table
  public.admin_allowlist,
  public.price_settings,
  public.deliveries,
  public.soa_statements,
  public.repayments,
  public.share_links
from anon, authenticated;

-- admin_allowlist : aucun accès via l'API pour anon/authenticated (lue
-- seulement par is_admin()). service_role en a besoin pour `npm run seed:admin`
-- (upsert ON CONFLICT : SELECT + INSERT), y compris sur un projet créé sans
-- droits par défaut (« Automatically expose new tables » décoché).
grant select, insert on table public.admin_allowlist to service_role;

grant select, insert, delete on table public.price_settings to authenticated;
-- Pas d'UPDATE sur les livraisons : le prix appliqué reste figé.
grant select, insert, delete on table public.deliveries to authenticated;
grant select, insert, update, delete on table public.soa_statements to authenticated;
grant select, insert, delete on table public.repayments to authenticated;
grant select, insert on table public.share_links to authenticated;
grant update (revoked_at) on table public.share_links to authenticated;

create policy price_settings_admin_all on public.price_settings
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy deliveries_admin_all on public.deliveries
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy soa_statements_admin_all on public.soa_statements
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy repayments_admin_all on public.repayments
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy share_links_admin_all on public.share_links
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Objets créés plus tard par `postgres` : aucun droit implicite pour l'API.
-- Postgres accorde EXECUTE à PUBLIC sur toute nouvelle fonction (défaut
-- global, qu'un REVOKE « in schema » ne retire pas) : on le retire
-- globalement, puis on retire les droits par schéma posés par Supabase.
-- Toute future fonction ou table devra recevoir des droits explicites.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
