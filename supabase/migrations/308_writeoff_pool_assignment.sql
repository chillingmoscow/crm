-- Разнесение актов списаний по плательщикам: вся команда / подразделение / один сотрудник.
--
-- Пометку ставит человек (обучение агента на накопленных пометках - отдельный проект).
-- Зеркало актов `stock_writeoff_documents` переписывается синхронизацией (payload,
-- source_hash, version, missing_at), поэтому пометка живёт в СВОЕЙ таблице с ключом
-- (account_id, venue_id, external_id) и сознательно без внешнего ключа на зеркало:
-- она переживает и повторное чтение месяца, и исчезновение акта из источника
-- (missing_at), и возвращение акта обратно.
--
-- Право на разнесение отдельное от inventory.view_results: пометка двигает деньги
-- сотрудников, а просмотр журнала такого права давать не должен.
begin;

-- 1. Право. Модуль inventory_documents: по нему триггер
-- apply_default_inventory_permissions_to_role (206) сам выдаст право новым
-- custom_manager / custom_admin, в том числе при посеве ролей нового заведения.
insert into public.permissions (code, module, description)
values (
  'inventory.assign_writeoff_pool',
  'inventory_documents',
  'Разносить акты списаний по плательщикам (вся команда, подразделение или сотрудник)'
)
on conflict (code) do update set
  module = excluded.module,
  description = excluded.description;

-- Существующим ролям - тем, у кого уже есть inventory.adjust_results (владелец,
-- управляющий, администратор и клоны). Триггер срабатывает только на INSERT роли.
insert into public.role_permissions (role_id, permission_id, granted)
select rp.role_id, n.id, true
from public.role_permissions rp
join public.permissions o on o.id = rp.permission_id and o.code = 'inventory.adjust_results'
cross join public.permissions n
where n.code = 'inventory.assign_writeoff_pool'
  and rp.granted
on conflict (role_id, permission_id)
do update set granted = excluded.granted;

-- 2. Таблица пометок.
create table public.writeoff_pool_assignments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  venue_id uuid not null,
  external_id bigint not null check (external_id > 0),
  pool text not null check (pool in ('shared', 'department', 'personal')),
  department_id uuid references public.departments(id) on delete cascade,
  employee_id uuid,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, id),
  unique (account_id, venue_id, external_id),
  foreign key (account_id, venue_id) references public.venues(account_id, id) on delete cascade,
  foreign key (account_id, venue_id, employee_id)
    references public.payroll_employees(account_id, venue_id, id),
  -- Ключ пула обязателен для подразделения и сотрудника и запрещён для общего пула.
  constraint writeoff_pool_assignments_key_check check (
    (pool = 'shared' and department_id is null and employee_id is null)
    or (pool = 'department' and department_id is not null and employee_id is null)
    or (pool = 'personal' and employee_id is not null and department_id is null)
  )
);
-- Покрывает составной FK на заведение (account_id, venue_id) и поиск по акту.
-- Составной FK на сотрудника требует индекса именно в этом порядке колонок.
create index writeoff_pool_assignments_employee on public.writeoff_pool_assignments (account_id, venue_id, employee_id);
create index writeoff_pool_assignments_department on public.writeoff_pool_assignments (department_id) where department_id is not null;
create index writeoff_pool_assignments_assigned_by on public.writeoff_pool_assignments (assigned_by) where assigned_by is not null;

comment on table public.writeoff_pool_assignments is
  'Кто платит за акт списания Quick Resto. Ключ - внешний ID акта; без FK на зеркало, чтобы пережить ресинк и исчезновение акта.';

-- У departments нет account_id, составной FK невозможен: заведение подразделения
-- держит триггер. Удалённое подразделение каскадом снимает пометку - акт снова
-- становится «не разнесён» и виден как неполный месяц, а не уходит в молчаливый пул.
create or replace function private.writeoff_pool_assignment_guard() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
begin
  if new.department_id is not null and not exists (
    select 1 from public.departments d
    where d.id = new.department_id and d.venue_id = new.venue_id
  ) then
    raise exception 'Подразделение относится к другому заведению';
  end if;
  return new;
end;
$$;
revoke all on function private.writeoff_pool_assignment_guard() from public, anon, authenticated, service_role;
create trigger writeoff_pool_assignment_guard
  before insert or update on public.writeoff_pool_assignments
  for each row execute function private.writeoff_pool_assignment_guard();

-- 3. RLS: читать - те, кто видит журнал списаний; писать - только через RPC ниже.
alter table public.writeoff_pool_assignments enable row level security;
revoke all on public.writeoff_pool_assignments from public, anon, authenticated, service_role;
grant select on public.writeoff_pool_assignments to authenticated, service_role;
create policy writeoff_pool_assignments_read on public.writeoff_pool_assignments
  for select to authenticated
  using (
    account_id = (select public.get_active_account_id())
    and venue_id = (select public.get_active_venue_id())
    and (select public.has_permission('inventory.view_results'))
  );

-- 4. Поставить / сменить / снять пометку. p_pool = null снимает её.
-- Заведение берётся из сессии; серверное действие перед вызовом сверяет его с
-- заведением страницы (как остальные stock_* вызовы).
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
  if p_pool is not null and p_pool not in ('shared', 'department', 'personal') then
    raise exception 'Проверьте плательщика';
  end if;
  if not exists (
    select 1 from public.stock_writeoff_documents d
    where d.account_id = a and d.venue_id = v and d.external_id = ext
  ) then
    raise exception 'Акт списания не найден';
  end if;

  if p_pool = 'shared' and p_key is not null then
    raise exception 'Для всей команды сотрудник и подразделение не указываются';
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
  insert into public.audit_logs (account_id, venue_id, user_id, action_code, entity_type, entity_id, details)
  values (a, v, u, 'stock.writeoffs.pool_assigned', 'stock_writeoff_source', v,
    jsonb_build_object(
      'externalId', ext,
      'before', case when old.id is null then null
        else jsonb_build_object('pool', old.pool, 'key', coalesce(old.department_id, old.employee_id)) end,
      'after', case when p_pool is null then null
        else jsonb_build_object('pool', p_pool, 'key', coalesce(dep, emp)) end));
end;
$$;
revoke all on function public.set_writeoff_pool(text, text, uuid) from public, anon;
grant execute on function public.set_writeoff_pool(text, text, uuid) to authenticated;

-- 5. Имена для журнала и список плательщиков для выбора. Подразделения и
-- сотрудники лежат под чужими правами (people.view_roles, зарплатный доступ), а
-- журнал должен показать, кто платит, любому, кто его видит; разносить акты должен
-- уметь тот, у кого есть только это право. Поэтому: тому, кто разносит, - все
-- подразделения и сотрудники заведения; остальным читателям - только те, на кого
-- уже поставлена пометка.
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
      select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'active', e.active) order by e.name, e.id)
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

commit;
