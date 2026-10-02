-- EauPartagée — durcissement optionnel : hook « Before User Created ».
--
-- À activer dans le dashboard Supabase (Authentication > Hooks >
-- Before User Created > Postgres > public.hook_before_user_created).
-- Une fois activé, un compte n'est créé que :
--   * via Google (une inscription par email/mot de passe ou lien magique est
--     refusée, même pour l'adresse de l'admin : pas de compte pré-créé par un
--     tiers avec un mot de passe) ;
--   * et pour une adresse présente dans admin_allowlist.
-- La réponse est la même quelle que soit l'adresse pour une inscription par
-- email (pas d'énumération de l'allowlist).
-- Le compte admin créé par `npm run seed:admin` (API admin) n'est pas concerné.
-- Sans ce hook, la sécurité reste assurée par is_admin() (RLS) et par le
-- contrôle ADMIN_EMAIL côté serveur.

create function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := lower(coalesce(event -> 'user' ->> 'email', ''));
  v_provider text := coalesce(event -> 'user' -> 'app_metadata' ->> 'provider', '');
begin
  if v_provider = 'google' and v_email <> '' and exists (
    select 1 from public.admin_allowlist a where a.email = v_email
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'Accès non autorisé'
    )
  );
end;
$$;

revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
