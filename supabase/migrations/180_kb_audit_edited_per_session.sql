-- ============================================================
-- 180_kb_audit_edited_per_session.sql
-- Журнал: фиксировать ФАКТ изменения страницы — но один раз на
-- сессию редактирования, без шума.
--
-- Контекст: триггер 074 намеренно НЕ логировал kb_page.edited (на
-- каждый kb_save_page = слишком шумно: 10 правок → 10 строк
-- «изменил»). Пользователь хочет видеть, что страница менялась, но
-- одной записью на сессию правок, а не на каждый autosave; и чтобы
-- комментарии за изменение НЕ считались.
--
-- Решение: kb_upsert_page_version_session уже сворачивает правки
-- одного автора за 15 минут в ОДНУ версию-сессию (119/120). Эмитим
-- audit-событие kb_page.edited ровно там, где создаётся НОВАЯ
-- версия-сессия (а не в fold-ветке) → одно событие на сессию.
--   • 10 правок за 15 мин = 1 новая сессия = 1 «изменил».
--   • Пауза >15 мин и снова правки = новая сессия = ещё 1 запись.
--   • Комментарии (kb_threads) не трогают эту функцию → не
--     порождают «изменил» (требование «комментарий ≠ изменение»).
--   • version_number = 1 пропускаем: первая версия = создание
--     контента, уже покрыто kb_page.created (без дубля на свежей
--     странице).
--
-- Тело функции — точная копия из 120 (CREATE OR REPLACE сбрасывает
-- атрибуты; search_path сохраняем как было). Добавлена ровно одна
-- ветка log_audit перед финальным return.
-- ============================================================

