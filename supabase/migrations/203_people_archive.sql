-- ============================================================
-- 203_people_archive.sql
-- Pass E (docs/CONVENTIONS.md §2): departments + roles переходят на
-- унифицированный archive-lifecycle. venue_halls остаются на простом
-- hard-delete (нет смысла архивировать «зал» — это просто слот в плане).
--
-- Шаги для departments + roles (по образцу 200/202):
--   1) archived_at + archived_by колонки.
--   2) RLS *_select сужается archived_at IS NULL, добавляется
--      *_select_archived_owner.
--   3) Audit-triggers расширяются ветвью archived/restored на переходах
--      archived_at; DELETE-ветвь уже есть (миграция 154 для roles, 158
--      для departments).
--   4) Permissions: people.delete_role / people.delete_department —
--      owner-only для hard-delete (отделено от .manage).
-- ============================================================

-- ── Колонки на departments ────────────────────────────────────
alter table public.departments
  add column if not exists archived_at timestamptz null,
  add column if not exists archived_by uuid null
    references public.profiles(id) on delete set null;

comment on column public.departments.archived_at is
  'Soft-archive: NOT NULL — отдел скрыт. Видно в /people/departments/archive.';

create index if not exists departments_venue_active_idx
  on public.departments (venue_id)
  where archived_at is null;

-- ── Колонки на roles ──────────────────────────────────────────
alter table public.roles
  add column if not exists archived_at timestamptz null,
  add column if not exists archived_by uuid null
    references public.profiles(id) on delete set null;

comment on column public.roles.archived_at is
  'Soft-archive для venue-scoped ролей. Системные (venue_id IS NULL) — '
  'неархивируемы (гард в триггере).';

-- roles не имеет account_id — индекс по venue_id (system-роли: venue_id IS NULL).
create index if not exists roles_venue_active_idx
  on public.roles (venue_id)
  where archived_at is null;

-- ── Гард на архивации system-ролей: venue_id IS NULL ────────
-- System-роли (venue_id IS NULL) нельзя архивировать — это базовый
-- набор для всего продукта. Триггер блокирует UPDATE archived_at.
create or replace function public.roles_guard_system_archive()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if NEW.archived_at is not null and NEW.venue_id is null then
    raise exception 'Системные роли (venue_id IS NULL) не могут быть архивированы';
  end if;
  return NEW;
end;
$$;

drop trigger if exists roles_guard_system_archive on public.roles;
create trigger roles_guard_system_archive
  before insert or update of archived_at on public.roles
  for each row
  execute function public.roles_guard_system_archive();

-- ── Codex P1 #376: owner-only гард на UPDATE archived_at ──────
-- RLS update-policy (roles_update_manage / dep_update_manage) разрешают
-- любые UPDATE при наличии manage_roles — manager без owner-доступа
-- мог бы архивировать роль/отдел прямо через PostgREST, минуя
-- server-action owner-check. Триггеры блокируют не-owner для смены
-- archived_at. Тот же подход — для hard-delete через RLS-policy ниже.
create or replace function public.roles_guard_archive_owner_only()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_is_owner boolean;
begin
  v_is_owner := exists (
    select 1 from public.accounts
    where id = public.venue_account_id(NEW.venue_id)
      and owner_id = auth.uid()
  );
  if not v_is_owner then
    raise exception 'Архивирование/восстановление роли доступно только владельцу аккаунта';
  end if;
  return NEW;
end;
$$;

drop trigger if exists roles_guard_archive_owner_only on public.roles;
create trigger roles_guard_archive_owner_only
  before update of archived_at on public.roles
  for each row
  when (OLD.archived_at is distinct from NEW.archived_at)
  execute function public.roles_guard_archive_owner_only();

create or replace function public.departments_guard_archive_owner_only()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_is_owner boolean;
begin
  v_is_owner := exists (
    select 1 from public.accounts
    where id = public.venue_account_id(NEW.venue_id)
      and owner_id = auth.uid()
  );
  if not v_is_owner then
    raise exception 'Архивирование/восстановление отдела доступно только владельцу аккаунта';
  end if;
  return NEW;
end;
$$;

drop trigger if exists departments_guard_archive_owner_only on public.departments;
create trigger departments_guard_archive_owner_only
  before update of archived_at on public.departments
  for each row
  when (OLD.archived_at is distinct from NEW.archived_at)
  execute function public.departments_guard_archive_owner_only();

-- ── Permissions: hard-delete owner-only ───────────────────────
insert into public.permissions (id, code, module, description)
values
  ('10000000-0000-0000-0000-000000000098', 'people.delete_role',
   'people', 'Удалять роли навсегда (hard delete с каскадом по UVR/invitations/role_permissions)'),
  ('10000000-0000-0000-0000-000000000099', 'people.delete_department',
   'people', 'Удалять отделы навсегда (роли отдела отвяжутся)')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r, public.permissions p
where r.code = 'owner' and r.venue_id is null
  and p.code in ('people.delete_role', 'people.delete_department')
on conflict do nothing;

