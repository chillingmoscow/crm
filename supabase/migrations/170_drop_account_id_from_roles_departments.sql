-- ─────────────────────────────────────────────────────────────────────────────
-- 170_drop_account_id_from_roles_departments.sql
--
-- Stage D — финал перехода на venue-scoped roles + departments.
-- Stage C (миграция 169) переподключил все UVR/invitations на venue-scoped
-- клоны; legacy строки остались как orphans без активных ссылок. Этот PR:
--   1. Удаляет orphan legacy roles/departments.
--   2. Переписывает все policies/триггеры/RPC, ссылающиеся на
--      roles.account_id / departments.account_id, на venue-only логику.
--   3. Дропает колонки `account_id` из обеих таблиц.
--   4. Делает venue_id NOT NULL (для departments всегда; для roles —
--      через CHECK с исключением для system owner).
--   5. Перевыпускает unique constraints без account_id.
--
-- ВАЖНО: миграция необратимая на уровне БД (дроп колонок). Перед прод-
-- применением — pg_dump бэкап.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Step 1: удаляем orphan legacy ──────────────────────────────────────────

delete from public.roles
  where account_id is not null and venue_id is null;

delete from public.departments
  where account_id is not null and venue_id is null;

-- ── Step 2: перепишем policies на venue-only (DROP старых dependencies) ────

-- 2a. roles policies (зависимости на roles.account_id)
drop policy if exists "roles_select" on public.roles;
create policy "roles_select" on public.roles
  for select
  using (
    -- System owner: venue_id IS NULL — видна любому authenticated.
    (
      venue_id is null
      and (select auth.uid()) is not null
    )
    or
    -- Venue-scoped: caller — active member venue этого аккаунта.
    (
      venue_id is not null
      and exists (
        select 1 from public.user_venue_roles uvr
          join public.venues v on v.id = uvr.venue_id
         where uvr.user_id = (select auth.uid())
           and uvr.status = 'active'
           and v.account_id = public.venue_account_id(roles.venue_id)
      )
    )
  );

drop policy if exists "roles_insert_manage" on public.roles;
create policy "roles_insert_manage"
  on public.roles for insert
  with check (
    public.has_permission('people.manage_roles')
    and venue_id is not null
    and public.venue_account_id(venue_id) = public.get_active_account_id()
  );

drop policy if exists "roles_update_manage" on public.roles;
create policy "roles_update_manage"
  on public.roles for update
  using (
    public.has_permission('people.manage_roles')
    and venue_id is not null
    and public.venue_account_id(venue_id) = public.get_active_account_id()
  );

drop policy if exists "roles_delete_manage" on public.roles;
create policy "roles_delete_manage"
  on public.roles for delete
  using (
    public.has_permission('people.manage_roles')
    and venue_id is not null
    and public.venue_account_id(venue_id) = public.get_active_account_id()
  );

-- 2b. role_permissions policies (зависимости на roles.account_id)
drop policy if exists "role_permissions_insert_manage" on public.role_permissions;
create policy "role_permissions_insert_manage"
  on public.role_permissions for insert
  with check (
    public.has_permission('people.manage_roles')
    and exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.code != 'owner'
        and (
          r.venue_id is null  -- system non-owner (после Stage D таких нет)
          or public.venue_account_id(r.venue_id) = public.get_active_account_id()
        )
    )
  );

drop policy if exists "role_permissions_update_manage" on public.role_permissions;
create policy "role_permissions_update_manage"
  on public.role_permissions for update
  using (
    public.has_permission('people.manage_roles')
    and exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.code != 'owner'
        and (
          r.venue_id is null
          or public.venue_account_id(r.venue_id) = public.get_active_account_id()
        )
    )
  );

drop policy if exists "role_permissions_delete_manage" on public.role_permissions;
create policy "role_permissions_delete_manage"
  on public.role_permissions for delete
  using (
    public.has_permission('people.manage_roles')
    and exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.venue_id is not null
        and public.venue_account_id(r.venue_id) = public.get_active_account_id()
    )
  );

