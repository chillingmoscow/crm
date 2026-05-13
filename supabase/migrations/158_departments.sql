-- ============================================================
-- 158_departments.sql
--
-- Подразделение (department) — группировка должностей (roles)
-- в орг-структуре аккаунта. Примеры: «Бар» объединяет должности
-- «Бармен», «Помощник бармена», «Старший бармен», «Бар-менеджер».
--
-- Модель:
--   • departments — новая account-scoped сущность.
--   • roles.department_id — привязка должности к подразделению
--     (FK с on delete set null, чтобы удаление подразделения не
--     стирало сами должности).
--   • departments.head_role_id — руководящая должность (одна на
--     подразделение). Фактический руководитель в каждом venue
--     выводится через user_venue_roles по этой роли — отдельной
--     таблицы department_heads на этом этапе не заводим.
--
-- Permissions переиспользуются:
--   • people.view_roles  — чтение
--   • people.manage_roles — запись (один админ ведёт и роли, и
--     группировку в подразделения).
--
-- RPC:
--   • get_departments_with_counts() — список подразделений с
--     количеством ролей и фактических сотрудников в активном venue.
--   • get_department_heads(p_department_id) — руководители по venues.
--   • get_venue_staff(p_venue_id) — расширена столбцами
--     department_id / department_name, без изменения сигнатуры
--     существующих столбцов (только append).
-- ============================================================

-- ── 1. Таблица departments ───────────────────────────────────

create table if not exists public.departments (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  name            text not null,
  head_role_id    uuid references public.roles(id) on delete set null,
  icon            text,
  icon_color      text,
  description     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id) on delete set null,
  updated_by      uuid references public.profiles(id) on delete set null,
  constraint departments_name_account_unique unique (account_id, name)
);

create index if not exists departments_account_idx on public.departments (account_id);

comment on table  public.departments              is 'Подразделение: группа должностей (roles) в аккаунте с опциональным руководителем-должностью.';
comment on column public.departments.head_role_id is 'Руководящая должность подразделения. Фактический человек выводится через user_venue_roles в каждом venue.';

-- ── 2. roles.department_id ───────────────────────────────────

alter table public.roles
  add column if not exists department_id uuid
    references public.departments(id) on delete set null;

create index if not exists roles_department_id_idx on public.roles (department_id);

-- ── 3. Триггеры целостности ──────────────────────────────────
--
-- a) roles.department_id допустим только если account_id совпадает
--    с departments.account_id. Системные роли (account_id IS NULL)
--    в подразделения не входят.
-- b) departments.head_role_id (если задан) обязан принадлежать
--    тому же аккаунту И иметь department_id = текущему department.id
--    (нельзя сделать руководителем должность из другого подразделения).

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
  if NEW.account_id is null then
    raise exception 'Системная роль не может состоять в подразделении (role.code=%)', NEW.code;
  end if;
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

drop trigger if exists trg_roles_check_department on public.roles;
create trigger trg_roles_check_department
  before insert or update of department_id, account_id on public.roles
  for each row execute function public.tg_roles_check_department();

create or replace function public.tg_departments_check_head_role()
returns trigger
language plpgsql
as $$
declare
  v_role_account_id   uuid;
  v_role_department_id uuid;
begin
  if NEW.head_role_id is null then
    return NEW;
  end if;
  select account_id, department_id
    into v_role_account_id, v_role_department_id
    from public.roles where id = NEW.head_role_id;
  if v_role_account_id is null then
    raise exception 'Руководитель подразделения должен быть account-scoped должностью';
  end if;
  if v_role_account_id <> NEW.account_id then
    raise exception 'Должность-руководитель должна принадлежать тому же аккаунту, что и подразделение';
  end if;
  -- Должность-руководитель обязана входить в это подразделение.
  if v_role_department_id is distinct from NEW.id then
    raise exception 'Должность-руководитель должна входить в это подразделение';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_departments_check_head_role on public.departments;
create trigger trg_departments_check_head_role
  before insert or update of head_role_id, account_id on public.departments
  for each row execute function public.tg_departments_check_head_role();

-- ── 4. Auto-fill audit-полей created_at/by + updated_at/by ──

