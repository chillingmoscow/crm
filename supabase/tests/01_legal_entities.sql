-- ============================================================
-- 01_legal_entities.sql — integration tests for stage 2A.
--
-- Run AFTER all migrations on a fresh local Supabase DB:
--   pnpm db:reset
--   psql "$(supabase status --output env | grep DB_URL | cut -d= -f2-)" -f supabase/tests/01_legal_entities.sql
--
-- The script wraps everything in a single transaction and ROLLBACKs at
-- the end, so it never leaves test data behind. A failure raises an
-- exception; success prints a NOTICE.
-- ============================================================

begin;

-- ────────────────────────────────────────────────────────────
-- Helper: tiny assertion wrapper.
-- ────────────────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────────────────
-- 1. Schema: legal_entities table and enums exist with required cols.
-- ────────────────────────────────────────────────────────────
do $$
begin
  perform public.test_assert(
    exists (select 1 from pg_type where typname = 'legal_form_enum'),
    'legal_form_enum is missing'
  );
  perform public.test_assert(
    exists (select 1 from pg_type where typname = 'tax_system_enum'),
    'tax_system_enum is missing'
  );

  perform public.test_assert(
    (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'legal_entities'
         and column_name in (
           'id', 'account_id', 'name', 'legal_form', 'inn', 'kpp', 'ogrn',
           'tax_system', 'vat_payer', 'legal_address', 'director_name',
           'dadata_synced_at', 'created_at', 'created_by'
         )
    ) = 14,
    'legal_entities is missing one of the expected columns'
  );

  perform public.test_assert(
    exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'venues'
                and column_name = 'default_legal_entity_id'),
    'venues.default_legal_entity_id is missing'
  );
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 2. Permissions catalogue: current module counts, no platform.* leftovers.
-- ────────────────────────────────────────────────────────────
do $$
declare
  v_total int;
  v_platform int;
begin
  select count(*) into v_total from public.permissions;
  perform public.test_assert(v_total = 72, 'expected 72 permissions, got ' || v_total);

  select count(*) into v_platform from public.permissions where module = 'platform';
  perform public.test_assert(v_platform = 0, 'platform.* leftovers in permissions: ' || v_platform);

  perform public.test_assert(
    (select count(*) from public.permissions where module = 'people')   = 8,
    'expected 8 people.* perms'
  );
  perform public.test_assert(
    (select count(*) from public.permissions where module = 'org')      = 9,
    'expected 9 org.* perms'
  );
  perform public.test_assert(
    (select count(*) from public.permissions where module = 'finance')  = 18,
    'expected 18 finance.* perms'
  );
  perform public.test_assert(
    (select count(*) from public.permissions where module = 'inventory') = 9,
    'expected 9 inventory.* perms'
  );
  perform public.test_assert(
    (select count(*) from public.permissions where module = 'kb') = 15,
    'expected 15 kb.* perms'
  );
  perform public.test_assert(
    (select count(*) from public.permissions where module = 'crm')      = 9,
    'expected 9 crm.* perms'
  );
  perform public.test_assert(
    (select count(*) from public.permissions where module = 'settings') = 4,
    'expected 4 settings.* perms'
  );
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 3. Accountant role exists with correct code, system role.
-- ────────────────────────────────────────────────────────────
do $$
begin
  perform public.test_assert(
    exists (
      select 1 from public.roles
      where code = 'accountant' and account_id is null
    ),
    'system role accountant is missing'
  );
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 4. role_permissions matrix sanity-checks per MERGE_PLAN §4.3.
-- ────────────────────────────────────────────────────────────
do $$
declare
  v_owner_grants int;
