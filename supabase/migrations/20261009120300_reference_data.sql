-- =====================================================================
-- EauPartagée — données de référence
--
-- Prix initial d'une bonbonne : Rs 240 TTC, applicable depuis toujours
-- (2000-01-01) pour que toute livraison ait un prix. Modifiable depuis
-- l'application (nouveau prix avec date d'effet). Rejouable sans effet.
-- =====================================================================

insert into public.price_settings (id, unit_price_cents, effective_from)
values ('00000000-0000-4000-8000-000000024000', 24000, '2000-01-01')
on conflict do nothing;

-- Le premier prix ne se supprime pas : sans lui, une livraison datée avant
-- le prix suivant n'aurait plus de prix.
create function public.price_settings_keep_first()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.price_settings p
    where p.id <> old.id and p.effective_from <= old.effective_from
  ) then
    raise exception 'Le premier prix ne peut pas être supprimé : modifiez-le ou ajoutez-en un nouveau.'
      using errcode = '23514';
  end if;
  return old;
end;
$$;

revoke all on function public.price_settings_keep_first() from public, anon, authenticated;

create trigger price_settings_a_keep_first
  before delete on public.price_settings
  for each row execute function public.price_settings_keep_first();