-- 2c. departments policies (зависимости на departments.account_id)
drop policy if exists "dep_select_member" on public.departments;
create policy "dep_select_member"
  on public.departments for select
  using (
    public.has_permission('people.view_roles')
    and exists (
      select 1
      from public.user_venue_roles uvr
      join public.venues v on v.id = uvr.venue_id
      where uvr.user_id = (select auth.uid())
        and uvr.status = 'active'
        and v.account_id = public.venue_account_id(departments.venue_id)
    )
  );

drop policy if exists "dep_insert_manage" on public.departments;
create policy "dep_insert_manage"
  on public.departments for insert
  with check (
    public.has_permission('people.manage_roles')
    and public.venue_account_id(venue_id) = public.get_active_account_id()
  );

drop policy if exists "dep_update_manage" on public.departments;
create policy "dep_update_manage"
  on public.departments for update
  using (
    public.has_permission('people.manage_roles')
    and public.venue_account_id(venue_id) = public.get_active_account_id()
  )
  with check (
    public.has_permission('people.manage_roles')
    and public.venue_account_id(venue_id) = public.get_active_account_id()
  );

drop policy if exists "dep_delete_manage" on public.departments;
create policy "dep_delete_manage"
  on public.departments for delete
  using (
    public.has_permission('people.manage_roles')
    and public.venue_account_id(venue_id) = public.get_active_account_id()
  );

-- ── Step 3: перепишем integrity-триггеры (убираем account_id из watch+body)

create or replace function public.tg_roles_check_department()
returns trigger
language plpgsql
as $$
declare
  v_dept_venue_id uuid;
begin
  if NEW.department_id is null then
    return NEW;
  end if;
  if NEW.venue_id is null then
    raise exception 'Системная роль не может состоять в подразделении (role.code=%)', NEW.code;
  end if;
  select venue_id into v_dept_venue_id
    from public.departments where id = NEW.department_id;
  if v_dept_venue_id is null then
    raise exception 'Подразделение % не найдено', NEW.department_id;
  end if;
  if v_dept_venue_id <> NEW.venue_id then
    raise exception 'Должность и подразделение должны принадлежать одному заведению';
  end if;
  return NEW;
end;
$$;

-- Watch list без account_id (его не будет).
drop trigger if exists trg_roles_check_department on public.roles;
create trigger trg_roles_check_department
  before insert or update of venue_id, department_id on public.roles
  for each row execute function public.tg_roles_check_department();

create or replace function public.tg_departments_check_head_role()
returns trigger
language plpgsql
as $$
declare
  v_role_venue_id     uuid;
  v_role_department_id uuid;
begin
  if NEW.head_role_id is null then
    return NEW;
  end if;
  select venue_id, department_id
    into v_role_venue_id, v_role_department_id
    from public.roles where id = NEW.head_role_id;
  if v_role_department_id is distinct from NEW.id then
    raise exception 'Должность-руководитель должна входить в это подразделение';
  end if;
  if v_role_venue_id is null then
    raise exception 'Руководитель подразделения должен быть привязан к заведению';
  end if;
  if v_role_venue_id <> NEW.venue_id then
    raise exception 'Должность-руководитель должна принадлежать тому же заведению, что и подразделение';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_departments_check_head_role on public.departments;
create trigger trg_departments_check_head_role
  before insert or update of head_role_id, venue_id on public.departments
  for each row execute function public.tg_departments_check_head_role();

-- ── Step 4: перепишем audit-триггеры (убираем зависимость на account_id) ───

create or replace function public.roles_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
  v_is_user_role boolean;
