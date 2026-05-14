-- ============================================================
-- 173_fix_functions_after_drop_account_id.sql
--
-- Hotfix после миграции 172. ALTER TABLE DROP COLUMN account_id у
-- roles/departments прошёл, но Postgres НЕ инвалидирует тела SQL-/
-- plpgsql-функций — они спокойно остаются с битыми ссылками и падают
-- только при вызове. Симптомы на проде после Stage D:
--   * Sidebar показывает «Выберите заведение» даже у юзера-владельца
--     с одним venue — `get_user_venues()` падает на `r.account_id`,
--     RPC возвращает [], layout рендерит пустой селектор.
--   * Создание подразделения падает с
--     "duplicate key value violates unique constraint
--      departments_name_venue_unique" — миграция 169 уже склонировала
--     dept на venue, но UI это не показывает (`get_departments_with_counts`
--     тоже падает), юзер вводит то же имя.
--
-- Также по пути чиним две kb-функции — они ссылаются на удалённую
-- (в миграции 138) таблицу `account_role_permissions` и были сломаны
-- ещё ДО Stage D. Удаляем override-JOIN, granted читаем напрямую из
-- `role_permissions` (теперь это единственный источник истины).
-- ============================================================

-- ── 1. get_user_venues ─────────────────────────────────────────────
-- Owner-ветка: системная роль теперь идентифицируется парой
-- (code = 'owner', venue_id IS NULL). Раньше было `account_id IS NULL`.
drop function if exists public.get_user_venues();
create or replace function public.get_user_venues()
returns table (
  venue_id   uuid,
  venue_name text,
  venue_type text,
  role_code  text,
  role_name  text
)
language sql
stable
security definer
set search_path = public
as $$
  -- Active staff entries via user_venue_roles.
  select
    v.id           as venue_id,
    v.name         as venue_name,
    v.type::text   as venue_type,
    r.code         as role_code,
    r.name         as role_name
  from public.user_venue_roles uvr
  join public.venues v on v.id = uvr.venue_id
  join public.roles  r on r.id = uvr.role_id
  where uvr.user_id = auth.uid()
    and uvr.status  = 'active'

  union

  -- Owner venues: видимы даже без UVR — owner идентифицируется по
  -- (code='owner', venue_id IS NULL) после Stage D.
  select
    v.id           as venue_id,
    v.name         as venue_name,
    v.type::text   as venue_type,
    r.code         as role_code,
    r.name         as role_name
  from public.venues v
  join public.accounts a on a.id = v.account_id
  join public.roles    r on r.code = 'owner' and r.venue_id is null
  where a.owner_id = auth.uid();
$$;

-- ── 2. get_effective_role_permissions ──────────────────────────────
-- `account_role_permissions` (override) уже удалена в 138 — функция
-- просто возвращает row'ы из role_permissions для допустимых ролей.
-- Допустимые = owner (системная, venue_id IS NULL) или venue этого
-- аккаунта.
create or replace function public.get_effective_role_permissions(
  p_role_ids uuid[] default null
)
returns table (role_id uuid, permission_id uuid, granted boolean)
language sql
stable
security definer
set search_path = public
as $$
  select rp.role_id, rp.permission_id, rp.granted
  from public.role_permissions rp
  join public.roles r on r.id = rp.role_id
  where (p_role_ids is null or rp.role_id = any(p_role_ids))
    and (
      r.venue_id is null
      or public.venue_account_id(r.venue_id) = public.get_active_account_id()
    );
$$;