create or replace function public.tg_departments_set_created()
returns trigger
language plpgsql
as $$
begin
  if NEW.created_by is null then
    NEW.created_by := auth.uid();
  end if;
  if NEW.updated_by is null then
    NEW.updated_by := auth.uid();
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_departments_set_created on public.departments;
create trigger trg_departments_set_created
  before insert on public.departments
  for each row execute function public.tg_departments_set_created();

create or replace function public.tg_departments_set_updated()
returns trigger
language plpgsql
as $$
begin
  NEW.updated_at := now();
  NEW.updated_by := coalesce(auth.uid(), NEW.updated_by);
  return NEW;
end;
$$;

drop trigger if exists trg_departments_set_updated on public.departments;
create trigger trg_departments_set_updated
  before update on public.departments
  for each row execute function public.tg_departments_set_updated();

-- ── 5. RLS ──────────────────────────────────────────────────

alter table public.departments enable row level security;

drop policy if exists "dep_select_member" on public.departments;
create policy "dep_select_member"
  on public.departments for select
  using (
    public.has_permission('people.view_roles')
    and exists (
      select 1
      from public.user_venue_roles uvr
      join public.venues v on v.id = uvr.venue_id
      where uvr.user_id = auth.uid()
        and uvr.status = 'active'
        and v.account_id = departments.account_id
    )
  );

drop policy if exists "dep_insert_manage" on public.departments;
create policy "dep_insert_manage"
  on public.departments for insert
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('people.manage_roles')
  );

drop policy if exists "dep_update_manage" on public.departments;
create policy "dep_update_manage"
  on public.departments for update
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('people.manage_roles')
  )
  with check (
    account_id = public.get_active_account_id()
    and public.has_permission('people.manage_roles')
  );

drop policy if exists "dep_delete_manage" on public.departments;
create policy "dep_delete_manage"
  on public.departments for delete
  using (
    account_id = public.get_active_account_id()
    and public.has_permission('people.manage_roles')
  );

grant select, insert, update, delete on public.departments to anon, authenticated;

-- ── 6. Audit-логирование (по образцу roles_audit_trigger из 154) ──

create or replace function public.departments_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
begin
  if public.get_active_account_id() is null then
    if TG_OP = 'DELETE' then return OLD; else return NEW; end if;
  end if;

  if TG_OP = 'INSERT' then
    v_payload := jsonb_build_object(
      'name',         NEW.name,
      'head_role_id', NEW.head_role_id
    );
    perform public.log_audit('department.created', 'department', NEW.id, v_payload);
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if OLD.name is distinct from NEW.name then
      v_payload := jsonb_build_object(
        'old_name', OLD.name,
        'new_name', NEW.name
      );
      perform public.log_audit('department.renamed', 'department', NEW.id, v_payload);
    end if;
    if OLD.head_role_id is distinct from NEW.head_role_id then
      v_payload := jsonb_build_object(
        'old_head_role_id', OLD.head_role_id,
        'new_head_role_id', NEW.head_role_id
      );
      perform public.log_audit('department.head_changed', 'department', NEW.id, v_payload);
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

comment on function public.departments_audit_trigger() is
  'Audit-trail для public.departments: created / renamed / head_changed / deleted.';

drop trigger if exists departments_audit on public.departments;
create trigger departments_audit
  after insert or update or delete on public.departments
  for each row execute function public.departments_audit_trigger();

-- ── 7. RPC: список подразделений со счётчиками ──────────────

