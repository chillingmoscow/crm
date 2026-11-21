-- Разнесение списаний: массовое разнесение, читаемый журнал и защита решений
-- при удалении подразделения.
--
-- 1. Удаление подразделения больше не стирает решения «кто платит»: внешний
--    ключ writeoff_pool_assignments.department_id был `on delete cascade`
--    (миграция 308), и удаление подразделения молча снимало разнесение актов.
--    Теперь `no action`: удалить подразделение, на которое разнесены акты,
--    нельзя (серверное действие заранее объясняет почему). Именно `no action`,
--    а не `restrict`: проверка в конце оператора, поэтому удаление заведения,
--    каскадом удаляющее и подразделения, и пометки, по-прежнему проходит.
-- 2. set_writeoff_pool пишет в журнал номер акта и имена плательщиков
--    (подразделение, сотрудник) на момент записи: журнал показывает
--    «Вся команда → Подразделение: Бар», а не голые ID. Остальное тело
--    функции не меняется.
-- 3. set_writeoff_pool_bulk: один плательщик сразу для многих актов. Одна
--    строка журнала на команду, а не на каждый акт.
-- 4. writeoff_pool_targets отдаёт у сотрудника ID в Quick Resto: по нему
--    карточка акта «Сотрудник» подсказывает, кого выбрать.
--
-- Применять от владельца функций (на проде — supabase_admin), без `psql -1`:
-- у миграции свои begin/commit. Повторный прогон безопасен.

begin;

-- 1. Подразделение с разнесёнными актами не удаляется.
alter table public.writeoff_pool_assignments
  drop constraint if exists writeoff_pool_assignments_department_id_fkey;
alter table public.writeoff_pool_assignments
  add constraint writeoff_pool_assignments_department_id_fkey
  foreign key (department_id) references public.departments(id);

-- Подпись плательщика для журнала: вариант, ID и имя на момент записи.
-- Вызывается только из SECURITY DEFINER-функций ниже (выполняется с правами
-- их владельца), напрямую никому не доступна.
create or replace function private.writeoff_pool_audit_label(p_pool text, p_department uuid, p_employee uuid)
returns jsonb
language sql
stable
set search_path = public, pg_catalog
as $$
  select case when p_pool is null then null else jsonb_build_object(
    'pool', p_pool,
    'key', coalesce(p_department, p_employee),
    'name', case
      when p_pool = 'department' then (select d.name from public.departments d where d.id = p_department)
      when p_pool = 'personal' then (select e.name from public.payroll_employees e where e.id = p_employee)
    end) end
$$;
revoke all on function private.writeoff_pool_audit_label(text, uuid, uuid) from public, anon, authenticated, service_role;

