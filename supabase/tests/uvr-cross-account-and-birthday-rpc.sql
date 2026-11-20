-- Миграция 361: чужой аккаунт не виден через user_venue_roles, а
-- claim_birthday_* не вызываются ни анонимно, ни пользователем.
-- Запуск: docker exec -i supabase_db_crm psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/uvr-cross-account-and-birthday-rpc.sql
-- Опирается на seed.sql: менеджер bbbbbbbb-…02 с people.view_staff, официант cccccccc-…03.
begin;

insert into public.accounts(id, name, owner_id)
  values ('dddddddd-0000-0000-0000-0000000000a1', 'Чужой', 'cccccccc-0000-0000-0000-000000000003');
insert into public.venues(id, account_id, name)
  values ('dddddddd-0000-0000-0000-0000000000b1', 'dddddddd-0000-0000-0000-0000000000a1', 'Чужое заведение');
insert into public.roles(id, venue_id, name, code)
  values ('dddddddd-0000-0000-0000-0000000000c1', 'dddddddd-0000-0000-0000-0000000000b1', 'Бармен', 'custom_bar_x');
insert into public.user_venue_roles(user_id, venue_id, role_id, status, fired_reason)
  values ('cccccccc-0000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-0000000000b1',
          'dddddddd-0000-0000-0000-0000000000c1', 'fired', 'Чужой аккаунт');

create temp table r(step text, n bigint);
grant all on r to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
insert into r select 'manager_view_staff', public.has_permission('people.view_staff')::int;
insert into r select 'manager_foreign_rows', count(*) from public.user_venue_roles
  where venue_id = 'dddddddd-0000-0000-0000-0000000000b1';
insert into r select 'manager_own_account_rows', count(*) from public.user_venue_roles;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}';
insert into r select 'waiter_own_rows', count(*) from public.user_venue_roles
  where user_id = 'cccccccc-0000-0000-0000-000000000003';
reset role;

do $$
declare
  rows jsonb := (select jsonb_object_agg(step, n) from r);
begin
  if (rows->>'manager_view_staff')::int <> 1 then
    raise exception 'Фикстура: у менеджера нет people.view_staff (%)', rows;
  end if;
  if (rows->>'manager_foreign_rows')::int <> 0 then
    raise exception 'Строки чужого аккаунта видны через user_venue_roles (%)', rows;
  end if;
  if (rows->>'manager_own_account_rows')::int = 0 then
    raise exception 'Менеджер перестал видеть сотрудников своего аккаунта (%)', rows;
  end if;
  if (rows->>'waiter_own_rows')::int <> 2 then
    raise exception 'Сотрудник должен видеть свои строки в обоих аккаунтах (%)', rows;
  end if;
  if has_function_privilege('anon', 'public.claim_birthday_colleague_targets()', 'EXECUTE')
    or has_function_privilege('anon', 'public.claim_birthday_self_targets()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.claim_birthday_colleague_targets()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.claim_birthday_self_targets()', 'EXECUTE')
  then
    raise exception 'claim_birthday_* доступны anon/authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.claim_birthday_self_targets()', 'EXECUTE') then
    raise exception 'cron (service_role) больше не может вызвать claim_birthday_self_targets';
  end if;
  raise notice 'user_venue_roles и claim_birthday_*: OK';
end $$;

rollback;
