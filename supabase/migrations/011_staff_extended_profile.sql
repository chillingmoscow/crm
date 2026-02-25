-- ============================================================
-- 011_staff_extended_profile.sql
-- Расширенные поля профиля сотрудника + хранилище документов
-- ============================================================

-- Дополнительные поля в profiles
alter table public.profiles
  add column if not exists phone               text,
  add column if not exists telegram_id         text,
  add column if not exists gender              text check (gender in ('male', 'female')),
  add column if not exists birth_date          date,
  add column if not exists address             text,
  add column if not exists employment_date     date,
  add column if not exists avatar_url          text,
  add column if not exists medical_book_number text,
  add column if not exists medical_book_date   date,
  add column if not exists passport_photos     text[] default '{}';

-- ============================================================
-- RLS: менеджеры/владельцы могут читать профили сотрудников
-- своего активного заведения
-- ============================================================
create policy "profiles_select_venue_staff"
  on public.profiles for select
  using (
    exists (
      select 1 from public.user_venue_roles uvr
      where uvr.user_id = profiles.id
        and uvr.venue_id = public.get_active_venue_id()
    )
  );

-- RLS: менеджеры/владельцы могут обновлять профили сотрудников
create policy "profiles_update_venue_staff"
  on public.profiles for update
  using (
    exists (
      select 1 from public.user_venue_roles uvr
      where uvr.user_id = profiles.id
        and uvr.venue_id = public.get_active_venue_id()
        and public.has_permission('platform.manage_staff')
    )
  );

-- ============================================================
-- Обновляем get_venue_staff — добавляем avatar_url
-- DROP нужен: PostgreSQL не разрешает менять return type через OR REPLACE
-- ============================================================
drop function if exists public.get_venue_staff(uuid);
create function public.get_venue_staff(p_venue_id uuid)
returns table (
  uvr_id     uuid,
  user_id    uuid,
  role_id    uuid,
  role_name  text,
  role_code  text,
  first_name text,
  last_name  text,
  email      text,
  avatar_url text,
  joined_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    uvr.id          as uvr_id,
    uvr.user_id,
    uvr.role_id,
    r.name          as role_name,
    r.code          as role_code,
    p.first_name,
    p.last_name,
    au.email,
    p.avatar_url,
    uvr.created_at  as joined_at
  from public.user_venue_roles uvr
  join public.profiles  p  on p.id  = uvr.user_id
  join public.roles     r  on r.id  = uvr.role_id
  join auth.users       au on au.id = uvr.user_id
  where uvr.venue_id = p_venue_id
  order by uvr.created_at;
$$;

-- ============================================================
-- Приватный бакет для документов сотрудников (паспорта и т.д.)
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'staff-documents',
  'staff-documents',
  false,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

-- Любой аутентифицированный пользователь может читать/писать
-- (доступ к бакету контролируется на уровне приложения)
create policy "staff_docs_select"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'staff-documents');

create policy "staff_docs_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'staff-documents');

create policy "staff_docs_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'staff-documents');

create policy "staff_docs_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'staff-documents');
