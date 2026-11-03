-- Разнесение актов списаний по плательщикам: право, RPC, тенантность, переживание
-- ресинка и исчезновения акта. Нужна локальная БД с seed (owner@test.com).
-- Всё откатывается в конце.
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/writeoff-pool-assignment.sql
begin;
do $test$
declare
  owner_u uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  a uuid := 'cccccccc-0000-0000-0000-000000000001';
  v uuid := 'dddddddd-0000-0000-0000-000000000001';
  v2 uuid; foreign_acc uuid; foreign_venue uuid;
  d1 uuid; d_arch uuid; d_foreign uuid; d_other_venue uuid;
  e1 uuid; e_foreign uuid; e_other_venue uuid;
  r uuid; x uuid; n integer;
begin
  insert into public.venues(account_id, name) values (a, 'Второе заведение WPA QA') returning id into v2;
  insert into public.accounts(name, owner_id) values ('Чужой WPA QA', 'bbbbbbbb-0000-0000-0000-000000000002') returning id into foreign_acc;
  insert into public.venues(account_id, name) values (foreign_acc, 'Чужое WPA QA') returning id into foreign_venue;

  insert into public.departments(name, venue_id) values ('Кальяны WPA QA', v) returning id into d1;
  insert into public.departments(name, venue_id, archived_at) values ('Архивное WPA QA', v, now()) returning id into d_arch;
  insert into public.departments(name, venue_id) values ('Чужое WPA QA', foreign_venue) returning id into d_foreign;
  insert into public.departments(name, venue_id) values ('Другое заведение WPA QA', v2) returning id into d_other_venue;

  insert into public.payroll_employees(account_id, venue_id, name, role_name) values (a, v, 'Иван WPA QA', 'Бармен') returning id into e1;
  insert into public.payroll_employees(account_id, venue_id, name, role_name) values (a, v, 'Никем не выбранный WPA QA', 'Бармен');
  insert into public.payroll_employees(account_id, venue_id, name, role_name) values (foreign_acc, foreign_venue, 'Чужой WPA QA', 'Бармен') returning id into e_foreign;
  insert into public.payroll_employees(account_id, venue_id, name, role_name) values (a, v2, 'Из другого заведения WPA QA', 'Бармен') returning id into e_other_venue;

  -- Зеркало актов: 901 проведён, 902 будет переписан и исчезнет, 903 в другом заведении.
  insert into public.stock_writeoff_documents(account_id, venue_id, external_id, business_date, payload, source_hash)
    values (a, v, 900000901, '2026-10-05', '{"v":1}', 'h1'),
           (a, v, 900000902, '2026-10-06', '{"v":1}', 'h1'),
           (a, v2, 900000903, '2026-10-07', '{"v":1}', 'h1');

  -- Читатель журнала без права разнесения.
  insert into public.roles(venue_id, name, code) values (v, 'WPA reader QA', 'wpa_reader_qa') returning id into r;
  insert into public.role_permissions(role_id, permission_id, granted) select r, id, true from public.permissions where code = 'inventory.view_results';
  x := gen_random_uuid();
  insert into auth.users(id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
    values (x, 'authenticated', 'authenticated', 'wpa-reader-' || x || '@qa.invalid', '{}', '{}', now(), now());
  insert into public.profiles(id, first_name, active_venue_id) values (x, 'QA', v) on conflict (id) do update set active_venue_id = v;
  insert into public.user_venue_roles(user_id, venue_id, role_id, status) values (x, v, r, 'active');
  perform set_config('test.wpa_reader', x::text, true);

  -- Только право разнесения, без права смотреть журнал.
  insert into public.roles(venue_id, name, code) values (v, 'WPA assign-only QA', 'wpa_assign_only_qa') returning id into r;
  insert into public.role_permissions(role_id, permission_id, granted) select r, id, true from public.permissions where code = 'inventory.assign_writeoff_pool';
  x := gen_random_uuid();
  insert into auth.users(id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
    values (x, 'authenticated', 'authenticated', 'wpa-assign-' || x || '@qa.invalid', '{}', '{}', now(), now());
  insert into public.profiles(id, first_name, active_venue_id) values (x, 'QA', v) on conflict (id) do update set active_venue_id = v;
  insert into public.user_venue_roles(user_id, venue_id, role_id, status) values (x, v, r, 'active');
  perform set_config('test.wpa_assign_only', x::text, true);

  perform set_config('test.wpa_v', v::text, true);
  perform set_config('test.wpa_v2', v2::text, true);
  perform set_config('test.wpa_d1', d1::text, true);
  perform set_config('test.wpa_d_arch', d_arch::text, true);
  perform set_config('test.wpa_d_foreign', d_foreign::text, true);
  perform set_config('test.wpa_d_other', d_other_venue::text, true);
  perform set_config('test.wpa_e1', e1::text, true);
  perform set_config('test.wpa_e_foreign', e_foreign::text, true);
  perform set_config('test.wpa_e_other', e_other_venue::text, true);

  -- Право заведено в модуле инвентаризации и выдано всем, у кого есть adjust_results.
  if (select module from public.permissions where code = 'inventory.assign_writeoff_pool') <> 'inventory_documents' then
    raise exception 'FAIL 1: permission module';
  end if;
  if exists (
    select 1 from public.role_permissions rp
    join public.permissions o on o.id = rp.permission_id and o.code = 'inventory.adjust_results'
    where rp.granted and not exists (
      select 1 from public.role_permissions q join public.permissions p on p.id = q.permission_id
      where p.code = 'inventory.assign_writeoff_pool' and q.role_id = rp.role_id and q.granted)
      and rp.role_id not in (select id from public.roles where code in ('wpa_reader_qa'))
  ) then
    raise exception 'FAIL 2: a role with adjust_results lacks the new permission';
  end if;
  -- ...и не выдано тем, у кого adjust_results нет (читатель выше).
  if exists (select 1 from public.role_permissions rp join public.permissions p on p.id = rp.permission_id
             where p.code = 'inventory.assign_writeoff_pool' and rp.role_id = (select id from public.roles where code = 'wpa_reader_qa')) then
    raise exception 'FAIL 3: reader role got the permission';
  end if;
  -- Новая роль-менеджер получает право от триггера по умолчанию.
  insert into public.roles(venue_id, name, code) values (v2, 'WPA new manager QA', 'custom_manager') returning id into r;
  if not exists (select 1 from public.role_permissions rp join public.permissions p on p.id = rp.permission_id
                 where p.code = 'inventory.assign_writeoff_pool' and rp.role_id = r and rp.granted) then
    raise exception 'FAIL 4: new custom_manager did not get the permission by default';
  end if;
end $test$;

-- Владелец: разносит акты.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true),
       set_config('app.ctx_ready', '0', true);
set local role authenticated;
do $test$
declare
  v uuid := current_setting('test.wpa_v')::uuid;
  d1 uuid := current_setting('test.wpa_d1')::uuid;
  e1 uuid := current_setting('test.wpa_e1')::uuid;
  row public.writeoff_pool_assignments%rowtype;
  n integer;
begin
  -- Общий пул, подразделение, сотрудник.
  perform public.set_writeoff_pool('900000901', 'shared', null);
  select * into row from public.writeoff_pool_assignments where external_id = 900000901;
  if row.pool <> 'shared' or row.department_id is not null or row.employee_id is not null or row.venue_id <> v then raise exception 'FAIL 5: shared'; end if;
  perform public.set_writeoff_pool('900000901', 'department', d1);
  select * into row from public.writeoff_pool_assignments where external_id = 900000901;
  if row.pool <> 'department' or row.department_id <> d1 or row.employee_id is not null then raise exception 'FAIL 6: department'; end if;
  perform public.set_writeoff_pool('900000901', 'personal', e1);
  select * into row from public.writeoff_pool_assignments where external_id = 900000901;
  if row.pool <> 'personal' or row.employee_id <> e1 or row.department_id is not null then raise exception 'FAIL 7: personal'; end if;
  if (select count(*) from public.writeoff_pool_assignments where external_id = 900000901) <> 1 then raise exception 'FAIL 8: reassign duplicated the row'; end if;

  -- Аудит: три смены пометки - три записи; повтор той же - без новой.
  select count(*) into n from public.audit_logs where action_code = 'stock.writeoffs.pool_assigned' and details->>'externalId' = '900000901';
  if n <> 3 then raise exception 'FAIL 9: audit rows = %', n; end if;
  perform public.set_writeoff_pool('900000901', 'personal', e1);
  select count(*) into n from public.audit_logs where action_code = 'stock.writeoffs.pool_assigned' and details->>'externalId' = '900000901';
  if n <> 3 then raise exception 'FAIL 10: no-op repeat wrote audit'; end if;

  -- Невалидные вызовы.
  begin perform public.set_writeoff_pool('900000901', 'shared', d1); raise exception 'FAIL 11: shared with key accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform public.set_writeoff_pool('900000901', 'department', null); raise exception 'FAIL 12: department without key accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform public.set_writeoff_pool('900000901', 'personal', null); raise exception 'FAIL 13: personal without key accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform public.set_writeoff_pool('900000901', 'department', current_setting('test.wpa_d_arch')::uuid); raise exception 'FAIL 14: archived department accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform public.set_writeoff_pool('900000901', 'department', current_setting('test.wpa_d_foreign')::uuid); raise exception 'FAIL 15: foreign-account department accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform public.set_writeoff_pool('900000901', 'department', current_setting('test.wpa_d_other')::uuid); raise exception 'FAIL 16: other-venue department accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform public.set_writeoff_pool('900000901', 'personal', current_setting('test.wpa_e_foreign')::uuid); raise exception 'FAIL 17: foreign-account employee accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform public.set_writeoff_pool('900000901', 'personal', current_setting('test.wpa_e_other')::uuid); raise exception 'FAIL 18: other-venue employee accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform public.set_writeoff_pool('900000901', 'everyone', null); raise exception 'FAIL 19: unknown pool accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform public.set_writeoff_pool('abc', 'shared', null); raise exception 'FAIL 20: bad id accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform public.set_writeoff_pool('999999999', 'shared', null); raise exception 'FAIL 21: unknown act accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  -- Акт чужого заведения того же аккаунта: активное заведение другое.
  begin perform public.set_writeoff_pool('900000903', 'shared', null); raise exception 'FAIL 22: act of another venue accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;

  -- Прямая запись в обход RPC закрыта.
  if has_table_privilege('authenticated', 'public.writeoff_pool_assignments', 'INSERT')
     or has_table_privilege('authenticated', 'public.writeoff_pool_assignments', 'UPDATE')
     or has_table_privilege('authenticated', 'public.writeoff_pool_assignments', 'DELETE') then
    raise exception 'FAIL 23: direct write privilege';
  end if;
  if has_function_privilege('anon', 'public.set_writeoff_pool(text,text,uuid)', 'EXECUTE') then raise exception 'FAIL 24: anon can execute'; end if;

  -- Список плательщиков.
  if jsonb_array_length(public.writeoff_pool_targets()->'departments') <> 1
     or jsonb_array_length(public.writeoff_pool_targets()->'employees') <> 2 then
    raise exception 'FAIL 25: targets %', public.writeoff_pool_targets();
  end if;

  -- Акт 902: разнесён, затем снят (null) - строки нет.
  perform public.set_writeoff_pool('900000902', 'shared', null);
  perform public.set_writeoff_pool('900000902', null, null);
  if exists (select 1 from public.writeoff_pool_assignments where external_id = 900000902) then raise exception 'FAIL 26: clear'; end if;
  perform public.set_writeoff_pool('900000902', null, null); -- снять уже снятую: не ошибка
  -- «Не удерживать»: отдельное явное решение, без ключа.
  perform public.set_writeoff_pool('900000902', 'excluded', null);
  select * into row from public.writeoff_pool_assignments where external_id = 900000902;
  if row.pool <> 'excluded' or row.department_id is not null or row.employee_id is not null then raise exception 'FAIL 26b: excluded'; end if;
  begin perform public.set_writeoff_pool('900000902', 'excluded', d1); raise exception 'FAIL 26c: excluded with key accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  perform public.set_writeoff_pool('900000902', 'department', d1);
end $test$;
reset role;

-- Ресинк и исчезновение акта пометку не трогают.
do $test$
begin
  update public.stock_writeoff_documents
     set payload = '{"v":2}', source_hash = 'h2', version = version + 1, last_seen_at = now()
   where external_id = 900000902;
  if (select pool from public.writeoff_pool_assignments where external_id = 900000902) is distinct from 'department' then
    raise exception 'FAIL 27: mark lost after re-sync';
  end if;
  update public.stock_writeoff_documents set missing_at = now() where external_id = 900000902;
  if (select pool from public.writeoff_pool_assignments where external_id = 900000902) is distinct from 'department' then
    raise exception 'FAIL 28: mark lost after the act vanished from the source';
  end if;
  update public.stock_writeoff_documents set missing_at = null where external_id = 900000902;
  if (select pool from public.writeoff_pool_assignments where external_id = 900000902) is distinct from 'department' then
    raise exception 'FAIL 29: mark lost after the act returned';
  end if;
  -- Даже если строку зеркала пересоздали с нуля, пометка остаётся.
  delete from public.stock_writeoff_documents where external_id = 900000902;
  if (select pool from public.writeoff_pool_assignments where external_id = 900000902) is distinct from 'department' then
    raise exception 'FAIL 30: mark lost after the mirror row was removed';
  end if;
end $test$;

-- Ограничения на самой таблице (под владельцем, мимо RPC).
do $test$
declare v uuid := current_setting('test.wpa_v')::uuid; a uuid := 'cccccccc-0000-0000-0000-000000000001';
begin
  begin insert into public.writeoff_pool_assignments(account_id, venue_id, external_id, pool) values (a, v, 910, 'personal');
    raise exception 'FAIL 31: personal without employee accepted';
  exception when check_violation then null; end;
  begin insert into public.writeoff_pool_assignments(account_id, venue_id, external_id, pool, employee_id) values (a, v, 916, 'excluded', current_setting('test.wpa_e1')::uuid);
    raise exception 'FAIL 32b: excluded with employee accepted';
  exception when check_violation then null; end;
  begin insert into public.writeoff_pool_assignments(account_id, venue_id, external_id, pool, department_id) values (a, v, 911, 'shared', current_setting('test.wpa_d1')::uuid);
    raise exception 'FAIL 32: shared with department accepted';
  exception when check_violation then null; end;
  begin insert into public.writeoff_pool_assignments(account_id, venue_id, external_id, pool, department_id, employee_id) values (a, v, 912, 'department', current_setting('test.wpa_d1')::uuid, current_setting('test.wpa_e1')::uuid);
    raise exception 'FAIL 33: department with employee accepted';
  exception when check_violation then null; end;
  begin insert into public.writeoff_pool_assignments(account_id, venue_id, external_id, pool, department_id) values (a, v, 913, 'department', current_setting('test.wpa_d_other')::uuid);
    raise exception 'FAIL 34: department of another venue accepted by the guard';
  exception when raise_exception then if sqlerrm like 'FAIL%' or sqlerrm not like 'Подразделение относится к другому заведению%' then raise; end if; end;
  begin insert into public.writeoff_pool_assignments(account_id, venue_id, external_id, pool, employee_id) values (a, v, 914, 'personal', current_setting('test.wpa_e_other')::uuid);
    raise exception 'FAIL 35: employee of another venue accepted by the composite FK';
  exception when foreign_key_violation then null; end;
  begin insert into public.writeoff_pool_assignments(account_id, venue_id, external_id, pool) values (a, v, 900000901, 'shared');
    raise exception 'FAIL 36: duplicate act key accepted';
  exception when unique_violation then null; end;
  begin insert into public.writeoff_pool_assignments(account_id, venue_id, external_id, pool) values (gen_random_uuid(), v, 915, 'shared');
    raise exception 'FAIL 37: venue of another account accepted';
  exception when foreign_key_violation then null; end;
end $test$;

-- Читатель журнала: видит пометки, но поставить не может.
select set_config('request.jwt.claim.sub', current_setting('test.wpa_reader'), true),
       set_config('app.ctx_ready', '0', true);
set local role authenticated;
do $test$
begin
  if (select count(*) from public.writeoff_pool_assignments) < 2 then raise exception 'FAIL 38: reader cannot see marks'; end if;
  begin perform public.set_writeoff_pool('900000901', 'shared', null); raise exception 'FAIL 39: reader assigned a pool';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  -- Читатель получает имена только тех, на кого уже поставлена пометка.
  if jsonb_array_length(public.writeoff_pool_targets()->'departments') <> 1
     or jsonb_array_length(public.writeoff_pool_targets()->'employees') <> 1
     or (public.writeoff_pool_targets()->'employees'->0->>'id')::uuid <> current_setting('test.wpa_e1')::uuid then
    raise exception 'FAIL 40: reader targets %', public.writeoff_pool_targets();
  end if;
  if (select pool from public.writeoff_pool_assignments where external_id = 900000901) <> 'personal' then raise exception 'FAIL 41: reader changed a mark'; end if;
end $test$;
reset role;

-- Только право разнесения без права смотреть журнал: отказ.
select set_config('request.jwt.claim.sub', current_setting('test.wpa_assign_only'), true),
       set_config('app.ctx_ready', '0', true);
set local role authenticated;
do $test$
begin
  begin perform public.set_writeoff_pool('900000901', 'shared', null); raise exception 'FAIL 42: assign without view accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform public.writeoff_pool_targets(); raise exception 'FAIL 42b: targets without view accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  if (select count(*) from public.writeoff_pool_assignments) <> 0 then raise exception 'FAIL 43: marks visible without view_results'; end if;
end $test$;
reset role;

-- Анонимный вызов и пометки чужого заведения.
select set_config('request.jwt.claim.sub', '', true), set_config('app.ctx_ready', '0', true);
set local role authenticated;
do $test$
begin
  begin perform public.set_writeoff_pool('900000901', 'shared', null); raise exception 'FAIL 44: anonymous assigned';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
end $test$;
reset role;
-- Метка в другом заведении того же аккаунта: владелец, переключённый на второе заведение, её не видит.
do $test$
begin
  insert into public.writeoff_pool_assignments(account_id, venue_id, external_id, pool)
    values ('cccccccc-0000-0000-0000-000000000001', current_setting('test.wpa_v2')::uuid, 900000903, 'shared');
  update public.profiles set active_venue_id = current_setting('test.wpa_v2')::uuid where id = 'aaaaaaaa-0000-0000-0000-000000000001';
end $test$;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true), set_config('app.ctx_ready', '0', true);
set local role authenticated;
do $test$
begin
  if exists (select 1 from public.writeoff_pool_assignments where venue_id <> current_setting('test.wpa_v2')::uuid) then
    raise exception 'FAIL 45: marks of another venue visible';
  end if;
  -- Акт первого заведения отсюда не разнести.
  begin perform public.set_writeoff_pool('900000901', 'shared', null); raise exception 'FAIL 46: act of the other venue assignable';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
end $test$;
reset role;

-- Удаление подразделения снимает пометку (а не оставляет акт «в никуда»).
do $test$
declare d uuid;
begin
  update public.profiles set active_venue_id = current_setting('test.wpa_v')::uuid where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  insert into public.departments(name, venue_id) values ('Удаляемое WPA QA', current_setting('test.wpa_v')::uuid) returning id into d;
  insert into public.writeoff_pool_assignments(account_id, venue_id, external_id, pool, department_id)
    values ('cccccccc-0000-0000-0000-000000000001', current_setting('test.wpa_v')::uuid, 920, 'department', d);
  delete from public.departments where id = d;
  if exists (select 1 from public.writeoff_pool_assignments where external_id = 920) then raise exception 'FAIL 47: mark survived department delete'; end if;
end $test$;
rollback;
select 'writeoff-pool-assignment: OK' as result;
