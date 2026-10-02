-- EauPartagée — données de la page Cardinal (/p/[token]).
--
-- Seule source de données de la page partagée. Appelée côté serveur avec la
-- clé service_role, après hachage du token (HMAC-SHA256 + SHARE_TOKEN_PEPPER).
-- Ne renvoie QUE des données du foyer Cardinal (B) :
--   - livraisons : date, bottles_b, prix appliqué (jamais bottles_a, photo, note) ;
--   - ajustements : part de l'écart SOA imputée à B, déjà calculée (jamais le
--     total SOA, l'écart brut ni la part du Macoua) ;
--   - remboursements : date, montant (jamais la note).
-- Renvoie NULL si le token est inconnu ou révoqué.

create function public.share_snapshot(p_token_hash text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with link as (
    select 1
      from public.share_links l
     where l.token_hash = p_token_hash
       and l.revoked_at is null
  ),
  adjustments as (
    select to_char(s.month, 'YYYY-MM') as month,
           -- 50/50 : division entière tronquée vers zéro, comme
           -- varianceImpactOnB() dans lib/calculations.ts.
           case s.variance_treatment
             when 'impute_to_b' then s.variance_cents
             when 'split_50_50' then s.variance_cents / 2
           end as amount_cents
      from public.soa_statements s
     where s.variance_treatment in ('impute_to_b', 'split_50_50')
  )
  select case
    when not exists (select 1 from link) then null
    else jsonb_build_object(
      'deliveries', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'date', d.delivery_date,
                   'bottles', d.bottles_b,
                   'unit_price_cents', d.unit_price_cents_applied
                 )
                 order by d.delivery_date, d.created_at
               )
          from public.deliveries d
         where d.bottles_b > 0
      ), '[]'::jsonb),
      'adjustments', coalesce((
        select jsonb_agg(
                 jsonb_build_object('month', a.month, 'amount_cents', a.amount_cents)
                 order by a.month
               )
          from adjustments a
         where a.amount_cents <> 0
      ), '[]'::jsonb),
      'repayments', coalesce((
        select jsonb_agg(
                 jsonb_build_object('date', r.repayment_date, 'amount_cents', r.amount_cents)
                 order by r.repayment_date, r.created_at
               )
          from public.repayments r
      ), '[]'::jsonb)
    )
  end;
$$;

revoke execute on function public.share_snapshot(text) from public, anon, authenticated;
grant execute on function public.share_snapshot(text) to service_role;
