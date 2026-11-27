-- ============================================================
-- 416_kb_reading_state.sql — перечитывание обязательной страницы
-- только по кнопке менеджера и «Напомнить».
--
-- Было: прочтение действовало, пока номер прочитанной версии не меньше
-- текущей. Любое сохранение после чьего-то прочтения создаёт новую
-- версию (kb_upsert_page_version_session), поэтому опечатка заставляла
-- всех перечитывать.
--
-- Стало: у страницы порог `reread_from_version` («перечитать, начиная с
-- версии»). Прочтение действует, если read_version >= порога (по
-- умолчанию 1 — любое прочтение). Порог двигает только менеджер кнопкой
-- «Попросить перечитать». Уже прочитанное до миграции не сбрасывается:
-- порог у всех страниц пуст.
--
-- Состояние живёт в отдельной таблице, а не в kb_pages: любое UPDATE
-- kb_pages сдвигает updated_at («Недавно обновлённые») и проходит через
-- триггеры журнала и уведомлений.
--
-- Состав «кто должен прочитать» — одна функция kb_required_reading_roster:
-- активные (и не уволенные) сотрудники аккаунта с kb.view_pages. На ней
-- стоят статистика, «Напомнить» и «Попросить перечитать».
-- Спека: docs/superpowers/specs/2026-11-27-kb-redesign-design.md.
-- ============================================================

-- ── 1. Состояние чтения страницы ─────────────────────────────
create table public.kb_page_reading_state (
  page_id uuid primary key,
  account_id uuid not null,
  reread_from_version integer check (reread_from_version >= 1),
  reread_dismissed_version integer check (reread_dismissed_version >= 1),
  reminded_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint kb_page_reading_state_page_fkey
    foreign key (account_id, page_id)
    references public.kb_pages (account_id, id) on delete cascade
);

comment on table public.kb_page_reading_state is
  'Обязательное чтение страницы: перечитать начиная с версии, «не нужно» до версии, последнее напоминание. Пишется только функциями kb_request_reread / kb_dismiss_reread / kb_remind_unread (416).';

create index kb_page_reading_state_account_page_idx
  on public.kb_page_reading_state (account_id, page_id);

alter table public.kb_page_reading_state enable row level security;

create policy kb_page_reading_state_select on public.kb_page_reading_state
  for select to authenticated
  using (
    account_id = (select public.get_active_account_id())
    and (select public.has_permission('kb.view_pages'))
  );

revoke all on table public.kb_page_reading_state from public, anon, authenticated;
grant select on table public.kb_page_reading_state to authenticated;