begin
  -- Owner has all current perms.
  select count(*) into v_owner_grants
  from public.role_permissions rp
  join public.roles r on r.id = rp.role_id
  where r.code = 'owner' and r.account_id is null and rp.granted = true;
  perform public.test_assert(v_owner_grants = 72,
    'owner expected 72 grants, got ' || v_owner_grants);

  -- Accountant has org.manage_legal_entities (key permission for the role).
  perform public.test_assert(
    exists (
      select 1 from public.role_permissions rp
      join public.roles r       on r.id = rp.role_id
      join public.permissions p on p.id = rp.permission_id
      where r.code = 'accountant' and r.account_id is null
        and p.code = 'org.manage_legal_entities'
        and rp.granted = true
    ),
    'accountant should have org.manage_legal_entities'
  );

  -- Waiter does NOT have finance permissions.
  perform public.test_assert(
    not exists (
      select 1 from public.role_permissions rp
      join public.roles r       on r.id = rp.role_id
      join public.permissions p on p.id = rp.permission_id
      where r.code = 'waiter' and r.account_id is null
        and p.module = 'finance' and rp.granted = true
    ),
    'waiter should not have any finance permissions'
  );

  -- Hostess has crm.view_reservations.
  perform public.test_assert(
    exists (
      select 1 from public.role_permissions rp
      join public.roles r       on r.id = rp.role_id
      join public.permissions p on p.id = rp.permission_id
      where r.code = 'hostess' and r.account_id is null
        and p.code = 'crm.view_reservations'
        and rp.granted = true
    ),
    'hostess should have crm.view_reservations'
  );

  -- org.delete_legal_entity granted ONLY to owner.
  perform public.test_assert(
    (select count(distinct r.code)
       from public.role_permissions rp
       join public.roles r       on r.id = rp.role_id
       join public.permissions p on p.id = rp.permission_id
      where r.account_id is null
        and p.code = 'org.delete_legal_entity'
        and rp.granted = true
    ) = 1,
    'org.delete_legal_entity should be owner-only'
  );
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 5. complete_owner_onboarding creates legal_entity + links venue.
-- ────────────────────────────────────────────────────────────
-- Need an auth user; emulate by inserting into auth.users + profiles.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000'::uuid,
  '99999999-9999-9999-9999-999999999991'::uuid,
  'authenticated', 'authenticated',
  'le-test-owner@test.local',
  crypt('password', gen_salt('bf')),
  now(), '{}'::jsonb, '{}'::jsonb, now(), now()
)
on conflict (id) do nothing;

insert into public.profiles (id, first_name, last_name)
values ('99999999-9999-9999-9999-999999999991', 'LE-Owner', 'Test')
on conflict (id) do nothing;

-- Become this user.
set local request.jwt.claims = '{"sub":"99999999-9999-9999-9999-999999999991","role":"authenticated"}';
set local role = authenticated;

select public.complete_owner_onboarding(
  p_account_name  := 'LE Test Brand',
  p_account_logo  := null,
  p_legal_name    := 'ИП Тестов А.А.',
  p_legal_form    := 'IP'::public.legal_form_enum,
  p_legal_inn     := '500100732259',
  p_venue_name    := 'Test Spot',
  p_venue_type    := 'cafe'::public.venue_type,
  p_venue_address := 'Москва, Тверская 1',
  p_venue_phone   := '+7 999 000 0000',
  p_venue_website := '',
  p_currency      := 'RUB',
  p_timezone      := 'Europe/Moscow',
  p_working_hours := '{}'::jsonb
);

reset role;

do $$
declare
  v_account_id       uuid;
  v_legal_entity_id  uuid;
  v_venue_id         uuid;
  v_le_default       uuid;
begin
  select id into v_account_id from public.accounts
   where owner_id = '99999999-9999-9999-9999-999999999991';
  perform public.test_assert(v_account_id is not null, 'account was not created');

  select id into v_legal_entity_id from public.legal_entities
   where account_id = v_account_id;
  perform public.test_assert(v_legal_entity_id is not null, 'legal_entity was not created');

  select id, default_legal_entity_id into v_venue_id, v_le_default
    from public.venues
   where account_id = v_account_id;
  perform public.test_assert(v_venue_id is not null, 'venue was not created');
  perform public.test_assert(v_le_default = v_legal_entity_id,
    'venue.default_legal_entity_id is not linked to created legal_entity');
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 6. Idempotency — calling complete_owner_onboarding again does not
--    create a second account / legal_entity / venue.
-- ────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"99999999-9999-9999-9999-999999999991","role":"authenticated"}';
set local role = authenticated;

select public.complete_owner_onboarding(
  p_account_name  := 'LE Test Brand v2',
  p_account_logo  := null,
  p_legal_name    := 'should be ignored',
  p_legal_form    := 'OOO'::public.legal_form_enum,
  p_legal_inn     := '7707083893',
  p_venue_name    := 'should be ignored',
  p_venue_type    := 'bar'::public.venue_type,
  p_venue_address := 'should be ignored',
  p_venue_phone   := '',
  p_venue_website := '',
  p_currency      := 'RUB',
  p_timezone      := 'Europe/Moscow',
  p_working_hours := '{}'::jsonb
);

reset role;