-- ── 3. set_effective_role_permission ───────────────────────────────
-- Target должен быть кастомной venue-scoped ролью текущего аккаунта.
create or replace function public.set_effective_role_permission(
  p_role_id       uuid,
  p_permission_id uuid,
  p_granted       boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id      uuid;
  v_role_venue_id   uuid;
  v_role_code       text;
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

  select r.venue_id, r.code into v_role_venue_id, v_role_code
  from public.roles r
  where r.id = p_role_id;
  if not found then raise exception 'Role not found'; end if;

  if v_role_code = 'owner' then
    raise exception 'Owner role cannot be modified';
  end if;
  if v_role_venue_id is null then
    -- Защитный гард: единственная системная роль после Stage D — owner,
    -- и она уже отрезана выше. Сюда попасть нельзя.
    raise exception 'System roles больше не редактируются';
  end if;
  if public.venue_account_id(v_role_venue_id) <> v_account_id then
    raise exception 'Role is outside active account';
  end if;

  insert into public.role_permissions (role_id, permission_id, granted)
  values (p_role_id, p_permission_id, p_granted)
  on conflict (role_id, permission_id)
  do update set granted = excluded.granted;
end;
$$;

-- ── 4. copy_role_permissions ───────────────────────────────────────
-- Source: owner (системная) или роль venue этого аккаунта.
-- Target: venue-scoped роль того же аккаунта, не owner.
create or replace function public.copy_role_permissions(
  p_source_role_id uuid,
  p_target_role_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id        uuid;
  v_source_venue_id   uuid;
  v_source_code       text;
  v_target_venue_id   uuid;
  v_target_code       text;
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

  select r.venue_id, r.code into v_source_venue_id, v_source_code
  from public.roles r where r.id = p_source_role_id;
  if not found then raise exception 'Source role not found'; end if;
  if v_source_venue_id is not null
     and public.venue_account_id(v_source_venue_id) <> v_account_id then
    raise exception 'Source role is outside active account';
  end if;

  select r.venue_id, r.code into v_target_venue_id, v_target_code
  from public.roles r where r.id = p_target_role_id;
  if not found then raise exception 'Target role not found'; end if;
  if v_target_venue_id is null then
    raise exception 'Target must be a venue-scoped role';
  end if;
  if public.venue_account_id(v_target_venue_id) <> v_account_id then
    raise exception 'Target role is outside active account';
  end if;
  if v_target_code = 'owner' then
    raise exception 'Owner role cannot be modified';
  end if;

  insert into public.role_permissions (role_id, permission_id, granted)
  select p_target_role_id, rp.permission_id, true
  from public.role_permissions rp
  where rp.role_id = p_source_role_id
    and rp.granted = true
  on conflict (role_id, permission_id)
  do update set granted = true;
end;
$$;

-- ── 5. get_department_heads ────────────────────────────────────────
-- Department теперь venue-scoped. Head'ы — носители head_role в том же
-- venue. Раньше `v.account_id = d.account_id` — теперь `v.id = d.venue_id`.
drop function if exists public.get_department_heads(uuid);
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
  join public.venues v             on v.id = uvr.venue_id and v.id = d.venue_id
  join public.profiles p           on p.id = uvr.user_id
  where d.id = p_department_id
    and public.venue_account_id(d.venue_id) = public.get_active_account_id()
  order by v.name, p.last_name, p.first_name;
$$;

-- ── 6. get_departments_with_counts ─────────────────────────────────
-- Список departments активного venue (или указанного). Раньше
-- фильтровал по account_id, теперь — строго по venue_id.
drop function if exists public.get_departments_with_counts(uuid);
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
  -- Tenant-guard: функция SECURITY DEFINER, RLS не работает, поэтому
  -- любой переданный p_venue_id обязан принадлежать активному аккаунту
  -- caller'а. Иначе чужие имена/счётчики departments читаются через
  -- произвольный venue_id (Codex P1 на #309).
  with effective_venue as (
    select v.id as venue_id
    from public.venues v
    where v.id = coalesce(p_venue_id, public.get_active_venue_id())
      and v.account_id = public.get_active_account_id()
  )
  select
    d.id,
    d.name,
    d.icon,
    d.icon_color,
    d.description,
    d.head_role_id,
    hr.name                            as head_role_name,
    coalesce(rc.cnt, 0)                as roles_count,
    coalesce(sc.cnt, 0)                as staff_count
  from public.departments d
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
      and uvr.venue_id = ev2.venue_id
      and r.department_id is not null
    group by r.department_id
  ) sc on sc.department_id = d.id
  where d.venue_id = ev.venue_id
  order by d.name;
$$;

-- ── 7. kb_list_required_reading_stats ──────────────────────────────
-- Чиним два бага одновременно:
--   * `r.account_id is null` — колонки больше нет.
--   * JOIN на `public.account_role_permissions` — таблица удалена
--     в 138, функция падала ещё до Stage D.
-- Override-семантика умерла вместе с таблицей; читаем granted
-- напрямую из role_permissions.
create or replace function public.kb_list_required_reading_stats(p_page_id uuid)
returns table (
  user_id    uuid,
  first_name text,
  last_name  text,
  avatar_url text,
  read_at    timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid := public.get_active_account_id();
  v_can_view boolean := public.has_permission('kb.manage_required_reading');
  v_current_version integer;
begin
  if v_account_id is null or auth.uid() is null then
    return;
  end if;
  if not v_can_view then
    return;
  end if;

  if not exists (
    select 1 from public.kb_pages
     where id = p_page_id
       and account_id = v_account_id
       and deleted_at is null
  ) then
    return;
  end if;

  select coalesce(max(version_number), 1)
    into v_current_version
    from public.kb_page_versions
   where page_id = p_page_id;

  return query
  with members as (
    select distinct p.id, p.first_name, p.last_name, p.avatar_url
    from public.profiles p
    join public.user_venue_roles uvr on uvr.user_id = p.id
    join public.venues v on v.id = uvr.venue_id
    join public.role_permissions rp on rp.role_id = uvr.role_id
    join public.permissions perm
      on perm.id = rp.permission_id and perm.code = 'kb.view_pages'
    where v.account_id = v_account_id
      and uvr.status = 'active'
      and rp.granted = true
  ),
  latest_reads as (
    select distinct on (r.user_id)
      r.user_id, r.read_at, r.read_version
    from public.kb_page_reads r
    where r.page_id = p_page_id
      and r.account_id = v_account_id
      and r.read_version >= v_current_version
    order by r.user_id, r.read_version desc
  )
  select
    m.id            as user_id,
    m.first_name,
    m.last_name,
    m.avatar_url,
    lr.read_at
  from members m
  left join latest_reads lr on lr.user_id = m.id
  order by
    lr.read_at desc nulls last,
    m.first_name nulls last,
    m.last_name  nulls last;
end;
$$;

-- ── 8a. get_venue_staff — восстанавливаем потерянные поля ──────────
-- Не связано со Stage D, но обнаружено в этом же разборе и чинить
-- надо в одной миграции. История функции:
--   133 — добавила `email_confirmed boolean`.
--   135 — добавила `medical_book_date date`.
--   158 — DROP+CREATE для добавления `department_id` / `department_name`,
--         **но сигнатура была собрана с нуля и потеряла оба поля**.
-- На UI это даёт два видимых симптома:
--   * у уже-залогиненного владельца в списке сотрудников бейдж
--     «Ожидает» — `email_confirmed` приходит undefined → falsy.
--   * нет per-row индикатора медкнижки даже при просроченной книжке,
--     при этом `count_venue_staff_attention` считает её корректно
--     (она читает sad.medical_book_date напрямую) — отсюда «единичка»
--     в sidebar при пустых сотрудниках.
-- Восстанавливаем оба поля, сохраняя department_id / department_name.

drop function if exists public.get_venue_staff(uuid);
create function public.get_venue_staff(p_venue_id uuid)
returns table (
  uvr_id             uuid,
  user_id            uuid,
  role_id            uuid,
  role_name          text,
  role_code          text,
  first_name         text,
  last_name          text,
  email              text,
  email_confirmed    boolean,
  avatar_url         text,
  phone              text,
  telegram_id        text,
  gender             text,
  birth_date         date,
  employment_date    date,
  medical_book_date  date,
  joined_at          timestamptz,
  department_id      uuid,
  department_name    text
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
    (au.email_confirmed_at is not null)                             as email_confirmed,
    p.avatar_url,
    p.phone,
    p.telegram_id,
    p.gender,
    p.birth_date,
    coalesce(sad.employment_date, uvr.created_at::date)             as employment_date,
    sad.medical_book_date                                           as medical_book_date,
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

-- ── 8b. kb_notify_required_reading ─────────────────────────────────
-- Те же два фикса, что и в (7): убрать `r.account_id is null` и
-- JOIN на удалённую `account_role_permissions`.
create or replace function public.kb_notify_required_reading()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link    text;
  v_uid     uuid := auth.uid();
  v_preview text;
begin
  if v_uid is null then
    return NEW;
  end if;
  if NEW.required_reading is not true then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and coalesce(OLD.required_reading, false) = true then
    return NEW;
  end if;

  v_link := '/knowledge/' || NEW.slug;
  v_preview := substr(coalesce(NEW.plain_text, ''), 1, 180);

  insert into public.notifications (
    user_id, type, title, body, link,
    category, actor_user_id, entity_type, entity_id, payload
  )
  select distinct
    uvr.user_id,
    'kb.required_reading_assigned'                              as type,
    'Требуется прочесть: ' || coalesce(NEW.title, 'без названия') as title,
    'Страница помечена как обязательная к прочтению. ' ||
      'Ознакомьтесь и подтвердите прочтение в баннере.'         as body,
    v_link                                                      as link,
    'kb'        as category,
    v_uid       as actor_user_id,
    'kb_page'   as entity_type,
    NEW.id      as entity_id,
    jsonb_build_object(
      'preview', v_preview,
      'preview_kind', 'page_excerpt',
      'page_title', coalesce(NEW.title, 'без названия'),
      'page_icon', NEW.icon,
      'page_icon_color', NEW.icon_color
    )           as payload
  from public.user_venue_roles uvr
  join public.venues v on v.id = uvr.venue_id
  join public.role_permissions rp on rp.role_id = uvr.role_id
  join public.permissions perm
    on perm.id = rp.permission_id and perm.code = 'kb.view_pages'
  where v.account_id = NEW.account_id
    and uvr.status = 'active'
    and rp.granted = true
    and uvr.user_id <> v_uid;

  return NEW;
end;
$$;
