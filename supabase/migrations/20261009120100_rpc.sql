-- =====================================================================
-- EauPartagée — fonctions appelées par l'application
--
-- save_delivery()      livraison + rattachement des remplacements, atomique
-- rotate_share_link()  nouveau lien Foyer 2 (révoque l'ancien)
-- revoke_share_links() révocation du lien actif
-- get_shared_view()    page Foyer 2 : uniquement ses données
-- =====================================================================


-- ---------------------------------------------------------------------
-- Livraison et attribution
-- ---------------------------------------------------------------------

-- Crée ou recalcule une livraison et rattache exactement les
-- remplacements donnés (calculés par allocateDelivery() côté client).
-- Idempotente sur deliveries.id : rejouer le même appel ne change rien.
-- security invoker : la RLS (is_admin) s'applique à chaque écriture, et
-- la contrainte différée vérifie l'invariant au commit.
create function public.save_delivery(p_delivery jsonb, p_replacement_ids uuid[])
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ids   uuid[] := coalesce(p_replacement_ids, '{}'::uuid[]);
  v_id    uuid;
  v_date  date;
  v_total integer;
  v_note  text;
  v_found integer;
  v_row   public.deliveries;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;

  v_id    := (p_delivery ->> 'id')::uuid;
  v_date  := (p_delivery ->> 'delivery_date')::date;
  v_total := (p_delivery ->> 'bottles_total')::integer;
  v_note  := nullif(btrim(coalesce(p_delivery ->> 'note', '')), '');

  if v_id is null or v_date is null or v_total is null then
    raise exception 'Livraison incomplète.' using errcode = '22023';
  end if;
  if array_position(v_ids, null) is not null
     or (select count(distinct x) from unnest(v_ids) as x) <> cardinality(v_ids) then
    raise exception 'Liste de remplacements invalide (doublon ou valeur vide).' using errcode = '22023';
  end if;

  insert into public.deliveries as d (id, delivery_date, bottles_total, bottles_f1, note)
  values (v_id, v_date, v_total, cardinality(v_ids), v_note)
  on conflict (id) do update
    set delivery_date = excluded.delivery_date,
        bottles_total = excluded.bottles_total,
        bottles_f1    = excluded.bottles_f1,
        note          = excluded.note;

  -- Les remplacements qui ne font plus partie de la livraison repassent en attente.
  update public.replacements r
     set delivery_id = null
   where r.delivery_id = v_id
     and not (r.id = any (v_ids));

  select count(*) into v_found from public.replacements r where r.id = any (v_ids);
  if v_found <> cardinality(v_ids) then
    raise exception 'Remplacement inconnu : synchronisez puis recommencez.' using errcode = '23503';
  end if;
  if exists (
    select 1 from public.replacements r
    where r.id = any (v_ids) and r.delivery_id is not null and r.delivery_id <> v_id
  ) then
    raise exception 'Un remplacement est déjà rattaché à une autre livraison.' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.replacements r
    where r.id = any (v_ids) and r.replaced_on > v_date
  ) then
    raise exception 'Un remplacement est postérieur à la date de livraison.' using errcode = '23514';
  end if;

  update public.replacements r
     set delivery_id = v_id
   where r.id = any (v_ids)
     and r.delivery_id is distinct from v_id;

  select * into v_row from public.deliveries d where d.id = v_id;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.save_delivery(jsonb, uuid[]) from public, anon, authenticated;
grant execute on function public.save_delivery(jsonb, uuid[]) to authenticated;


-- ---------------------------------------------------------------------
-- Liens de consultation du Foyer 2
-- ---------------------------------------------------------------------

-- Enregistre le hash d'un nouveau token (généré dans le navigateur) et
-- révoque le lien actif, dans la même transaction.
create function public.rotate_share_link(p_id uuid, p_token_hash text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_created timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  update public.share_links s set revoked_at = now() where s.revoked_at is null;
  insert into public.share_links (id, token_hash)
  values (p_id, lower(p_token_hash))
  returning created_at into v_created;
  return jsonb_build_object('id', p_id, 'created_at', v_created);
end;
$$;

revoke all on function public.rotate_share_link(uuid, text) from public, anon, authenticated;
grant execute on function public.rotate_share_link(uuid, text) to authenticated;

create function public.revoke_share_links()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'Accès refusé.' using errcode = '42501';
  end if;
  update public.share_links s set revoked_at = now() where s.revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.revoke_share_links() from public, anon, authenticated;
grant execute on function public.revoke_share_links() to authenticated;

-- Page du Foyer 2. Renvoie null si le token est invalide ou révoqué ;
-- sinon UNIQUEMENT ses données : livraisons où il a des bonbonnes
-- (date, nombre, prix, montant), totaux mensuels, ajustements d'écart
-- qui lui sont imputés, remboursements (date, montant) et solde.
-- Jamais : bottles_total, bottles_f1, remplacements, total SOA, écarts
-- bruts, notes, chemins de documents (le total permettrait de déduire
-- la consommation du Foyer 1).
create function public.get_shared_view(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hash text;
begin
  if p_token is null
     or char_length(p_token) not between 32 and 128
     or p_token !~ '^[A-Za-z0-9_-]+$' then
    return null;
  end if;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if not exists (
    select 1 from public.share_links s
    where s.token_hash = v_hash and s.revoked_at is null
  ) then
    return null;
  end if;

  return (
    with f2 as (
      select d.delivery_date,
             d.bottles_f2,
             d.unit_price_cents_applied,
             d.bottles_f2 * d.unit_price_cents_applied as amount_cents,
             date_trunc('month', d.delivery_date::timestamp)::date as month
      from public.deliveries d
      where d.bottles_f2 > 0
    ),
    adjustments as (
      select s.month, s.f2_adjustment_cents
      from public.soa_statements s
      where s.f2_adjustment_cents <> 0
    ),
    months as (
      select m.month,
             coalesce((select sum(f.amount_cents) from f2 f where f.month = m.month), 0) as deliveries_cents,
             coalesce((select sum(a.f2_adjustment_cents) from adjustments a where a.month = m.month), 0) as adjustment_cents
      from (select f.month from f2 f union select a.month from adjustments a) m
    )
    select jsonb_build_object(
      'generated_at', now(),
      'deliveries', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'date', f.delivery_date,
                 'bottles', f.bottles_f2,
                 'unit_price_cents', f.unit_price_cents_applied,
                 'amount_cents', f.amount_cents
               ) order by f.delivery_date desc)
        from f2 f
      ), '[]'::jsonb),
      'months', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'month', to_char(m.month, 'YYYY-MM'),
                 'deliveries_cents', m.deliveries_cents,
                 'adjustment_cents', m.adjustment_cents,
                 'total_cents', m.deliveries_cents + m.adjustment_cents
               ) order by m.month desc)
        from months m
      ), '[]'::jsonb),
      'repayments', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'date', r.repayment_date,
                 'amount_cents', r.amount_cents
               ) order by r.repayment_date desc)
        from public.repayments r
      ), '[]'::jsonb),
      'balance_cents',
        coalesce((select sum(f.amount_cents) from f2 f), 0)
        + coalesce((select sum(a.f2_adjustment_cents) from adjustments a), 0)
        - coalesce((select sum(r.amount_cents) from public.repayments r), 0)
    )
  );
end;
$$;

revoke all on function public.get_shared_view(text) from public, anon, authenticated;
grant execute on function public.get_shared_view(text) to anon, authenticated;
