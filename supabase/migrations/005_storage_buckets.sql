-- ============================================================
-- 005_storage_buckets.sql
-- Supabase Storage: бакеты для загрузки файлов
-- ============================================================

-- Бакет для логотипов аккаунтов и заведений
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

-- RLS для storage.objects
-- Любой аутентифицированный может загружать в avatars
create policy "avatars_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars');

-- Публичный просмотр
create policy "avatars_select"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- Владелец файла может удалять/обновлять
create policy "avatars_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and owner_id = auth.uid()::text);

create policy "avatars_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and owner_id = auth.uid()::text);
