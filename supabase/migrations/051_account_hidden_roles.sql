-- ============================================================
-- account_hidden_roles
--
-- Каждый аккаунт может скрыть системные должности, которые ему не
-- нужны (например, заведение без бухгалтера → скрывает «Бухгалтер»).
-- Системные роли живут в общей таблице public.roles с account_id=null
-- и одним рядом обслуживают все аккаунты — физическое удаление
-- невозможно. Скрытие — это per-account оверлей: роль остаётся
-- в БД, но фронт фильтрует её из списка для конкретного аккаунта.
--
-- Owner-роль скрыть нельзя (RPC проверяет).
--
-- Кастомные (account-owned) роли по-прежнему удаляются физически
-- через DELETE FROM roles в существующем deleteRole.
-- ============================================================

create table if not exists public.account_hidden_roles (
  account_id uuid not null references public.accounts(id) on delete cascade,
  role_id    uuid not null references public.roles(id) on delete cascade,
  hidden_at  timestamptz not null default now(),
  hidden_by  uuid references public.profiles(id) on delete set null,
  primary key (account_id, role_id)
);

create index if not exists account_hidden_roles_account_idx
  on public.account_hidden_roles (account_id);

alter table public.account_hidden_roles enable row level security;

-- Read: members of the account see their own hidden list
drop policy if exists "account_hidden_roles_select" on public.account_hidden_roles;
create policy "account_hidden_roles_select"
  on public.account_hidden_roles for select
  using (account_id = public.get_active_account_id());

-- Write: only manage_roles holders can hide/unhide
drop policy if exists "account_hidden_roles_insert" on public.account_hidden_roles;
create policy "account_hidden_roles_insert"
  on public.account_hidden_roles for insert
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('people.manage_roles')
  );

drop policy if exists "account_hidden_roles_delete" on public.account_hidden_roles;
create policy "account_hidden_roles_delete"
  on public.account_hidden_roles for delete
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('people.manage_roles')
  );

grant select, insert, delete on public.account_hidden_roles to authenticated;

-- ============================================================
-- hide_system_role(p_role_id)
-- Helper RPC — скрывает системную роль для активного аккаунта.
-- Owner защищена; кастомные роли в эту функцию не попадут (для них
-- работает обычный DELETE через RLS на public.roles).
-- ============================================================
create or replace function public.hide_system_role(p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_role_account_id uuid;
  v_role_code text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.has_permission('people.manage_roles') then
    raise exception 'Insufficient permissions';
  end if;

  v_account_id := public.get_active_account_id();
  if v_account_id is null then
    raise exception 'Active account is not set';
  end if;

  select r.account_id, r.code into v_role_account_id, v_role_code
  from public.roles r where r.id = p_role_id;

  if not found then
    raise exception 'Role not found';
  end if;
  if v_role_account_id is not null then
    raise exception 'Only system roles can be hidden (custom roles use DELETE)';
  end if;
  if v_role_code = 'owner' then
    raise exception 'Owner role cannot be hidden';
  end if;

  insert into public.account_hidden_roles (account_id, role_id, hidden_by)
  values (v_account_id, p_role_id, auth.uid())
  on conflict (account_id, role_id) do nothing;
end;
$$;

grant execute on function public.hide_system_role(uuid) to authenticated;