-- ── RLS departments ──────────────────────────────────────────
-- Адаптируем существующую dep_select_member (158/168): добавляем фильтр
-- archived_at IS NULL и отдельную archived_owner-policy.
drop policy if exists "dep_select_member" on public.departments;
create policy "dep_select_member" on public.departments
  for select
  using (
    archived_at is null
    and has_permission('people.view_roles')
    and exists (
      select 1
      from public.user_venue_roles uvr
      join public.venues v on v.id = uvr.venue_id
      where uvr.user_id = (select auth.uid())
        and uvr.status = 'active'
        and v.account_id = venue_account_id(departments.venue_id)
    )
  );

create policy "departments_select_archived_owner" on public.departments
  for select
  using (
    archived_at is not null
    and exists (
      select 1
      from public.venues v
      join public.accounts a on a.id = v.account_id
      where v.id = departments.venue_id
        and a.owner_id = (select auth.uid())
    )
  );

-- ── RLS roles ────────────────────────────────────────────────
-- Адаптируем roles_select из 168 (dual-mode: system venue_id=NULL +
-- venue-scoped). Добавляем archived_at IS NULL фильтр для venue-scoped
-- (system всегда live), + archived_owner-policy для архив-страницы.
drop policy if exists "roles_select" on public.roles;
create policy "roles_select" on public.roles
  for select
  using (
    (
      -- system-роли: venue_id IS NULL, видны всем authed user (как было)
      venue_id is null
      and (select auth.uid()) is not null
    )
    or (
      -- venue-scoped: дополнительно archived_at IS NULL
      venue_id is not null
      and archived_at is null
      and exists (
        select 1
        from public.user_venue_roles uvr
        join public.venues v on v.id = uvr.venue_id
        where uvr.user_id = (select auth.uid())
          and uvr.status = 'active'
          and v.account_id = venue_account_id(roles.venue_id)
      )
    )
  );

create policy "roles_select_archived_owner" on public.roles
  for select
  using (
    archived_at is not null
    and venue_id is not null
    and exists (
      select 1
      from public.venues v
      join public.accounts a on a.id = v.account_id
      where v.id = roles.venue_id
        and a.owner_id = (select auth.uid())
    )
  );

-- ── Audit-triggers: расширяем archive/restore-ветвями ────────
-- roles (154): user-роли = venue_id NOT NULL. Адаптируем по фактическому
-- определению (account_id нет в таблице roles).
create or replace function public.roles_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_payload jsonb;
  v_is_user_role boolean;
begin
  if public.get_active_account_id() is null then
    if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
  end if;

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
    -- archive / restore через archived_at переходы
    if OLD.archived_at is null and NEW.archived_at is not null then
      perform public.log_audit(
        'role.archived', 'role', NEW.id,
        jsonb_build_object('name', NEW.name, 'code', NEW.code, 'archived_by', NEW.archived_by)
      );
      return NEW;
    end if;
    if OLD.archived_at is not null and NEW.archived_at is null then
      perform public.log_audit(
        'role.restored', 'role', NEW.id,
        jsonb_build_object('name', NEW.name, 'code', NEW.code)
      );
      return NEW;
    end if;
    if OLD.name is distinct from NEW.name then
      v_payload := jsonb_build_object(
        'old_name', OLD.name, 'new_name', NEW.name, 'code', NEW.code
      );
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

-- departments (158): аналогично + archive/restore.
-- Существующий триггер должен ловить INSERT/UPDATE/DELETE. Расширяем.
create or replace function public.departments_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_payload jsonb;
begin
  if public.get_active_account_id() is null then
    if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
  end if;

  if TG_OP = 'INSERT' then
    v_payload := jsonb_build_object('name', NEW.name);
    perform public.log_audit('department.created', 'department', NEW.id, v_payload);
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if OLD.archived_at is null and NEW.archived_at is not null then
      perform public.log_audit(
        'department.archived', 'department', NEW.id,
        jsonb_build_object('name', NEW.name, 'archived_by', NEW.archived_by)
      );
      return NEW;
    end if;
    if OLD.archived_at is not null and NEW.archived_at is null then
      perform public.log_audit(
        'department.restored', 'department', NEW.id,
        jsonb_build_object('name', NEW.name)
      );
      return NEW;
    end if;
    if OLD.name is distinct from NEW.name then
      v_payload := jsonb_build_object('old_name', OLD.name, 'new_name', NEW.name);
      perform public.log_audit('department.renamed', 'department', NEW.id, v_payload);
    end if;
    return NEW;
  end if;

  if TG_OP = 'DELETE' then
    v_payload := jsonb_build_object('name', OLD.name);
    perform public.log_audit('department.deleted', 'department', OLD.id, v_payload);
    return OLD;
  end if;

  return NEW;
end;
$$;

-- ── Codex P1 #376: RLS hard-delete owner-only ─────────────────
-- Текущие *_delete_manage policies (миграция 172) разрешают DELETE
-- любому с manage_roles. Ужесточаем до новых owner-only permissions
-- people.delete_role / people.delete_department.
drop policy if exists "roles_delete_manage" on public.roles;
create policy "roles_delete_manage" on public.roles
  for delete
  using (
    has_permission('people.delete_role')
    and venue_id is not null
    and venue_account_id(venue_id) = get_active_account_id()
  );

drop policy if exists "dep_delete_manage" on public.departments;
create policy "dep_delete_manage" on public.departments
  for delete
  using (
    has_permission('people.delete_department')
    and venue_account_id(venue_id) = get_active_account_id()
  );
