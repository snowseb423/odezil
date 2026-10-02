-- EauPartagée — photos des bons de livraison.
-- Bucket privé, accessible uniquement à l'admin (is_admin()) ; l'application
-- n'affiche les photos que via des URLs signées de courte durée.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bons-livraison',
  'bons-livraison',
  false,
  5242880, -- 5 Mo (les photos sont compressées côté client avant envoi)
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy bons_livraison_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'bons-livraison' and (select public.is_admin()));

create policy bons_livraison_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'bons-livraison' and (select public.is_admin()));

create policy bons_livraison_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'bons-livraison' and (select public.is_admin()));