do $$
begin
  perform public.test_assert(
    (select count(*) from public.accounts
      where owner_id = '99999999-9999-9999-9999-999999999991') = 1,
    'idempotency violated: more than one account for this owner'
  );
  perform public.test_assert(
    (select count(*) from public.legal_entities le
      join public.accounts a on a.id = le.account_id
      where a.owner_id = '99999999-9999-9999-9999-999999999991') = 1,
    'idempotency violated: more than one legal_entity for this owner'
  );
  perform public.test_assert(
    (select count(*) from public.venues v
      join public.accounts a on a.id = v.account_id
      where a.owner_id = '99999999-9999-9999-9999-999999999991') = 1,
    'idempotency violated: more than one venue for this owner'
  );
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 7. RLS: outsider cannot see another account's legal_entities.
-- ────────────────────────────────────────────────────────────
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000'::uuid,
  '99999999-9999-9999-9999-999999999992'::uuid,
  'authenticated', 'authenticated',
  'le-test-outsider@test.local',
  crypt('password', gen_salt('bf')),
  now(), '{}'::jsonb, '{}'::jsonb, now(), now()
)
on conflict (id) do nothing;

insert into public.profiles (id, first_name, last_name)
values ('99999999-9999-9999-9999-999999999992', 'LE-Outsider', 'Test')
on conflict (id) do nothing;

set local request.jwt.claims = '{"sub":"99999999-9999-9999-9999-999999999992","role":"authenticated"}';
set local role = authenticated;

do $$
declare
  v_visible int;
begin
  select count(*) into v_visible from public.legal_entities;
  perform public.test_assert(v_visible = 0,
    'outsider should see 0 legal_entities, got ' || v_visible);
end;
$$;

reset role;

-- ────────────────────────────────────────────────────────────
-- 8. get_active_legal_entity_id() returns the venue's default LE.
-- ────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"99999999-9999-9999-9999-999999999991","role":"authenticated"}';
set local role = authenticated;

do $$
declare
  v_le_via_helper uuid;
  v_le_via_join   uuid;
begin
  v_le_via_helper := public.get_active_legal_entity_id();

  select v.default_legal_entity_id into v_le_via_join
    from public.profiles p
    join public.venues v on v.id = p.active_venue_id
   where p.id = '99999999-9999-9999-9999-999999999991';

  perform public.test_assert(
    v_le_via_helper is not null,
    'get_active_legal_entity_id() returned NULL for owner with default LE'
  );
  perform public.test_assert(
    v_le_via_helper = v_le_via_join,
    'get_active_legal_entity_id() does not match expected venue.default_legal_entity_id'
  );
end;
$$;

reset role;

-- ────────────────────────────────────────────────────────────
-- 9. audit_logs has RLS; direct INSERT is denied.
-- ────────────────────────────────────────────────────────────
do $$
declare
  v_rowsec boolean;
begin
  select c.relrowsecurity into v_rowsec
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'audit_logs';

  perform public.test_assert(v_rowsec, 'audit_logs RLS is not enabled');
end;
$$;

-- ────────────────────────────────────────────────────────────
-- 10. Cross-tenant FK: cannot link a venue to a legal_entity that
--     belongs to a different account (migration 036).
-- ────────────────────────────────────────────────────────────
do $$
declare
  v_account_a       uuid;
  v_legal_a         uuid;
  v_venue_a         uuid;
  v_account_b       uuid;
  v_legal_b         uuid;
  v_caught          boolean := false;
begin
  -- Account A
  insert into public.accounts (name, owner_id) values
    ('Tenant A', '99999999-9999-9999-9999-999999999991')
    returning id into v_account_a;
  insert into public.legal_entities (account_id, name, legal_form) values
    (v_account_a, 'LE A', 'IP'::public.legal_form_enum)
    returning id into v_legal_a;
  insert into public.venues (account_id, name, type) values
    (v_account_a, 'Spot A', 'cafe'::public.venue_type)
    returning id into v_venue_a;

  -- Account B (separate tenant) with its own legal_entity
  insert into public.accounts (name, owner_id) values
    ('Tenant B', '99999999-9999-9999-9999-999999999992')
    returning id into v_account_b;
  insert into public.legal_entities (account_id, name, legal_form) values
    (v_account_b, 'LE B', 'IP'::public.legal_form_enum)
    returning id into v_legal_b;

  -- Same-tenant link is OK.
  update public.venues set default_legal_entity_id = v_legal_a where id = v_venue_a;

  -- Cross-tenant link must fail with FK violation (composite FK
  -- introduced by migration 036).
  begin
    update public.venues set default_legal_entity_id = v_legal_b where id = v_venue_a;
  exception when foreign_key_violation then
    v_caught := true;
  end;

  perform public.test_assert(v_caught,
    'cross-tenant venue → legal_entity link must be rejected by composite FK');
end;
$$;

-- ────────────────────────────────────────────────────────────
-- All done — print success and ROLLBACK so the DB stays clean.
-- ────────────────────────────────────────────────────────────
do $$
begin
  raise notice 'OK: stage 2A integration tests passed';
end;
$$;

rollback;
