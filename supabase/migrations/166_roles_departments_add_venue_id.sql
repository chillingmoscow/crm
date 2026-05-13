-- ─────────────────────────────────────────────────────────────────────────────
-- 166_roles_departments_add_venue_id.sql
--
-- Stage A из плана venue-scoped roles + departments (см.
-- docs/superpowers/specs/2026-05-14-venue-scoped-roles-design.md).
-- Подготавливаем схему: добавляем nullable `venue_id` колонки к `roles` и
-- `departments` + integrity-триггер. Данные пока не двигаем, существующий
-- код не читает venue_id (пока stage B не задеплоен) — миграция полностью
-- backward-compatible.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── roles.venue_id ──────────────────────────────────────────────────────────

alter table public.roles
  add column if not exists venue_id uuid
    references public.venues(id) on delete cascade;

create index if not exists roles_venue_id_idx on public.roles (venue_id);

comment on column public.roles.venue_id is
  'NULL — системная роль (owner после миграции 138). NOT NULL — кастомная '
  'роль конкретного заведения. До stage C может быть NULL для legacy '
  'account-scoped кастомных ролей (по `account_id`).';

-- ── departments.venue_id ────────────────────────────────────────────────────

alter table public.departments
  add column if not exists venue_id uuid
    references public.venues(id) on delete cascade;

create index if not exists departments_venue_id_idx on public.departments (venue_id);

comment on column public.departments.venue_id is
  'Заведение, к которому относится подразделение. До stage C может быть '
  'NULL для legacy account-scoped подразделений (по `account_id`).';

-- ── Обновляем `tg_roles_check_department` из 158 ──────────────────────────
--
-- Старый триггер: «account_id IS NULL = системная роль, не привязываем к
-- подразделению». После добавления venue_id у нас появляются роли с
-- account_id IS NULL + venue_id NOT NULL — это валидные venue-scoped роли,
-- не системные. Старый триггер их некорректно отвергал.
--
-- Новая логика:
--   • System owner: account_id IS NULL AND venue_id IS NULL — не может
--     состоять в подразделении (нет «общего» подразделения).
--   • Legacy account-scoped (account_id NOT NULL, venue_id NULL): старая
--     проверка — account_id роли должен совпадать с account_id департамента.
--   • Venue-scoped (venue_id NOT NULL): проверку делает новый триггер
--     tg_roles_check_venue_department ниже.

create or replace function public.tg_roles_check_department()
returns trigger
language plpgsql
as $$
declare
  v_dept_account_id uuid;
begin
  if NEW.department_id is null then
    return NEW;
  end if;

  -- Venue-scoped роли проверяет tg_roles_check_venue_department, здесь
  -- пропускаем чтобы не дублировать (и не падать на account_id IS NULL).
  if NEW.venue_id is not null then
    return NEW;
  end if;

  -- System owner (без account, без venue) — в подразделение нельзя.
  if NEW.account_id is null then
    raise exception 'Системная роль не может состоять в подразделении (role.code=%)', NEW.code;
  end if;

  -- Legacy account-scoped: account_id роли должен совпадать с account_id
  -- подразделения.
  select account_id into v_dept_account_id
    from public.departments where id = NEW.department_id;
  if v_dept_account_id is null then
    raise exception 'Подразделение % не найдено', NEW.department_id;
  end if;
  if v_dept_account_id <> NEW.account_id then
    raise exception 'Роль и подразделение должны принадлежать одному аккаунту';
  end if;
  return NEW;
end;
$$;

-- ── Integrity trigger: role и её department должны быть в одном venue ──────
--
-- Если у роли заполнен venue_id и она привязана к подразделению
-- (department_id NOT NULL), то venue_id подразделения должен совпадать.
-- В stage A это soft-check: если department.venue_id ещё NULL (legacy),
-- триггер пропускает. После stage C departments всегда venue_id NOT NULL,
-- проверка станет строгой автоматически.

create or replace function public.tg_roles_check_venue_department()
returns trigger
language plpgsql
as $$
declare
  v_dept_venue_id uuid;
begin
  if NEW.department_id is null or NEW.venue_id is null then
    return NEW;
  end if;
  select venue_id into v_dept_venue_id
    from public.departments where id = NEW.department_id;
  if v_dept_venue_id is not null and v_dept_venue_id <> NEW.venue_id then
    raise exception 'Должность и подразделение должны принадлежать одному заведению (role.venue_id=%, department.venue_id=%)',
      NEW.venue_id, v_dept_venue_id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_roles_check_venue_department on public.roles;
