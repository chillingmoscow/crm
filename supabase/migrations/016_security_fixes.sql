-- ============================================================
-- 016_security_fixes.sql
-- P0 hardening: Storage, security-definer RPC, RLS policies
-- ============================================================

-- ── 1. Fix Storage policies for staff-documents ──────────────
-- Path convention: {venue_id}/{user_id}/{document_type}/{filename}
-- Restriction: caller must be an active member of the venue
-- that owns the file (first path component = venue_id).

drop policy if exists "staff_docs_select" on storage.objects;
drop policy if exists "staff_docs_insert" on storage.objects;
drop policy if exists "staff_docs_update" on storage.objects;
drop policy if exists "staff_docs_delete" on storage.objects;

-- SELECT: any active venue member can view files
create policy "staff_docs_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'staff-documents'
    and exists (
      select 1
      from public.user_venue_roles uvr
      where uvr.user_id = auth.uid()
        and uvr.venue_id::text = (storage.foldername(name))[1]
        and uvr.status = 'active'
    )
  );

-- INSERT/UPDATE/DELETE: requires manage_staff permission in the venue
create policy "staff_docs_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'staff-documents'
    and exists (
      select 1
      from public.user_venue_roles uvr
      where uvr.user_id = auth.uid()
        and uvr.venue_id::text = (storage.foldername(name))[1]
        and uvr.status = 'active'
    )
    and public.has_permission('platform.manage_staff')
  );

create policy "staff_docs_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'staff-documents'
    and exists (
      select 1
      from public.user_venue_roles uvr
      where uvr.user_id = auth.uid()
        and uvr.venue_id::text = (storage.foldername(name))[1]
        and uvr.status = 'active'
    )
    and public.has_permission('platform.manage_staff')
  );

create policy "staff_docs_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'staff-documents'
    and exists (
      select 1
      from public.user_venue_roles uvr
      where uvr.user_id = auth.uid()
        and uvr.venue_id::text = (storage.foldername(name))[1]
        and uvr.status = 'active'
    )
    and public.has_permission('platform.manage_staff')
  );

-- ── 2. Fix security definer RPC: get_venue_staff ─────────────
-- Add caller membership check so the function refuses to return
-- data when called by a user who is not a member of p_venue_id.

drop function if exists public.get_venue_staff(uuid);
create function public.get_venue_staff(p_venue_id uuid)
returns table (
  uvr_id          uuid,
  user_id         uuid,
  role_id         uuid,
  role_name       text,
  role_code       text,
  first_name      text,
  last_name       text,
  email           text,
  avatar_url      text,
  phone           text,
  telegram_id     text,
  gender          text,
  birth_date      date,
  employment_date date,
  joined_at       timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    uvr.id                                                         as uvr_id,
    uvr.user_id,
    uvr.role_id,
    r.name                                                         as role_name,
    r.code                                                         as role_code,
    p.first_name,
    p.last_name,
    au.email,
    p.avatar_url,
    p.phone,
    p.telegram_id,
    p.gender,
    p.birth_date,
    coalesce(p.employment_date, uvr.created_at::date)             as employment_date,
    uvr.created_at                                                 as joined_at
  from public.user_venue_roles uvr
  join public.profiles  p  on p.id  = uvr.user_id
  join public.roles     r  on r.id  = uvr.role_id
  join auth.users       au on au.id = uvr.user_id
  where uvr.venue_id = p_venue_id
    and uvr.status   = 'active'
    -- Guard: only return rows if the caller is an active member of this venue
    and exists (
      select 1
      from public.user_venue_roles caller_uvr
      where caller_uvr.user_id = auth.uid()
        and caller_uvr.venue_id = p_venue_id
        and caller_uvr.status   = 'active'
    )
  order by uvr.created_at;
$$;

-- ── 3. Fix security definer RPC: get_fired_staff ─────────────
drop function if exists public.get_fired_staff(uuid);
create function public.get_fired_staff(p_venue_id uuid)
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
  fired_at   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    uvr.id         as uvr_id,
    uvr.user_id,
    uvr.role_id,
    r.name         as role_name,
    r.code         as role_code,
    p.first_name,
    p.last_name,
    au.email,
    p.avatar_url,
    uvr.fired_at
  from public.user_venue_roles uvr
  join public.profiles  p  on p.id  = uvr.user_id
  join public.roles     r  on r.id  = uvr.role_id
  join auth.users       au on au.id = uvr.user_id
  where uvr.venue_id = p_venue_id
    and uvr.status   = 'fired'
    -- Guard: only return rows if the caller is an active member of this venue
    and exists (
      select 1
      from public.user_venue_roles caller_uvr
      where caller_uvr.user_id = auth.uid()
        and caller_uvr.venue_id = p_venue_id
        and caller_uvr.status   = 'active'
    )
  order by uvr.fired_at desc;
$$;

-- ── 4. Fix profiles_select_venue_staff ───────────────────────
-- Original policy verified only that the TARGET user is in the venue,
-- not that the CALLER is also a member. Fix: require both.

drop policy if exists "profiles_select_venue_staff" on public.profiles;
create policy "profiles_select_venue_staff"
  on public.profiles for select
  using (
    -- Target profile belongs to an active member of caller's active venue
    exists (
      select 1 from public.user_venue_roles uvr
      where uvr.user_id  = profiles.id
        and uvr.venue_id = public.get_active_venue_id()
        and uvr.status   = 'active'
    )
    -- AND the caller is also an active member of that same venue
    and exists (
      select 1 from public.user_venue_roles caller_uvr
      where caller_uvr.user_id  = auth.uid()
        and caller_uvr.venue_id = public.get_active_venue_id()
        and caller_uvr.status   = 'active'
    )
  );

drop policy if exists "profiles_update_venue_staff" on public.profiles;
create policy "profiles_update_venue_staff"
  on public.profiles for update
  using (
    id != auth.uid()
    and public.has_permission('platform.manage_staff')
    and exists (
      select 1 from public.user_venue_roles uvr
      where uvr.user_id  = profiles.id
        and uvr.venue_id = public.get_active_venue_id()
        and uvr.status   = 'active'
    )
    and exists (
      select 1 from public.user_venue_roles caller_uvr
      where caller_uvr.user_id  = auth.uid()
        and caller_uvr.venue_id = public.get_active_venue_id()
        and caller_uvr.status   = 'active'
    )
  );