create or replace function public.kb_upsert_page_version_session(
  p_page_id uuid,
  p_account_id uuid,
  p_title text,
  p_icon text,
  p_icon_color text,
  p_content jsonb,
  p_plain_text text,
  p_properties jsonb,
  p_created_by uuid,
  p_change_kinds text[],
  p_force_new_version boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_latest public.kb_page_versions%rowtype;
  v_version integer;
  v_change_kinds text[];
begin
  select *
    into v_latest
    from public.kb_page_versions
   where page_id = p_page_id
   order by version_number desc
   limit 1
   for update;

  if found
     and not p_force_new_version
     and v_latest.created_by is not distinct from p_created_by
     and coalesce(v_latest.updated_at, v_latest.created_at) >= now() - interval '15 minutes'
     and not exists (
       select 1
         from public.kb_page_reads r
        where r.page_id = p_page_id
          and r.read_version = v_latest.version_number
     )
  then
    select coalesce(array_agg(distinct kind order by kind), '{}'::text[])
      into v_change_kinds
      from unnest(coalesce(v_latest.change_kinds, '{}'::text[]) || coalesce(p_change_kinds, '{}'::text[])) as kind;

    update public.kb_page_versions
       set title = p_title,
           icon = p_icon,
           icon_color = p_icon_color,
           content = p_content,
           plain_text = coalesce(p_plain_text, ''),
           text_length = char_length(coalesce(p_plain_text, '')),
           properties = p_properties,
           updated_at = now(),
           change_kinds = v_change_kinds
     where id = v_latest.id
     returning version_number into v_version;

    -- Fold-ветка: правка свёрнута в существующую сессию — НЕ эмитим
    -- audit (иначе тот самый шум).
    return v_version;
  end if;

  select coalesce(max(version_number), 0) + 1
    into v_version
    from public.kb_page_versions
   where page_id = p_page_id;

  insert into public.kb_page_versions (
    page_id,
    account_id,
    version_number,
    title,
    icon,
    icon_color,
    content,
    plain_text,
    text_length,
    properties,
    created_by,
    updated_at,
    change_kinds
  ) values (
    p_page_id,
    p_account_id,
    v_version,
    p_title,
    p_icon,
    p_icon_color,
    p_content,
    coalesce(p_plain_text, ''),
    char_length(coalesce(p_plain_text, '')),
    p_properties,
    p_created_by,
    now(),
    coalesce(p_change_kinds, '{}'::text[])
  );

  -- Новая версия-сессия → одно событие «страница изменена».
  -- v_version = 1 пропускаем: это создание контента, уже покрыто
  -- kb_page.created (триггер 074) — не плодим дубль на свежей странице.
  if v_version > 1 then
    perform public.log_audit(
      'kb_page.edited',
      'kb_page',
      p_page_id,
      jsonb_build_object(
        'title', p_title,
        'version_number', v_version,
        'change_kinds', coalesce(p_change_kinds, '{}'::text[])
      )
    );
  end if;

  return v_version;
end;
$$;

comment on function public.kb_upsert_page_version_session(
  uuid, uuid, text, text, text, jsonb, text, jsonb, uuid, text[], boolean
) is
  'Сворачивает autosave в 15-минутную версию-сессию (119/120). '
  'На создание НОВОЙ сессии (version_number > 1) эмитит '
  'kb_page.edited в audit_logs — один факт изменения на сессию, '
  'без шума на каждый autosave (180).';

-- ============================================================
-- kb_list_page_updates — дедуп kb_page.edited (Codex #325 P2).
--
-- Лента обновлений ОДНОЙ страницы (вкладка «История версий» / feed)
-- уже синтезирует kb_page.edited из kb_page_versions (121,
-- version-ветка). Теперь kb_page.edited есть и в audit_logs (для
-- Журнала /knowledge/audit). Без фильтра audit-ветка этой RPC дала
-- бы ВТОРОЙ kb_page.edited на ту же сессию → дубль именно в feed'е,
-- который 121 и старался обесшумить.
--
-- Фикс: в audit-ветке исключаем kb_page.edited (его для feed'а даёт
-- version-ветка). Журнал не зависит от этой RPC — он читает
-- audit_logs напрямую (listAuditEvents), там kb_page.edited
-- остаётся. Тело — точная копия 121 + одна строка в audit-where.
-- ============================================================

create or replace function public.kb_list_page_updates(
  p_page_id uuid,
  p_limit integer default 80
)
returns table (
  id text,
  source text,
  action_code text,
  created_at timestamptz,
  actor_id uuid,
  actor_first_name text,
  actor_last_name text,
  actor_avatar_url text,
  details jsonb
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account_id uuid := public.get_active_account_id();
  v_limit integer := least(greatest(coalesce(p_limit, 80), 1), 200);
begin
  if v_uid is null then
    raise exception 'Не авторизован' using errcode = '42501';
  end if;
  if v_account_id is null then
    raise exception 'Нет активного account' using errcode = '42501';
  end if;
  if not public.has_permission('kb.view_pages') then
    raise exception 'Нет права просматривать базу знаний' using errcode = '42501';
  end if;
  if not exists (
    select 1
      from public.kb_pages p
     where p.id = p_page_id
       and p.account_id = v_account_id
       and p.deleted_at is null
  ) then
    raise exception 'Страница не найдена' using errcode = 'P0002';
  end if;

  return query
  with raw_updates as (
    select
      ('version:' || v.id::text) as id,
      'version'::text as source,
      case
        when coalesce(v.change_kinds, '{}'::text[]) @> array['restore']::text[]
          then 'kb_page.version_restored'
        else 'kb_page.edited'
      end as action_code,
      coalesce(v.updated_at, v.created_at) as created_at,
      v.created_by as actor_id,
      jsonb_build_object(
        'title', v.title,
        'change_kinds', coalesce(v.change_kinds, '{}'::text[]),
        'text_length', v.text_length
      ) as details
    from public.kb_page_versions v
    where v.page_id = p_page_id
      and v.account_id = v_account_id
      and coalesce(v.updated_at, v.created_at) >= now() - interval '1 year'

    union all

    select
      ('audit:' || a.id::text) as id,
      'audit'::text as source,
      a.action_code,
      a.created_at,
      a.user_id as actor_id,
      coalesce(a.details, '{}'::jsonb) as details
    from public.audit_logs a
    where a.account_id = v_account_id
      and a.created_at >= now() - interval '1 year'
      -- kb_page.edited для feed'а даёт version-ветка выше; не дублируем
      -- из audit (Codex #325 P2). В Журнале он остаётся (audit напрямую).
      and a.action_code <> 'kb_page.edited'
      and (
        (a.entity_type = 'kb_page' and a.entity_id = p_page_id)
        or (
          a.entity_type = 'kb_thread'
          and a.details ->> 'page_id' = p_page_id::text
        )
      )

    union all

    select
      ('comment:' || c.id::text) as id,
      'comment'::text as source,
      case
        when c.thread_kind = 'page' then 'kb_comment.page_created'
        else 'kb_comment.inline_created'
      end as action_code,
      c.created_at,
      c.author_id as actor_id,
      jsonb_build_object(
        'thread_id', c.thread_id,
        'thread_kind', c.thread_kind,
        'deleted', c.deleted_at is not null
      ) as details
    from public.kb_comments c
    where c.page_id = p_page_id
      and c.account_id = v_account_id
      and c.created_at >= now() - interval '1 year'
  )
  select
    u.id,
    u.source,
    u.action_code,
    u.created_at,
    u.actor_id,
    pr.first_name as actor_first_name,
    pr.last_name as actor_last_name,
    pr.avatar_url as actor_avatar_url,
    u.details
  from raw_updates u
  left join public.profiles pr on pr.id = u.actor_id
  order by u.created_at desc, u.id desc
  limit v_limit;
end;
$$;

comment on function public.kb_list_page_updates(uuid, integer) is
  'Lightweight one-year Updates feed for a single KB page. '
  'kb_page.edited берётся из version-ветки; audit-ветка его '
  'исключает во избежание дубля (180 / Codex #325 P2).';

revoke all on function public.kb_list_page_updates(uuid, integer) from public;
grant execute on function public.kb_list_page_updates(uuid, integer) to authenticated;