create trigger trg_roles_check_venue_department
  before insert or update of venue_id, department_id on public.roles
  for each row execute function public.tg_roles_check_venue_department();

-- ── Обновляем `tg_departments_check_head_role` из 158 ──────────────────────
--
-- Аналогичная адаптация: для venue-scoped департамента head_role тоже
-- должна быть venue-scoped в том же venue. Триггер из 158 проверял
-- account_id — это ломается для venue-scoped пар.
--
-- Новая логика:
--   • Venue-scoped department (venue_id NOT NULL): head_role.venue_id =
--     NEW.venue_id + head_role.department_id = NEW.id.
--   • Legacy account-scoped (venue_id NULL): старая проверка по account_id.

-- ── Обновляем RPC `set_role_department` из 165 ─────────────────────────────
--
-- Та же проблема: проверка «account_id IS NULL → системная роль» теперь
-- false negative для venue-scoped ролей. Учитываем оба варианта.

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

  select r.account_id, r.venue_id, r.code, r.department_id
    into v_role_account_id, v_role_venue_id, v_role_code, v_previous_dept_id
  from public.roles r
  where r.id = p_role_id;

  if not found then
    raise exception 'Role not found';
  end if;

  -- System owner: account_id IS NULL AND venue_id IS NULL.
  if v_role_account_id is null and v_role_venue_id is null then
    raise exception 'System role cannot be attached to a department';
  end if;

  -- Legacy account-scoped: верифицируем принадлежность активному аккаунту.
  if v_role_account_id is not null and v_role_account_id <> v_active_account_id then
    raise exception 'Role belongs to a different account';
  end if;

  -- Venue-scoped: верифицируем что venue принадлежит активному аккаунту.
  if v_role_venue_id is not null then
    if not exists (
      select 1 from public.venues
      where id = v_role_venue_id and account_id = v_active_account_id
    ) then
      raise exception 'Role belongs to a different account';
    end if;
  end if;

  update public.roles
    set department_id = p_department_id
    where id = p_role_id;

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

create or replace function public.tg_departments_check_head_role()
returns trigger
language plpgsql
as $$
declare
  v_role_account_id   uuid;
  v_role_venue_id     uuid;
  v_role_department_id uuid;
begin
  if NEW.head_role_id is null then
    return NEW;
  end if;
  select account_id, venue_id, department_id
    into v_role_account_id, v_role_venue_id, v_role_department_id
    from public.roles where id = NEW.head_role_id;

  -- Должность-руководитель обязана входить в это подразделение (общая
  -- проверка для обоих режимов).
  if v_role_department_id is distinct from NEW.id then
    raise exception 'Должность-руководитель должна входить в это подразделение';
  end if;

  -- Venue-scoped департамент.
  if NEW.venue_id is not null then
    if v_role_venue_id is null then
      raise exception 'Руководитель venue-scoped подразделения должен быть привязан к этому же заведению';
    end if;
    if v_role_venue_id <> NEW.venue_id then
      raise exception 'Должность-руководитель должна принадлежать тому же заведению, что и подразделение';
    end if;
    return NEW;
  end if;

  -- Legacy account-scoped департамент.
  if v_role_account_id is null then
    raise exception 'Руководитель подразделения должен быть account-scoped должностью';
  end if;
  if v_role_account_id <> NEW.account_id then
    raise exception 'Должность-руководитель должна принадлежать тому же аккаунту, что и подразделение';
  end if;
  return NEW;
end;
$$;

-- Симметричный триггер на departments: если меняем department.venue_id,
-- то все привязанные роли должны быть в этом же venue (или ещё не
-- мигрированы — venue_id NULL).

create or replace function public.tg_departments_check_venue_consistency()
returns trigger
language plpgsql
as $$
declare
  v_mismatch_count int;
begin
  if NEW.venue_id is null then
    return NEW;
  end if;
  -- Если есть привязанные роли с venue_id, которое не совпадает — error.
  select count(*) into v_mismatch_count
    from public.roles r
    where r.department_id = NEW.id
      and r.venue_id is not null
      and r.venue_id <> NEW.venue_id;
  if v_mismatch_count > 0 then
    raise exception 'Подразделение нельзя перевести в заведение, где находятся не все привязанные должности (% несовпадений)',
      v_mismatch_count;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_departments_check_venue_consistency on public.departments;
create trigger trg_departments_check_venue_consistency
  before insert or update of venue_id on public.departments
  for each row execute function public.tg_departments_check_venue_consistency();
