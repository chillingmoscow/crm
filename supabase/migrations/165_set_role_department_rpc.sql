-- ============================================================
-- 165_set_role_department_rpc.sql
--
-- Atomic RPC `set_role_department(p_role_id, p_department_id)`.
--
-- Зачем: setRoleDepartment в actions.ts делает два UPDATE'а — сначала
-- roles.department_id, потом (если эта роль была head'ом в прежнем
-- подразделении) departments.head_role_id = NULL. Между этими двумя
-- HTTP-запросами supabase-js нет общей транзакции — если второй
-- падает, в БД остаётся stale-state (Codex P2 на PR #299).
--
-- Внутри RPC оба UPDATE'а в одной серверной транзакции. Любая ошибка
-- (RLS, триггер) ↦ rollback, никакого partial-write. security definer
-- + явная проверка `has_permission('people.manage_roles')`, как
-- copy_role_permissions из миграции 049.
-- ============================================================

create or replace function public.set_role_department(
  p_role_id        uuid,
  p_department_id  uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active_account_id  uuid;
  v_role_account_id    uuid;
  v_role_code          text;
  v_previous_dept_id   uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.has_permission('people.manage_roles') then
    raise exception 'Insufficient permissions';
  end if;

  v_active_account_id := public.get_active_account_id();
  if v_active_account_id is null then
    raise exception 'Active account is not set';
  end if;

  -- Role guard: должна существовать, быть account-scoped, и принадлежать
  -- активному аккаунту. Системные роли (account_id IS NULL) не имеют
  -- подразделения по бизнес-правилу.
  select r.account_id, r.code, r.department_id
    into v_role_account_id, v_role_code, v_previous_dept_id
  from public.roles r
  where r.id = p_role_id;

  if not found then
    raise exception 'Role not found';
  end if;

  if v_role_account_id is null then
    raise exception 'System role cannot be attached to a department';
  end if;

  if v_role_account_id <> v_active_account_id then
    raise exception 'Role belongs to a different account';
  end if;

  -- Основное действие: меняем привязку.
  update public.roles
    set department_id = p_department_id
    where id = p_role_id;

  -- Очистка stale head_role_id. Если эта роль была руководящей
  -- в прежнем подразделении — обнуляем там head_role_id. Иначе
  -- остаётся «висящая» ссылка: подразделение указывает на роль,
  -- которой в нём уже нет. Симптом — selects и save валятся на
  -- trg_departments_check_head_role.
  if v_previous_dept_id is not null
     and v_previous_dept_id is distinct from p_department_id
  then
    update public.departments
      set head_role_id = null
      where id = v_previous_dept_id
        and head_role_id = p_role_id;
  end if;
end;
$$;

comment on function public.set_role_department(uuid, uuid) is
  'Атомарно меняет roles.department_id и обнуляет departments.head_role_id '
  'в прежнем подразделении, если эта роль была там head''ом. Single TX, '
  'security definer + has_permission(people.manage_roles).';

grant execute on function public.set_role_department(uuid, uuid)
  to authenticated;
