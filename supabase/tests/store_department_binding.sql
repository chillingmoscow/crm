-- Привязка склада к подразделению: три состояния, тенантность, история.
-- Нужна локальная БД с seed (owner@test.com). Всё откатывается в конце.
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/store_department_binding.sql
begin;
do $test$
declare
  u uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  a uuid := 'cccccccc-0000-0000-0000-000000000001';
  v uuid := 'dddddddd-0000-0000-0000-000000000001';
  s uuid; s2 uuid;
  d uuid; d2 uuid; foreign_dept uuid; foreign_acc uuid; foreign_venue uuid;
  n integer;
begin
  insert into public.departments(name, venue_id) values ('Кальяны QA', v) returning id into d;
  insert into public.departments(name, venue_id) values ('Бар QA', v) returning id into d2;
  insert into public.accounts(name, owner_id) values ('Чужой QA', 'bbbbbbbb-0000-0000-0000-000000000002') returning id into foreign_acc;
  insert into public.venues(account_id, name) values (foreign_acc, 'Чужое заведение QA') returning id into foreign_venue;
  insert into public.departments(name, venue_id) values ('Чужое QA', foreign_venue) returning id into foreign_dept;
  insert into public.stores(account_id, external_id, title) values (a, 'qa-sdb-1', 'Кальяны Зал QA') returning id into s;
  insert into public.stores(account_id, external_id, title) values (a, 'qa-sdb-2', 'Бар QA') returning id into s2;

  -- По умолчанию склад «не задан».
  if (select department_scope from public.stores where id = s) <> 'unset' then
    raise exception 'FAIL 0: default scope is not unset';
  end if;

  -- 1. scope='department' без department_id отклоняется.
  begin
    update public.stores set department_scope = 'department' where id = s;
    raise exception 'FAIL 1: department without id accepted';
  exception when check_violation then null; end;

  -- 2. scope='shared' с department_id отклоняется.
  begin
    update public.stores set department_scope = 'shared', department_id = d where id = s;
    raise exception 'FAIL 2: shared with id accepted';
  exception when check_violation then null; end;

  -- 3. Подразделение чужого аккаунта отклоняется.
  begin
    update public.stores set department_scope = 'department', department_id = foreign_dept where id = s;
    raise exception 'FAIL 3: foreign-account department accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like 'Подразделение относится к другому аккаунту%' then raise; end if;
  end;

  perform set_config('test.sdb_store', s::text, true);
  perform set_config('test.sdb_store2', s2::text, true);
  perform set_config('test.sdb_dept', d::text, true);
  perform set_config('test.sdb_dept2', d2::text, true);
  perform set_config('test.sdb_foreign_dept', foreign_dept::text, true);
end $test$;

-- 4–5. RPC от имени владельца: история с актором, повтор ничего не добавляет.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true),
       set_config('app.ctx_ready', '0', true);
set local role authenticated;
do $test$
declare
  s uuid := current_setting('test.sdb_store')::uuid;
  d uuid := current_setting('test.sdb_dept')::uuid;
  n integer;
begin
  if public.set_store_department(s, 'department', d) <> s then raise exception 'FAIL 4: rpc did not return store id'; end if;
  if not exists (
    select 1 from public.stores where id = s and department_scope = 'department' and department_id = d
  ) then raise exception 'FAIL 4: store not bound'; end if;
  if not exists (
    select 1 from public.store_department_history
     where store_id = s and changed_by = auth.uid()
       and old_scope = 'unset' and old_department_id is null
       and new_scope = 'department' and new_department_id = d
  ) then raise exception 'FAIL 4: history row missing actor/values'; end if;

  -- 5. Повтор с теми же значениями.
  perform public.set_store_department(s, 'department', d);
  select count(*) into n from public.store_department_history where store_id = s;
  if n <> 1 then raise exception 'FAIL 5: repeat added history (% rows)', n; end if;

  -- «Общий» чистит подразделение и пишет историю.
  perform public.set_store_department(s, 'shared', null);
  if not exists (select 1 from public.stores where id = s and department_scope = 'shared' and department_id is null) then
    raise exception 'FAIL 5b: shared not applied';
  end if;
  perform public.set_store_department(s, 'department', d);

  -- Некорректные комбинации и чужое подразделение через RPC.
  begin perform public.set_store_department(s, 'department', null); raise exception 'FAIL 5c';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform public.set_store_department(s, 'shared', d); raise exception 'FAIL 5d';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform public.set_store_department(s, 'department', current_setting('test.sdb_foreign_dept')::uuid); raise exception 'FAIL 5e';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;

  -- Прямая запись и чужая история недоступны.
  if has_table_privilege('authenticated', 'public.store_department_history', 'INSERT')
     or has_table_privilege('authenticated', 'public.store_department_history', 'UPDATE')
     or has_table_privilege('authenticated', 'public.store_department_history', 'DELETE')
     or has_function_privilege('anon', 'public.set_store_department(uuid,text,uuid)', 'EXECUTE')
  then raise exception 'FAIL 5f: unsafe grants'; end if;
end $test$;

-- Пользователь без права управлять складами не меняет привязку.
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true),
       set_config('app.ctx_ready', '0', true);
do $test$
begin
  begin
    perform public.set_store_department(current_setting('test.sdb_store')::uuid, 'shared', null);
    raise exception 'FAIL 5g: waiter changed binding';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
end $test$;
reset role;

-- 6. Удаление подразделения переводит склад в 'unset', висячего id нет.
do $test$
declare s uuid := current_setting('test.sdb_store')::uuid; d uuid := current_setting('test.sdb_dept')::uuid;
begin
  delete from public.departments where id = d;
  if not exists (select 1 from public.stores where id = s and department_scope = 'unset' and department_id is null) then
    raise exception 'FAIL 6: store not moved to unset after department delete';
  end if;
  if not exists (select 1 from public.store_department_history
                  where store_id = s and old_scope = 'department' and old_department_id = d and new_scope = 'unset') then
    raise exception 'FAIL 6: department delete not recorded in history';
  end if;
end $test$;
rollback;
select 'store_department_binding: OK' as result;
