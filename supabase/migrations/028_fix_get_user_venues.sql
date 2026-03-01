-- ============================================================
-- 1. Fix get_user_venues:
--    - First branch: add status = 'active' filter so fired staff
--      don't appear in the switcher.
--    - Second branch: show ALL owner venues from accounts.owner_id
--      directly (no longer restricts to venues WITHOUT a
--      user_venue_roles row). UNION handles deduplication.
--    Previously the `not exists` guard meant that once
--    complete_owner_onboarding inserted a user_venue_roles row,
--    the second branch excluded the venue, causing it to rely
--    solely on the first branch — which worked, but any status
--    mismatch silently hid the venue.
-- ============================================================
create or replace function public.get_user_venues()
returns table (
  venue_id   uuid,
  venue_name text,
  role_code  text,
  role_name  text
)
language sql
stable
security definer
set search_path = public
as $$
  -- Active staff entries via user_venue_roles
  select
    v.id   as venue_id,
    v.name as venue_name,
    r.code as role_code,
    r.name as role_name
  from public.user_venue_roles uvr
  join public.venues v on v.id = uvr.venue_id
  join public.roles  r on r.id = uvr.role_id
  where uvr.user_id = auth.uid()
    and uvr.status  = 'active'

  union

  -- Owner venues: always visible regardless of user_venue_roles presence
  select
    v.id   as venue_id,
    v.name as venue_name,
    r.code as role_code,
    r.name as role_name
  from public.venues v
  join public.accounts a on a.id = v.account_id
  join public.roles    r on r.code = 'owner' and r.account_id is null
  where a.owner_id = auth.uid();
$$;

-- ============================================================
-- 2. Fix complete_owner_onboarding:
--    Explicitly set status = 'active' on the owner's
--    user_venue_roles row (defensive — matches the column default,
--    but makes the intent clear and survives any future default change).
-- ============================================================
create or replace function public.complete_owner_onboarding(
  p_account_name  text,
  p_account_logo  text,
  p_venue_name    text,
  p_venue_type    public.venue_type,
  p_venue_address text,
  p_venue_phone   text,
  p_venue_website text default '',
  p_currency      text default 'RUB',
  p_timezone      text default 'Europe/Moscow',
  p_working_hours jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_account_id    uuid;
  v_venue_id      uuid;
  v_owner_role_id uuid;
begin
  -- Создаём аккаунт
  insert into public.accounts (name, logo_url, owner_id)
  values (p_account_name, p_account_logo, auth.uid())
  returning id into v_account_id;

  -- Создаём первое заведение
  insert into public.venues (
    account_id, name, type, address, phone, website,
    currency, timezone, working_hours
  )
  values (
    v_account_id, p_venue_name, p_venue_type,
    p_venue_address, p_venue_phone,
    nullif(trim(p_venue_website), ''),
    p_currency, p_timezone, p_working_hours
  )
  returning id into v_venue_id;

  -- Находим системную роль owner
  select id into v_owner_role_id
  from public.roles
  where code = 'owner' and account_id is null;

  -- Привязываем владельца к заведению (status явно = 'active')
  insert into public.user_venue_roles (user_id, venue_id, role_id, status)
  values (auth.uid(), v_venue_id, v_owner_role_id, 'active');

  -- Устанавливаем активное заведение
  update public.profiles
  set active_venue_id = v_venue_id
  where id = auth.uid();

  return jsonb_build_object(
    'account_id', v_account_id,
    'venue_id',   v_venue_id
  );
end;
$$;