-- 2. Одна пометка. Тело как в 308, кроме состава details в журнале.
create or replace function public.set_writeoff_pool(p_external_id text, p_pool text, p_key uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  a uuid := public.get_active_account_id();
  v uuid := public.get_active_venue_id();
  u uuid := (select auth.uid());
  ext bigint;
  old public.writeoff_pool_assignments%rowtype;
  dep uuid;
  emp uuid;
begin
  if u is null or a is null or v is null
     or not public.has_permission('inventory.view_results')
     or not public.has_permission('inventory.assign_writeoff_pool') then
    raise exception 'Нет доступа к разнесению списаний';
  end if;
  if p_external_id is null or p_external_id !~ '^[1-9][0-9]{0,17}$' then
    raise exception 'Проверьте номер акта';
  end if;
  ext := p_external_id::bigint;
  if p_pool is not null and p_pool not in ('shared', 'department', 'personal', 'excluded') then
    raise exception 'Проверьте плательщика';
  end if;
  if not exists (
    select 1 from public.stock_writeoff_documents d
    where d.account_id = a and d.venue_id = v and d.external_id = ext
  ) then
    raise exception 'Акт списания не найден';
  end if;

  if p_pool in ('shared', 'excluded') and p_key is not null then
    raise exception 'Для этого варианта сотрудник и подразделение не указываются';
  elsif p_pool = 'department' then
    if p_key is null or not exists (
      select 1 from public.departments d
      where d.id = p_key and d.venue_id = v and d.archived_at is null
    ) then
      raise exception 'Подразделение не найдено в этом заведении';
    end if;
    dep := p_key;
  elsif p_pool = 'personal' then
    if p_key is null or not exists (
      select 1 from public.payroll_employees e
      where e.id = p_key and e.account_id = a and e.venue_id = v
    ) then
      raise exception 'Сотрудник не найден в этом заведении';
    end if;
    emp := p_key;
  elsif p_pool is null and p_key is not null then
    raise exception 'Не указан плательщик';
  end if;

  select * into old from public.writeoff_pool_assignments
  where account_id = a and venue_id = v and external_id = ext;

  if p_pool is null then
    delete from public.writeoff_pool_assignments
    where account_id = a and venue_id = v and external_id = ext;
  else
    insert into public.writeoff_pool_assignments
      (account_id, venue_id, external_id, pool, department_id, employee_id, assigned_by)
    values (a, v, ext, p_pool, dep, emp, u)
    on conflict (account_id, venue_id, external_id) do update set
      pool = excluded.pool,
      department_id = excluded.department_id,
      employee_id = excluded.employee_id,
      assigned_by = excluded.assigned_by,
      updated_at = now();
  end if;

  -- Не пишем в аудит повтор той же пометки.
  if old.id is null and p_pool is null then
    return;
  end if;
  if old.id is not null and old.pool is not distinct from p_pool
     and old.department_id is not distinct from dep
     and old.employee_id is not distinct from emp then
    return;
  end if;
  -- Номер акта и имена - на момент записи: журнал читается и после того, как
  -- подразделение переименуют или акт пропадёт из источника.
  insert into public.audit_logs (account_id, venue_id, user_id, action_code, entity_type, entity_id, details)
  values (a, v, u, 'stock.writeoffs.pool_assigned', 'stock_writeoff_source', v,
    jsonb_build_object(
      'externalId', ext,
      'number', (select d.payload->>'number' from public.stock_writeoff_documents d
                 where d.account_id = a and d.venue_id = v and d.external_id = ext),
      'before', case when old.id is null then null
        else private.writeoff_pool_audit_label(old.pool, old.department_id, old.employee_id) end,
      'after', private.writeoff_pool_audit_label(p_pool, dep, emp)));
end;
$$;
revoke all on function public.set_writeoff_pool(text, text, uuid) from public, anon;
grant execute on function public.set_writeoff_pool(text, text, uuid) to authenticated;

-- 3. Один плательщик для многих актов. Разносятся только акты, которые идут в
-- расчёт (проведённые и есть в источнике); черновики, пропавшие акты, чужие и
-- уже разнесённые так же пропускаются и возвращаются счётчиками. Снимать
-- разнесение массово нельзя: это делается по одному акту в карточке.
-- months - месяцы (первое число) актов, у которых плательщик изменился: по ним
-- сервер один раз на месяц пересчитывает удержание, если пересчёт включён.
create or replace function public.set_writeoff_pool_bulk(p_external_ids text[], p_pool text, p_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  a uuid := public.get_active_account_id();
  v uuid := public.get_active_venue_id();
  u uuid := (select auth.uid());
  ids bigint[];
  ext bigint;
  doc record;
  old public.writeoff_pool_assignments%rowtype;
  dep uuid;
  emp uuid;
  after_label jsonb;
  applied integer := 0;
  unchanged integer := 0;
  not_counted integer := 0;
  not_found integer := 0;
  acts jsonb := '[]'::jsonb;
  months text[] := '{}';
  m text;
begin
  if u is null or a is null or v is null
     or not public.has_permission('inventory.view_results')
     or not public.has_permission('inventory.assign_writeoff_pool') then
    raise exception 'Нет доступа к разнесению списаний';
  end if;
  if p_external_ids is null or cardinality(p_external_ids) = 0 then
    raise exception 'Выберите акты списания';
  end if;
  if cardinality(p_external_ids) > 1000 then
    raise exception 'За один раз можно разнести не больше 1000 актов';
  end if;
  if exists (select 1 from unnest(p_external_ids) x where x is null or x !~ '^[1-9][0-9]{0,17}$') then
    raise exception 'Проверьте номер акта';
  end if;
  -- По возрастанию: строки пометок блокируются в одном порядке у параллельных команд.
  select array_agg(distinct x::bigint order by x::bigint) into ids from unnest(p_external_ids) x;

  if p_pool is null then
    raise exception 'Не указан плательщик';
  elsif p_pool not in ('shared', 'department', 'personal', 'excluded') then
    raise exception 'Проверьте плательщика';
  elsif p_pool in ('shared', 'excluded') and p_key is not null then
    raise exception 'Для этого варианта сотрудник и подразделение не указываются';
  elsif p_pool = 'department' then
    if p_key is null or not exists (
      select 1 from public.departments d
      where d.id = p_key and d.venue_id = v and d.archived_at is null
    ) then
      raise exception 'Подразделение не найдено в этом заведении';
    end if;
    dep := p_key;
  elsif p_pool = 'personal' then
    if p_key is null or not exists (
      select 1 from public.payroll_employees e
      where e.id = p_key and e.account_id = a and e.venue_id = v
    ) then
      raise exception 'Сотрудник не найден в этом заведении';
    end if;
    emp := p_key;
  end if;
  after_label := private.writeoff_pool_audit_label(p_pool, dep, emp);

  foreach ext in array ids loop
    select d.business_date, d.missing_at, d.payload->>'number' as number,
           coalesce(d.payload->>'processed', '') = 'true' as processed
      into doc
    from public.stock_writeoff_documents d
    where d.account_id = a and d.venue_id = v and d.external_id = ext;
    if not found then
      not_found := not_found + 1;
      continue;
    end if;
    if doc.missing_at is not null or not doc.processed then
      not_counted := not_counted + 1;
      continue;
    end if;

    select * into old from public.writeoff_pool_assignments
    where account_id = a and venue_id = v and external_id = ext
    for update;
    if old.id is not null and old.pool = p_pool
       and old.department_id is not distinct from dep
       and old.employee_id is not distinct from emp then
      unchanged := unchanged + 1;
      continue;
    end if;

    insert into public.writeoff_pool_assignments
      (account_id, venue_id, external_id, pool, department_id, employee_id, assigned_by)
    values (a, v, ext, p_pool, dep, emp, u)
    on conflict (account_id, venue_id, external_id) do update set
      pool = excluded.pool,
      department_id = excluded.department_id,
      employee_id = excluded.employee_id,
      assigned_by = excluded.assigned_by,
      updated_at = now();
    applied := applied + 1;
    acts := acts || jsonb_build_array(jsonb_build_object(
      'externalId', ext,
      'number', doc.number,
      'before', case when old.id is null then null
        else private.writeoff_pool_audit_label(old.pool, old.department_id, old.employee_id) end));
    m := to_char(date_trunc('month', doc.business_date), 'YYYY-MM-DD');
    if not (m = any (months)) then
      months := months || m;
    end if;
  end loop;

  -- Одна строка журнала на команду, со списком изменённых актов.
  if applied > 0 then
    insert into public.audit_logs (account_id, venue_id, user_id, action_code, entity_type, entity_id, details)
    values (a, v, u, 'stock.writeoffs.pool_bulk_assigned', 'stock_writeoff_source', v,
      jsonb_build_object(
        'count', applied,
        'skipped', unchanged + not_counted + not_found,
        'after', after_label,
        'acts', acts));
  end if;

  return jsonb_build_object(
    'applied', applied,
    'unchanged', unchanged,
    'notCounted', not_counted,
    'notFound', not_found,
    'months', to_jsonb(months));
end;
$$;
revoke all on function public.set_writeoff_pool_bulk(text[], text, uuid) from public, anon;
grant execute on function public.set_writeoff_pool_bulk(text[], text, uuid) to authenticated;

-- 4. Плательщики для выбора: как в 308, плюс ID сотрудника в Quick Resto.
create or replace function public.writeoff_pool_targets()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  a uuid := public.get_active_account_id();
  v uuid := public.get_active_venue_id();
  can_assign boolean;
begin
  if (select auth.uid()) is null or a is null or v is null
     or not public.has_permission('inventory.view_results') then
    raise exception 'Нет доступа к списаниям';
  end if;
  can_assign := public.has_permission('inventory.assign_writeoff_pool');
  return jsonb_build_object(
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'archived', d.archived_at is not null) order by d.name, d.id)
      from public.departments d
      where d.venue_id = v
        and ((can_assign and d.archived_at is null)
             or d.id in (select w.department_id from public.writeoff_pool_assignments w
                          where w.account_id = a and w.venue_id = v and w.department_id is not null))
    ), '[]'::jsonb),
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'active', e.active, 'quickrestoId', e.quickresto_id) order by e.name, e.id)
      from public.payroll_employees e
      where e.account_id = a and e.venue_id = v
        and (can_assign
             or e.id in (select w.employee_id from public.writeoff_pool_assignments w
                          where w.account_id = a and w.venue_id = v and w.employee_id is not null))
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.writeoff_pool_targets() from public, anon;
grant execute on function public.writeoff_pool_targets() to authenticated;

-- Проверяем результат: от роли-не-владельца REVOKE/GRANT дают только WARNING.
do $$
begin
  if has_function_privilege('anon', 'public.set_writeoff_pool(text, text, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_writeoff_pool_bulk(text[], text, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.writeoff_pool_targets()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.writeoff_pool_audit_label(text, uuid, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'private.writeoff_pool_audit_label(text, uuid, uuid)', 'EXECUTE')
  then
    raise exception 'Функции разнесения списаний доступны лишним ролям: применяйте от владельца функций';
  end if;
  if not has_function_privilege('authenticated', 'public.set_writeoff_pool(text, text, uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.set_writeoff_pool_bulk(text[], text, uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.writeoff_pool_targets()', 'EXECUTE')
  then
    raise exception 'Функции разнесения списаний недоступны authenticated: применяйте от владельца функций';
  end if;
  if (select c.confdeltype from pg_constraint c
      where c.conrelid = 'public.writeoff_pool_assignments'::regclass
        and c.conname = 'writeoff_pool_assignments_department_id_fkey') is distinct from 'a' then
    raise exception 'Внешний ключ на подразделение не переведён в no action';
  end if;
end $$;

commit;