-- ── 2. Кто должен прочитать ──────────────────────────────────
create or replace function public.kb_required_reading_roster(p_account_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select distinct uvr.user_id
    from public.user_venue_roles uvr
    join public.venues v on v.id = uvr.venue_id
    join public.role_permissions rp on rp.role_id = uvr.role_id and rp.granted
    join public.permissions perm
      on perm.id = rp.permission_id and perm.code = 'kb.view_pages'
   where v.account_id = p_account_id
     and v.archived_at is null
     and uvr.status = 'active'
     and uvr.fired_at is null
$$;

comment on function public.kb_required_reading_roster(uuid) is
  'Сотрудники аккаунта, которые должны читать обязательные страницы: активная роль с kb.view_pages, не уволены. Только для других функций (416).';

revoke all on function public.kb_required_reading_roster(uuid) from public, anon, authenticated;

-- ── 3. Данные страницы: прочтение действует до просьбы перечитать ──
create or replace function public.kb_get_page_view_data(p_page_id uuid)
returns jsonb
language plpgsql
security invoker
stable
set search_path = public, pg_catalog
as $$
declare
  v_user_id uuid;
  v_required boolean;
  v_current_version int;
  v_reread_from int;
  v_my_read_at timestamptz;
  v_my_read_version int;
  v_is_read_current boolean;
  v_needs_reread boolean;
  v_favorited boolean;
  v_breadcrumbs jsonb;
  v_backlinks jsonb;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Не авторизован' using errcode = '42501';
  end if;

  select required_reading into v_required
    from public.kb_pages
   where id = p_page_id;

  select version_number into v_current_version
    from public.kb_page_versions
   where page_id = p_page_id
   order by version_number desc
   limit 1;
  v_current_version := coalesce(v_current_version, 1);

  select reread_from_version into v_reread_from
    from public.kb_page_reading_state
   where page_id = p_page_id;
  v_reread_from := coalesce(v_reread_from, 1);

  select read_at, read_version
    into v_my_read_at, v_my_read_version
    from public.kb_page_reads
   where page_id = p_page_id and user_id = v_user_id
   order by read_version desc
   limit 1;

  -- Прочтение действует, пока менеджер не попросил перечитать версию
  -- новее прочитанной; сами правки страницы его не сбрасывают.
  v_is_read_current :=
    v_my_read_version is not null and v_my_read_version >= v_reread_from;
  v_needs_reread :=
    v_my_read_version is not null and v_my_read_version < v_reread_from;

  select exists (
    select 1 from public.kb_user_favorites
     where page_id = p_page_id and user_id = v_user_id
  ) into v_favorited;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'slug', a.slug, 'title', a.title,
    'icon', a.icon, 'icon_color', a.icon_color
  ) order by a.depth desc), '[]'::jsonb)
    into v_breadcrumbs
    from public.kb_get_ancestors(p_page_id) as a;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', kp.id, 'slug', kp.slug, 'title', kp.title,
    'icon', kp.icon, 'icon_color', kp.icon_color
  )), '[]'::jsonb)
    into v_backlinks
    from public.kb_page_links pl
    join public.kb_pages kp on kp.id = pl.from_page_id
   where pl.to_page_id = p_page_id
     and kp.deleted_at is null;

  return jsonb_build_object(
    'required_reading', coalesce(v_required, false),
    'current_version', v_current_version,
    'my_read_at', case when v_is_read_current then v_my_read_at else null end,
    'my_read_version', v_my_read_version,
    'needs_reread', v_needs_reread,
    'favorited', v_favorited,
    'breadcrumbs', v_breadcrumbs,
    'backlinks', v_backlinks
  );
end;
$$;

revoke all on function public.kb_get_page_view_data(uuid) from public, anon;
grant execute on function public.kb_get_page_view_data(uuid) to authenticated;

-- ── 4. «Кто прочитал»: статус каждого из состава ─────────────
drop function if exists public.kb_list_required_reading_stats(uuid);