begin
  if public.get_active_account_id() is null then
    if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
  end if;

  -- Логируем только user-роли (venue_id NOT NULL). System owner
  -- (venue_id NULL) меняется только миграциями, в общий журнал не идёт.
  if TG_OP = 'DELETE' then
    v_is_user_role := OLD.venue_id is not null;
  else
    v_is_user_role := NEW.venue_id is not null;
  end if;
  if not v_is_user_role then
    if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
  end if;

  if TG_OP = 'INSERT' then
    v_payload := jsonb_build_object('name', NEW.name, 'code', NEW.code);
    perform public.log_audit('role.created', 'role', NEW.id, v_payload);
    return NEW;
  end if;
  if TG_OP = 'UPDATE' then
    if OLD.name is distinct from NEW.name then
      v_payload := jsonb_build_object('old_name', OLD.name, 'new_name', NEW.name, 'code', NEW.code);
      perform public.log_audit('role.renamed', 'role', NEW.id, v_payload);
    end if;
    return NEW;
  end if;
  if TG_OP = 'DELETE' then
    v_payload := jsonb_build_object('name', OLD.name, 'code', OLD.code);
    perform public.log_audit('role.deleted', 'role', OLD.id, v_payload);
    return OLD;
  end if;
  return NEW;
end;
$$;

create or replace function public.role_permissions_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_name        text;
  v_role_code        text;
  v_role_venue_id    uuid;
  v_perm_code        text;
  v_perm_desc        text;
  v_payload          jsonb;
  v_role_id          uuid;
  v_perm_id          uuid;
  v_granted          boolean;
  v_action           text;
begin
  if public.get_active_account_id() is null then
    if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
  end if;

  if TG_OP = 'INSERT' then
    v_role_id := NEW.role_id; v_perm_id := NEW.permission_id;
    v_granted := NEW.granted; v_action := case when NEW.granted then 'granted' else 'revoked' end;
  elsif TG_OP = 'UPDATE' then
    if OLD.granted is not distinct from NEW.granted then return NEW; end if;
    v_role_id := NEW.role_id; v_perm_id := NEW.permission_id;
    v_granted := NEW.granted; v_action := case when NEW.granted then 'granted' else 'revoked' end;
  else
    v_role_id := OLD.role_id; v_perm_id := OLD.permission_id;
    v_granted := OLD.granted; v_action := 'reset_to_default';
  end if;

  select name, code, venue_id
    into v_role_name, v_role_code, v_role_venue_id
    from public.roles where id = v_role_id;

  -- System role (venue_id NULL) — права меняются только seed-миграциями.
  if v_role_venue_id is null then
    if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
  end if;

  select code, description into v_perm_code, v_perm_desc
    from public.permissions where id = v_perm_id;

  v_payload := jsonb_build_object(
    'role_name', v_role_name, 'role_code', v_role_code,
    'permission_code', v_perm_code, 'permission_description', v_perm_desc,
    'granted', v_granted, 'action', v_action
  );
  perform public.log_audit('role.permissions_changed', 'role', v_role_id, v_payload);
  if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
end;
$$;

-- ── Step 5: переписываем set_role_department (Step 8 в плане) ──────────────

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
  v_role_venue_id      uuid;
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

  select r.venue_id, r.code, r.department_id
    into v_role_venue_id, v_role_code, v_previous_dept_id
  from public.roles r
  where r.id = p_role_id;
  if not found then raise exception 'Role not found'; end if;
  if v_role_venue_id is null then
    raise exception 'System role cannot be attached to a department';
  end if;
  if public.venue_account_id(v_role_venue_id) <> v_active_account_id then
    raise exception 'Role belongs to a different account';
  end if;

  update public.roles set department_id = p_department_id where id = p_role_id;

  if v_previous_dept_id is not null
     and v_previous_dept_id is distinct from p_department_id
  then
    update public.departments
      set head_role_id = null
      where id = v_previous_dept_id and head_role_id = p_role_id;
  end if;
end;
$$;

-- ── Step 6: complete_owner_onboarding → seed_default_venue_roles ───────────

