-- Integration checks for platform core v1.
-- Run after migrations on a local Supabase DB.

begin;

create or replace function public.test_assert(p_condition boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if not p_condition then
    raise exception 'TEST FAILED: %', p_message;
  end if;
end;
$$;

-- Seed auth users required by FK to profiles
with now_cte as (
  select now() as now_value
)
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  v.id,
  'authenticated',
  'authenticated',
  v.email,
  crypt('password', gen_salt('bf')),
  n.now_value,
  '{}'::jsonb,
  '{}'::jsonb,
  n.now_value,
  n.now_value
from now_cte n
cross join (
  values
    ('11111111-1111-1111-1111-111111111111'::uuid, 'owner@test.local'::text),
    ('22222222-2222-2222-2222-222222222222'::uuid, 'manager@test.local'::text),
    ('33333333-3333-3333-3333-333333333333'::uuid, 'outsider@test.local'::text),
    ('44444444-4444-4444-4444-444444444444'::uuid, 'invitee@test.local'::text),
    ('55555555-5555-5555-5555-555555555555'::uuid, 'wrong@test.local'::text),
    ('66666666-6666-6666-6666-666666666666'::uuid, 'second-owner@test.local'::text)
) as v(id, email)
on conflict (id) do nothing;

insert into public.profiles(id, first_name, last_name)
values
  ('11111111-1111-1111-1111-111111111111', 'Owner', 'One'),
  ('22222222-2222-2222-2222-222222222222', 'Manager', 'Two'),
  ('33333333-3333-3333-3333-333333333333', 'Outsider', 'Three'),
  ('44444444-4444-4444-4444-444444444444', 'Invitee', 'Four'),
  ('55555555-5555-5555-5555-555555555555', 'Wrong', 'Email'),
  ('66666666-6666-6666-6666-666666666666', 'Second', 'Owner')
on conflict (id) do nothing;

set local row_security = on;
set local role authenticated;

-- Simulate owner session
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.email', 'owner@test.local', true);

select out_account_id as account_id, out_venue_id as venue_id
into temporary table t_bootstrap
from public.bootstrap_owner(
  p_account_name := 'Acme Group',
  p_venue_name := 'Acme Main',
  p_venue_type := 'restaurant',
  p_currency := 'USD',
  p_timezone := 'UTC'
);

select public.test_assert((select count(*) = 1 from t_bootstrap), 'owner bootstrap should create account and venue');

-- Attach manager to the same venue
insert into public.user_venue_roles(user_id, venue_id, role_id, status)
select
  '22222222-2222-2222-2222-222222222222'::uuid,
  t.venue_id,
  r.id,
  'active'::public.employee_status_enum
from t_bootstrap t
join public.roles r on r.account_id = t.account_id and r.code = 'manager'
on conflict (user_id, venue_id) do nothing;

-- Set manager active venue in manager context (RLS-safe update)
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.email', 'manager@test.local', true);

update public.profiles p
set active_venue_id = t.venue_id
from t_bootstrap t
where p.id = '22222222-2222-2222-2222-222222222222';

-- Owner should have manage_staff permission
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.email', 'owner@test.local', true);
select public.test_assert(public.has_permission('platform.manage_staff'), 'owner should have manage_staff');

-- Manager should have manage_staff too
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.email', 'manager@test.local', true);
select public.test_assert(public.has_permission('platform.manage_staff'), 'manager should have manage_staff');

-- Manager should not have manage_account
select public.test_assert(not public.has_permission('platform.manage_account'), 'manager must not have manage_account');

-- Outsider should not see data in another account through RLS
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.email', 'outsider@test.local', true);
select public.test_assert((select count(*) = 0 from public.accounts), 'outsider should not select foreign accounts');

-- Manager creates invitation for invitee
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.email', 'manager@test.local', true);

select public.create_invitation(
  p_venue_id := (select venue_id from t_bootstrap),
  p_email := 'invitee@test.local',
  p_role_id := (
    select r.id
    from public.roles r
    join t_bootstrap t on t.account_id = r.account_id
    where r.code = 'waiter'
    limit 1
  ),
  p_expires_at := now() + interval '2 hours'
)
into temporary table t_invitation;

select public.test_assert((select count(*) = 1 from t_invitation), 'invitation should be created');

-- Accept invitation with correct email
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.email', 'invitee@test.local', true);

select public.accept_invitation((select * from t_invitation));

select public.test_assert(
  exists (
    select 1
    from public.user_venue_roles uvr
    where uvr.user_id = '44444444-4444-4444-4444-444444444444'
      and uvr.venue_id = (select venue_id from t_bootstrap)
      and uvr.status = 'active'
  ),
  'invitee must become active staff'
);

-- Wrong email should fail strict check
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select set_config('request.jwt.claim.email', 'manager@test.local', true);

select public.create_invitation(
  p_venue_id := (select venue_id from t_bootstrap),
  p_email := 'strict@test.local',
  p_role_id := (
    select r.id
    from public.roles r
    join t_bootstrap t on t.account_id = r.account_id
    where r.code = 'waiter'
    limit 1
  ),
  p_expires_at := now() + interval '2 hours'
)
into temporary table t_strict_inv;

select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);
select set_config('request.jwt.claim.email', 'wrong@test.local', true);

do $$
begin
  perform public.accept_invitation((select * from t_strict_inv));
  raise exception 'TEST FAILED: strict email check expected to fail';
exception
  when others then
    if position('does not match' in sqlerrm) = 0 then
      raise;
    end if;
end;
$$;

-- Single-account restriction test
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', true);
select set_config('request.jwt.claim.email', 'second-owner@test.local', true);

select out_account_id as account_id, out_venue_id as venue_id
into temporary table t_bootstrap_second
from public.bootstrap_owner(
  p_account_name := 'Other Group',
  p_venue_name := 'Other Venue',
  p_venue_type := 'bar',
  p_currency := 'USD',
  p_timezone := 'UTC'
);

select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', true);
select set_config('request.jwt.claim.email', 'second-owner@test.local', true);

do $$
begin
  perform public.create_invitation(
    p_venue_id := (select venue_id from t_bootstrap_second),
    p_email := 'invitee@test.local',
    p_role_id := (
      select r.id
      from public.roles r
      join t_bootstrap_second t on t.account_id = r.account_id
      where r.code = 'waiter'
      limit 1
    ),
    p_expires_at := now() + interval '2 hours'
  );
  raise exception 'TEST FAILED: expected cross-account restriction to fail on invite creation';
exception
  when others then
    if position('another account' in sqlerrm) = 0 then
      raise;
    end if;
end;
$$;

-- Audit sanity check
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select set_config('request.jwt.claim.email', 'manager@test.local', true);

select public.test_assert(
  exists (
    select 1
    from public.audit_logs
    where action_code = 'invite.created'
      and venue_id = (select venue_id from t_bootstrap)
  ),
  'invite.created audit should exist'
);

rollback;
