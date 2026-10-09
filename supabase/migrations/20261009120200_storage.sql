-- =====================================================================
-- EauPartagée — stockage des documents (bons de livraison et SOA)
--
-- Bucket privé « documents », réservé à l'administrateur (is_admin()).
-- Chemins : deliveries/{delivery_id}/{uuid}.{ext} et soa/{yyyy-mm}/{uuid}.{ext}.
-- Lecture par URL signée de courte durée ; le Foyer 2 n'y a aucun accès.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "eaupartagee admin : lecture des documents" on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and (select public.is_admin()));

create policy "eaupartagee admin : ajout de documents" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (select public.is_admin())
    and (storage.foldername(name))[1] in ('deliveries', 'soa')
  );

create policy "eaupartagee admin : remplacement de documents" on storage.objects
  for update to authenticated
  using (bucket_id = 'documents' and (select public.is_admin()))
  with check (
    bucket_id = 'documents'
    and (select public.is_admin())
    and (storage.foldername(name))[1] in ('deliveries', 'soa')
  );

create policy "eaupartagee admin : suppression de documents" on storage.objects
  for delete to authenticated
  using (bucket_id = 'documents' and (select public.is_admin()));
