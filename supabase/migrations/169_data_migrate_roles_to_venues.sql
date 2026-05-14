-- ─────────────────────────────────────────────────────────────────────────────
-- 169_data_migrate_roles_to_venues.sql
--
-- Stage C из плана venue-scoped roles + departments. Клонирует существующие
-- legacy account-scoped роли и подразделения на каждый venue соответствующего
-- аккаунта, переподключает UVR / invitations / department_id / head_role_id.
--
-- После применения:
--   • UVR указывают на venue-specific клоны (вместо legacy).
--   • invitations — то же.
--   • Cloned roles.department_id ссылается на cloned dept того же venue.
--   • Cloned departments.head_role_id ссылается на cloned role того же venue.
--   • Legacy записи (account_id NOT NULL, venue_id NULL) остаются как
--     orphans — удаляются в Stage D.
--
-- ВАЖНО: миграция необратимая на уровне БД. Перед применением на проде
-- обязателен pg_dump бэкап.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Step 1: расширить unique constraints на venue_id ───────────────────────
-- Иначе клоны двух venues одного аккаунта с одинаковым code/name нарушат
-- (code, account_id) / (account_id, name) unique.

alter table public.roles
  drop constraint if exists roles_code_account_unique;
alter table public.roles
  add constraint roles_code_account_venue_unique unique (code, account_id, venue_id);

alter table public.departments
  drop constraint if exists departments_name_account_unique;
alter table public.departments
  add constraint departments_name_account_venue_unique unique (account_id, venue_id, name);

-- Partial-unique для legacy строк (Codex P1 на #302). Postgres NULLS DISTINCT
-- по умолчанию делает `(code='X', account_id=Y, venue_id=NULL)` уникальным
-- от другой такой же — legacy инвариант «один code на account» рушится в
-- окне между Stage C и Stage D. Партиальные индексы покрывают только
-- venue_id IS NULL и восстанавливают legacy ограничение, не мешая
-- venue-scoped клонам.

create unique index if not exists roles_code_account_legacy_unique
  on public.roles (code, account_id)
  where venue_id is null;

create unique index if not exists departments_name_account_legacy_unique
  on public.departments (account_id, name)
  where venue_id is null;

-- ── Step 2: clone roles per venue (без department_id) ──────────────────────
--
-- legacy role: account_id NOT NULL, venue_id NULL.
-- system owner: account_id NULL, venue_id NULL — не трогаем.
-- Уже venue-scoped (созданные через Stage B UI): venue_id NOT NULL — skip.

create temp table _role_clones (
  legacy_role_id  uuid not null,
  venue_id        uuid not null,
  new_role_id     uuid not null,
  primary key (legacy_role_id, venue_id)
);

do $$
declare
  v_legacy record;
  v_venue_id uuid;
  v_new_role_id uuid;
begin
  for v_legacy in
    select id, account_id, name, code, comment, icon, icon_color,
           created_at, created_by
      from public.roles
     where account_id is not null and venue_id is null
  loop
    for v_venue_id in
      select id from public.venues where account_id = v_legacy.account_id
    loop
      insert into public.roles
        (account_id, venue_id, name, code, comment, icon, icon_color,
         created_at, created_by, department_id)
      values
        (v_legacy.account_id, v_venue_id, v_legacy.name, v_legacy.code,
         v_legacy.comment, v_legacy.icon, v_legacy.icon_color,
         v_legacy.created_at, v_legacy.created_by, null)
      returning id into v_new_role_id;

      insert into _role_clones (legacy_role_id, venue_id, new_role_id)
      values (v_legacy.id, v_venue_id, v_new_role_id);
    end loop;
  end loop;
end $$;

-- Bulk-clone role_permissions для всех клонов
insert into public.role_permissions (role_id, permission_id, granted)
select rc.new_role_id, rp.permission_id, rp.granted
  from _role_clones rc
  join public.role_permissions rp on rp.role_id = rc.legacy_role_id;

-- ── Step 3: clone departments per venue (без head_role_id) ─────────────────

create temp table _dept_clones (
  legacy_dept_id  uuid not null,
  venue_id        uuid not null,
  new_dept_id     uuid not null,
  primary key (legacy_dept_id, venue_id)
);

do $$
declare
  v_legacy record;
  v_venue_id uuid;
  v_new_dept_id uuid;
begin
  for v_legacy in
    select id, account_id, name, icon, icon_color, description,
           created_at, created_by
      from public.departments
     where account_id is not null and venue_id is null
  loop
    for v_venue_id in
      select id from public.venues where account_id = v_legacy.account_id
    loop
      insert into public.departments
        (account_id, venue_id, name, icon, icon_color, description,
         created_at, created_by, head_role_id)
      values
        (v_legacy.account_id, v_venue_id, v_legacy.name, v_legacy.icon,
         v_legacy.icon_color, v_legacy.description,
         v_legacy.created_at, v_legacy.created_by, null)
      returning id into v_new_dept_id;

      insert into _dept_clones (legacy_dept_id, venue_id, new_dept_id)
      values (v_legacy.id, v_venue_id, v_new_dept_id);
    end loop;
  end loop;
end $$;

-- ── Step 4: cross-link clones ──────────────────────────────────────────────

-- cloned_role.department_id = соответствующий cloned_dept того же venue
-- (берём department legacy_role'а, ищем его клон в этом venue).
update public.roles r
   set department_id = dc.new_dept_id
  from _role_clones rc
  join public.roles legacy_role on legacy_role.id = rc.legacy_role_id
  join _dept_clones dc
    on dc.legacy_dept_id = legacy_role.department_id
   and dc.venue_id = rc.venue_id
 where r.id = rc.new_role_id;

-- cloned_dept.head_role_id = соответствующий cloned_role того же venue
update public.departments d
   set head_role_id = rc.new_role_id
  from _dept_clones dc
  join public.departments legacy_dept on legacy_dept.id = dc.legacy_dept_id
  join _role_clones rc
    on rc.legacy_role_id = legacy_dept.head_role_id
   and rc.venue_id = dc.venue_id
 where d.id = dc.new_dept_id;

-- ── Step 5: repoint UVR и invitations на cloned roles ──────────────────────

update public.user_venue_roles uvr
   set role_id = rc.new_role_id
  from _role_clones rc
 where uvr.role_id = rc.legacy_role_id
   and uvr.venue_id = rc.venue_id;

update public.invitations inv
   set role_id = rc.new_role_id
  from _role_clones rc
 where inv.role_id = rc.legacy_role_id
   and inv.venue_id = rc.venue_id;

-- ── Cleanup temp tables ────────────────────────────────────────────────────

drop table _role_clones;
drop table _dept_clones;

-- ── Sanity check (no-op in normal case, для логирования количеств) ────────

do $$
declare
  v_legacy_roles int;
  v_legacy_depts int;
  v_venue_roles int;
  v_venue_depts int;
begin
  select count(*) into v_legacy_roles from public.roles
    where account_id is not null and venue_id is null;
  select count(*) into v_legacy_depts from public.departments
    where account_id is not null and venue_id is null;
  select count(*) into v_venue_roles from public.roles where venue_id is not null;
  select count(*) into v_venue_depts from public.departments where venue_id is not null;
  raise notice 'After migration: legacy roles=%, legacy depts=%, venue roles=%, venue depts=%',
    v_legacy_roles, v_legacy_depts, v_venue_roles, v_venue_depts;
end $$;