create or replace function public.get_departments_with_counts(
  p_venue_id uuid default null
)
returns table (
  id              uuid,
  name            text,
  icon            text,
  icon_color      text,
  description     text,
  head_role_id    uuid,
  head_role_name  text,
  roles_count     bigint,
  staff_count     bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with my_account as (
    select public.get_active_account_id() as account_id
  ),
  effective_venue as (
    -- Если venue не указан — берём активный.
    select coalesce(p_venue_id, public.get_active_venue_id()) as venue_id
  )
  select
    d.id,
    d.name,
    d.icon,
    d.icon_color,
    d.description,
    d.head_role_id,
    hr.name as head_role_name,
    coalesce(rc.cnt, 0) as roles_count,
    coalesce(sc.cnt, 0) as staff_count
  from public.departments d
  cross join my_account ma
  cross join effective_venue ev
  left join public.roles hr on hr.id = d.head_role_id
  left join (
    select department_id, count(*)::bigint as cnt
    from public.roles
    where department_id is not null
    group by department_id
  ) rc on rc.department_id = d.id
  left join (
    select r.department_id, count(*)::bigint as cnt
    from public.user_venue_roles uvr
    join public.roles r on r.id = uvr.role_id
    cross join effective_venue ev2
    where uvr.status = 'active'
      and (ev2.venue_id is null or uvr.venue_id = ev2.venue_id)
      and r.department_id is not null
    group by r.department_id
  ) sc on sc.department_id = d.id
  where d.account_id = ma.account_id
  order by d.name;
$$;

comment on function public.get_departments_with_counts(uuid) is
  'Список подразделений активного аккаунта со счётчиками ролей и сотрудников. '
  'staff_count считается по active uvr в указанном (или активном) venue.';

-- ── 8. RPC: фактические руководители подразделения по venues ──

create or replace function public.get_department_heads(p_department_id uuid)
returns table (
  venue_id    uuid,
  venue_name  text,
  user_id     uuid,
  first_name  text,
  last_name   text,
  avatar_url  text,
  role_id     uuid,
  role_name   text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    v.id        as venue_id,
    v.name      as venue_name,
    p.id        as user_id,
    p.first_name,
    p.last_name,
    p.avatar_url,
    r.id        as role_id,
    r.name      as role_name
  from public.departments d
  join public.roles r              on r.id = d.head_role_id
  join public.user_venue_roles uvr on uvr.role_id = r.id and uvr.status = 'active'
  join public.venues v             on v.id = uvr.venue_id and v.account_id = d.account_id
  join public.profiles p           on p.id = uvr.user_id
  where d.id = p_department_id
    and d.account_id = public.get_active_account_id()
  order by v.name, p.last_name, p.first_name;
$$;

comment on function public.get_department_heads(uuid) is
  'Фактические руководители подразделения (active uvr с head_role) по venues аккаунта.';

-- ── 9. Расширяем get_venue_staff: добавляем department_id / department_name ──
--
-- Сигнатура расширяется аппендом — клиенты, уже читавшие старый список
-- столбцов, переживут регенерацию типов: дополнительные колонки попадут
-- в Row-type автоматически.

drop function if exists public.get_venue_staff(uuid);
create function public.get_venue_staff(p_venue_id uuid)
returns table (
  uvr_id          uuid,
  user_id         uuid,
  role_id         uuid,
  role_name       text,
  role_code       text,
  first_name      text,
  last_name       text,
  email           text,
  avatar_url      text,
  phone           text,
  telegram_id     text,
  gender          text,
  birth_date      date,
  employment_date date,
  joined_at       timestamptz,
  department_id   uuid,
  department_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    uvr.id                                                          as uvr_id,
    uvr.user_id,
    uvr.role_id,
    r.name                                                          as role_name,
    r.code                                                          as role_code,
    p.first_name,
    p.last_name,
    au.email,
    p.avatar_url,
    p.phone,
    p.telegram_id,
    p.gender,
    p.birth_date,
    coalesce(sad.employment_date, uvr.created_at::date)             as employment_date,
    uvr.created_at                                                  as joined_at,
    r.department_id                                                 as department_id,
    d.name                                                          as department_name
  from public.user_venue_roles uvr
  join public.profiles  p  on p.id  = uvr.user_id
  join public.roles     r  on r.id  = uvr.role_id
  join public.venues    v  on v.id  = uvr.venue_id
  join auth.users       au on au.id = uvr.user_id
  left join public.staff_account_details sad
    on sad.account_id = v.account_id and sad.user_id = uvr.user_id
  left join public.departments d on d.id = r.department_id
  where uvr.venue_id = p_venue_id
    and uvr.status   = 'active'
    and exists (
      select 1
      from public.user_venue_roles caller_uvr
      where caller_uvr.user_id = auth.uid()
        and caller_uvr.venue_id = p_venue_id
        and caller_uvr.status   = 'active'
    )
  order by uvr.created_at;
$$;

comment on function public.get_venue_staff(uuid) is
  'Список сотрудников venue с привязкой к подразделению (department_id / department_name).';