create function public.kb_list_required_reading_stats(p_page_id uuid)
returns table (
  user_id uuid,
  first_name text,
  last_name text,
  avatar_url text,
  read_at timestamptz,
  read_version integer,
  status text,
  role_name text
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
#variable_conflict use_column
declare
  v_account_id uuid := public.get_active_account_id();
  v_reread_from integer;
begin
  if v_account_id is null or auth.uid() is null then
    return;
  end if;
  if not public.has_permission('kb.manage_required_reading') then
    return;
  end if;
  if not exists (
    select 1 from public.kb_pages
     where id = p_page_id and account_id = v_account_id and deleted_at is null
  ) then
    return;
  end if;

  select s.reread_from_version into v_reread_from
    from public.kb_page_reading_state s
   where s.page_id = p_page_id;
  v_reread_from := coalesce(v_reread_from, 1);

  return query
  with roster as (
    select r as user_id from public.kb_required_reading_roster(v_account_id) r
  ),
  latest as (
    select distinct on (pr.user_id) pr.user_id, pr.read_at, pr.read_version
      from public.kb_page_reads pr
     where pr.page_id = p_page_id and pr.account_id = v_account_id
     order by pr.user_id, pr.read_version desc, pr.read_at desc
  )
  select
    p.id,
    p.first_name,
    p.last_name,
    p.avatar_url,
    case when l.read_version >= v_reread_from then l.read_at end,
    l.read_version,
    case
      when l.read_version is null then 'unread'
      when l.read_version >= v_reread_from then 'read'
      else 'reread'
    end,
    -- Должность в аккаунте (первая по названию, если заведений несколько).
    (select ro2.name
       from public.user_venue_roles uvr
       join public.venues v on v.id = uvr.venue_id
       join public.roles ro2 on ro2.id = uvr.role_id
      where uvr.user_id = ro.user_id
        and v.account_id = v_account_id
        and uvr.status = 'active'
        and uvr.fired_at is null
      order by ro2.name
      limit 1)
  from roster ro
  join public.profiles p on p.id = ro.user_id
  left join latest l on l.user_id = ro.user_id
  order by
    case when l.read_version >= v_reread_from then l.read_at end desc nulls last,
    p.first_name nulls last,
    p.last_name nulls last;
end;
$$;

revoke all on function public.kb_list_required_reading_stats(uuid) from public, anon;
grant execute on function public.kb_list_required_reading_stats(uuid) to authenticated;

-- ── 5. Сводка по обязательным страницам (документ, «Обзор») ──
create or replace function public.kb_required_reading_overview(p_page_id uuid default null)
returns table (
  page_id uuid,
  slug text,
  title text,
  icon text,
  icon_color text,
  current_version integer,
  total integer,
  read_count integer,
  reread_count integer,
  unread_count integer,
  stale_count integer,
  remind_count integer,
  changed_after_read boolean,
  reminded_at timestamptz,
  last_edited_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
#variable_conflict use_column
declare
  v_account_id uuid := public.get_active_account_id();
  v_uid uuid := auth.uid();
  v_total integer;
begin
  if v_account_id is null or auth.uid() is null then
    return;
  end if;
  if not public.has_permission('kb.manage_required_reading') then
    return;
  end if;

  select count(*)::integer into v_total
    from public.kb_required_reading_roster(v_account_id);

  return query
  with roster as (
    select r as user_id from public.kb_required_reading_roster(v_account_id) r
  ),
  pages as (
    select kp.id, kp.slug, kp.title, kp.icon, kp.icon_color,
           coalesce(s.reread_from_version, 1) as from_v,
           s.reread_dismissed_version as dismissed_v,
           s.reminded_at as reminded
      from public.kb_pages kp
      left join public.kb_page_reading_state s on s.page_id = kp.id
     where kp.account_id = v_account_id
       and kp.deleted_at is null
       and kp.required_reading
       and (p_page_id is null or kp.id = p_page_id)
  ),
  versions as (
    select pv.page_id, max(pv.version_number) as cur, max(pv.updated_at) as last_edit
      from public.kb_page_versions pv
     where pv.page_id in (select id from pages)
     group by pv.page_id
  ),
  latest as (
    select distinct on (pr.page_id, pr.user_id) pr.page_id, pr.user_id, pr.read_version
      from public.kb_page_reads pr
      join roster ro on ro.user_id = pr.user_id
     where pr.page_id in (select id from pages)
     order by pr.page_id, pr.user_id, pr.read_version desc
  )
  select
    p.id,
    p.slug,
    p.title,
    p.icon,
    p.icon_color,
    coalesce(v.cur, 1)::integer,
    v_total,
    (count(l.user_id) filter (where l.read_version >= p.from_v))::integer,
    (count(l.user_id) filter (where l.read_version < p.from_v))::integer,
    (v_total - count(l.user_id))::integer,
    -- Прочитали действующе, но не последнюю версию: их сбросит и уведомит
    -- «Попросить перечитать». Без того, кто смотрит, — себе уведомлений нет.
    (count(l.user_id) filter (
      where l.read_version >= p.from_v and l.read_version < coalesce(v.cur, 1)
        and l.user_id <> v_uid
    ))::integer,
    -- Кому уйдёт «Напомнить»: без действующего прочтения, кроме смотрящего.
    (select count(*)
       from roster ro
      where ro.user_id <> v_uid
        and not exists (
          select 1 from latest l2
           where l2.page_id = p.id and l2.user_id = ro.user_id
             and l2.read_version >= p.from_v
        ))::integer,
    coalesce(bool_or(l.read_version >= p.from_v and l.read_version < coalesce(v.cur, 1)), false)
      and coalesce(v.cur, 1) > coalesce(p.dismissed_v, 0),
    p.reminded,
    v.last_edit
  from pages p
  left join versions v on v.page_id = p.id
  left join latest l on l.page_id = p.id
  group by p.id, p.slug, p.title, p.icon, p.icon_color, p.from_v, p.dismissed_v,
           p.reminded, v.cur, v.last_edit
  order by p.title;
end;
$$;

revoke all on function public.kb_required_reading_overview(uuid) from public, anon;
grant execute on function public.kb_required_reading_overview(uuid) to authenticated;

-- ── 6. Общая проверка для действий менеджера ─────────────────
-- Возвращает страницу или бросает понятную ошибку. Только для функций ниже.
create or replace function public.kb_reading_action_page(p_page_id uuid)
returns public.kb_pages
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_account_id uuid := public.get_active_account_id();
  v_page public.kb_pages;
begin
  if v_account_id is null or auth.uid() is null then
    raise exception 'Не авторизован' using errcode = '42501';
  end if;
  if not public.has_permission('kb.manage_required_reading') then
    raise exception 'Нет права управлять обязательным чтением';
  end if;
  select * into v_page
    from public.kb_pages
   where id = p_page_id and account_id = v_account_id and deleted_at is null;
  if not found then
    raise exception 'Страница не найдена';
  end if;
  if not v_page.required_reading then
    raise exception 'Страница не обязательна к прочтению';
  end if;
  return v_page;
end;
$$;

revoke all on function public.kb_reading_action_page(uuid) from public, anon, authenticated;

-- ── 7. «Попросить перечитать» ────────────────────────────────
create or replace function public.kb_request_reread(p_page_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_page public.kb_pages := public.kb_reading_action_page(p_page_id);
  v_current integer;
  v_from integer;
  v_count integer;
begin
  select coalesce(max(version_number), 1) into v_current
    from public.kb_page_versions
   where page_id = p_page_id;

  insert into public.kb_page_reading_state (page_id, account_id)
    values (p_page_id, v_page.account_id)
    on conflict (page_id) do nothing;
  select coalesce(reread_from_version, 1) into v_from
    from public.kb_page_reading_state
   where page_id = p_page_id
     for update;

  -- Уведомляем тех, у кого прочтение действовало и было старше текущей
  -- версии: они снова увидят страницу в «К прочтению».
  insert into public.notifications (
    user_id, type, title, body, link,
    category, actor_user_id, entity_type, entity_id, payload
  )
  select
    l.user_id,
    'kb.reread_requested',
    'Нужно перечитать: ' || coalesce(v_page.title, 'без названия'),
    'Страницу обновили. Прочитайте её снова и подтвердите прочтение.',
    '/knowledge/' || v_page.slug,
    'kb', v_uid, 'kb_page', v_page.id,
    jsonb_build_object(
      'page_title', coalesce(v_page.title, 'без названия'),
      'page_icon', v_page.icon,
      'page_icon_color', v_page.icon_color
    )
  from (
    select distinct on (pr.user_id) pr.user_id, pr.read_version
      from public.kb_page_reads pr
     where pr.page_id = p_page_id
     order by pr.user_id, pr.read_version desc
  ) l
  where l.read_version >= v_from
    and l.read_version < v_current
    and l.user_id <> v_uid
    and l.user_id in (select public.kb_required_reading_roster(v_page.account_id));
  get diagnostics v_count = row_count;

  update public.kb_page_reading_state
     set reread_from_version = v_current,
         reread_dismissed_version = null,
         updated_at = now()
   where page_id = p_page_id;

  perform public.log_audit(
    'kb_page.reread_requested', 'kb_page', p_page_id,
    jsonb_build_object('title', v_page.title, 'notified', v_count, 'version', v_current)
  );
  return v_count;
end;
$$;

revoke all on function public.kb_request_reread(uuid) from public, anon;
grant execute on function public.kb_request_reread(uuid) to authenticated;

-- ── 8. «Не нужно»: правка не требует перечитывания ────────────
create or replace function public.kb_dismiss_reread(p_page_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_page public.kb_pages := public.kb_reading_action_page(p_page_id);
  v_current integer;
begin
  select coalesce(max(version_number), 1) into v_current
    from public.kb_page_versions
   where page_id = p_page_id;

  insert into public.kb_page_reading_state (page_id, account_id, reread_dismissed_version)
    values (p_page_id, v_page.account_id, v_current)
    on conflict (page_id) do update
      set reread_dismissed_version = excluded.reread_dismissed_version,
          updated_at = now();

  perform public.log_audit(
    'kb_page.reread_dismissed', 'kb_page', p_page_id,
    jsonb_build_object('title', v_page.title, 'version', v_current)
  );
end;
$$;

revoke all on function public.kb_dismiss_reread(uuid) from public, anon;
grant execute on function public.kb_dismiss_reread(uuid) to authenticated;

-- ── 9. «Напомнить» непрочитавшим, не чаще раза в сутки ────────
create or replace function public.kb_remind_unread(p_page_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_page public.kb_pages := public.kb_reading_action_page(p_page_id);
  v_from integer;
  v_reminded timestamptz;
  v_count integer;
begin
  insert into public.kb_page_reading_state (page_id, account_id)
    values (p_page_id, v_page.account_id)
    on conflict (page_id) do nothing;
  -- for update: два быстрых нажатия не отправят напоминание дважды.
  select coalesce(reread_from_version, 1), reminded_at
    into v_from, v_reminded
    from public.kb_page_reading_state
   where page_id = p_page_id
     for update;

  if v_reminded is not null and v_reminded > now() - interval '1 day' then
    raise exception 'Напоминание по этой странице уже отправляли за последние сутки';
  end if;

  insert into public.notifications (
    user_id, type, title, body, link,
    category, actor_user_id, entity_type, entity_id, payload
  )
  select
    ro.user_id,
    'kb.required_reading_reminder',
    'Напоминаем прочитать: ' || coalesce(v_page.title, 'без названия'),
    'Страница обязательна к прочтению. Ознакомьтесь и подтвердите прочтение.',
    '/knowledge/' || v_page.slug,
    'kb', v_uid, 'kb_page', v_page.id,
    jsonb_build_object(
      'page_title', coalesce(v_page.title, 'без названия'),
      'page_icon', v_page.icon,
      'page_icon_color', v_page.icon_color
    )
  from public.kb_required_reading_roster(v_page.account_id) as ro(user_id)
  where ro.user_id <> v_uid
    and not exists (
      select 1 from public.kb_page_reads pr
       where pr.page_id = p_page_id
         and pr.user_id = ro.user_id
         and pr.read_version >= v_from
    );
  get diagnostics v_count = row_count;

  if v_count = 0 then
    return 0;
  end if;

  update public.kb_page_reading_state
     set reminded_at = now(), updated_at = now()
   where page_id = p_page_id;

  perform public.log_audit(
    'kb_page.reminder_sent', 'kb_page', p_page_id,
    jsonb_build_object('title', v_page.title, 'notified', v_count)
  );
  return v_count;
end;
$$;

revoke all on function public.kb_remind_unread(uuid) from public, anon;
grant execute on function public.kb_remind_unread(uuid) to authenticated;

-- ── 10. Проверка прав ────────────────────────────────────────
do $$
begin
  if has_function_privilege('authenticated', 'public.kb_required_reading_roster(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.kb_reading_action_page(uuid)', 'execute') then
    raise exception '416: служебные функции доступны пользователю';
  end if;
  if has_function_privilege('anon', 'public.kb_request_reread(uuid)', 'execute')
     or has_function_privilege('anon', 'public.kb_remind_unread(uuid)', 'execute')
     or has_function_privilege('anon', 'public.kb_dismiss_reread(uuid)', 'execute')
     or has_function_privilege('anon', 'public.kb_required_reading_overview(uuid)', 'execute')
     or has_function_privilege('anon', 'public.kb_list_required_reading_stats(uuid)', 'execute') then
    raise exception '416: функции обязательного чтения доступны анониму';
  end if;
  if not has_function_privilege('authenticated', 'public.kb_request_reread(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.kb_remind_unread(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.kb_list_required_reading_stats(uuid)', 'execute') then
    raise exception '416: у пользователя нет доступа к функциям обязательного чтения';
  end if;
  if has_table_privilege('authenticated', 'public.kb_page_reading_state', 'insert')
     or has_table_privilege('authenticated', 'public.kb_page_reading_state', 'update')
     or has_table_privilege('anon', 'public.kb_page_reading_state', 'select') then
    raise exception '416: запись в kb_page_reading_state в обход функций';
  end if;
end $$;

notify pgrst, 'reload schema';