create or replace function public.complete_owner_onboarding(
  p_account_name  text,
  p_account_logo  text,
  p_legal_name    text,
  p_legal_form    public.legal_form_enum,
  p_legal_inn     text,
  p_venue_name    text,
  p_venue_type    public.venue_type,
  p_venue_address text,
  p_venue_phone   text,
  p_venue_website text     default '',
  p_currency      text     default 'RUB',
  p_timezone      text     default 'Europe/Moscow',
  p_working_hours jsonb    default '{}'::jsonb
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_account_id        uuid;
  v_legal_entity_id   uuid;
  v_venue_id          uuid;
  v_owner_role_id     uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select id into v_account_id from public.accounts
    where owner_id = auth.uid() limit 1;
  if v_account_id is null then
    insert into public.accounts (name, logo_url, owner_id)
    values (p_account_name, p_account_logo, auth.uid())
    returning id into v_account_id;
  end if;

  select id into v_legal_entity_id from public.legal_entities
    where account_id = v_account_id order by created_at asc limit 1;
  if v_legal_entity_id is null then
    insert into public.legal_entities (account_id, name, legal_form, inn, created_by)
    values (v_account_id, p_legal_name, p_legal_form,
            nullif(trim(p_legal_inn), ''), auth.uid())
    returning id into v_legal_entity_id;
  end if;

  select id into v_venue_id from public.venues
    where account_id = v_account_id order by created_at asc limit 1;
  if v_venue_id is null then
    insert into public.venues (
      account_id, legal_entity_id, name, type, address, phone, website,
      currency, timezone, working_hours
    ) values (
      v_account_id, v_legal_entity_id,
      p_venue_name, p_venue_type, p_venue_address, p_venue_phone, p_venue_website,
      p_currency, p_timezone, p_working_hours
    )
    returning id into v_venue_id;
  end if;

  select id into v_owner_role_id from public.roles
   where code = 'owner' and venue_id is null;
  if not exists (
    select 1 from public.user_venue_roles
    where user_id = auth.uid() and venue_id = v_venue_id
  ) then
    insert into public.user_venue_roles (user_id, venue_id, role_id)
    values (auth.uid(), v_venue_id, v_owner_role_id);
  end if;

  update public.profiles set active_venue_id = v_venue_id
    where id = auth.uid() and active_venue_id is distinct from v_venue_id;

  perform public.seed_default_venue_roles(v_venue_id);

  return jsonb_build_object(
    'account_id',       v_account_id,
    'legal_entity_id',  v_legal_entity_id,
    'venue_id',         v_venue_id
  );
end;
$$;

-- ── Step 7: drop legacy функции (более не используются) ───────────────────

drop function if exists public.seed_default_account_roles(uuid);

-- `redirect_system_role_permission_write` (миграция 023) перенаправляла
-- write по системным ролям в `account_role_permissions`. После 138 та
-- таблица удалена и trigger ссылается на `r.account_id`, которой мы
-- сейчас дропаем. Сама функция тоже больше не нужна — system role
-- сейчас один (owner), permissions для него меняются только миграциями.
drop trigger if exists trg_role_permissions_redirect_system on public.role_permissions;
drop function if exists public.redirect_system_role_permission_write();

-- ── Step 8: дропаем unique constraints/индексы со старой формой ────────────

alter table public.roles
  drop constraint if exists roles_code_account_venue_unique;
alter table public.departments
  drop constraint if exists departments_name_account_venue_unique;

drop index if exists roles_code_account_legacy_unique;
drop index if exists departments_name_account_legacy_unique;

-- ── Step 9: schema: venue_id NOT NULL + drop account_id ────────────────────

alter table public.roles
  add constraint roles_venue_or_owner_check
  check (venue_id is not null or code = 'owner');

alter table public.departments
  alter column venue_id set not null;

alter table public.roles drop column account_id;
alter table public.departments drop column account_id;

-- ── Step 10: новые unique constraints без account_id ──────────────────────

alter table public.roles
  add constraint roles_code_venue_unique unique (code, venue_id);

alter table public.departments
  add constraint departments_name_venue_unique unique (venue_id, name);
