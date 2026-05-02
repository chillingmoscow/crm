-- ============================================================
-- 062_kb_pages_icon_color.sql
-- Stage 8.7+ — выбор иконки и цвета для страницы базы знаний.
--
-- До: kb_pages.icon хранила свободный текст (использовалось как
-- emoji-поле). Теперь icon хранит ЛИБО emoji-символ, ЛИБО короткий
-- ключ из Lucide-реестра (см. src/lib/knowledge/icons.ts), а
-- icon_color — опциональный пресет-цвет тинта (gray/brown/orange/
-- yellow/green/blue/purple/pink/red).
--
-- Палитра — фиксированная, лежит в коде клиента. На уровне БД
-- никаких enum'ов: проще итерировать палитру без миграций.
-- ============================================================

alter table public.kb_pages
  add column if not exists icon_color text;

comment on column public.kb_pages.icon_color is
  'Опциональный пресет-цвет тинта иконки. Имена палитры — '
  'gray / brown / orange / yellow / green / blue / purple / pink / red. '
  'Используется только для Lucide-иконок; emoji-иконки игнорируют.';

-- ============================================================
-- Перегрузка kb_save_page: добавляем p_icon_color.
-- DROP+CREATE — Postgres не позволяет менять сигнатуру через
-- CREATE OR REPLACE.
-- ============================================================

drop function if exists public.kb_save_page(uuid, text, text, jsonb, text, uuid[]);

create or replace function public.kb_save_page(
  p_id            uuid,
  p_title         text,
  p_icon          text,
  p_icon_color    text,
  p_content       jsonb,
  p_plain_text    text,
  p_link_targets  uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid              uuid := auth.uid();
  v_account_id       uuid := public.get_active_account_id();
  v_page             public.kb_pages%rowtype;
  v_can_edit_any     boolean := public.has_permission('kb.edit_any_page');
  v_can_edit_own     boolean := public.has_permission('kb.edit_own_pages');
  v_changed          boolean;
  v_next_version     integer;
begin
  if v_uid is null then
    raise exception 'kb_save_page: не авторизован' using errcode = '28000';
  end if;
  if v_account_id is null then
    raise exception 'kb_save_page: нет активного account' using errcode = '28000';
  end if;

  select * into v_page from public.kb_pages where id = p_id;
  if not found then
    raise exception 'kb_save_page: страница % не найдена', p_id using errcode = 'P0002';
  end if;
  if v_page.account_id != v_account_id then
    raise exception 'kb_save_page: страница принадлежит другому account' using errcode = '42501';
  end if;
  if not (
    v_can_edit_any
    or (v_can_edit_own and v_page.created_by = v_uid)
  ) then
    raise exception 'kb_save_page: нет права на редактирование' using errcode = '42501';
  end if;

  -- Контент / title / icon / icon_color изменились?
  v_changed :=
    coalesce(v_page.title, '') is distinct from coalesce(p_title, '')
    or coalesce(v_page.icon, '') is distinct from coalesce(p_icon, '')
    or coalesce(v_page.icon_color, '') is distinct from coalesce(p_icon_color, '')
    or v_page.content is distinct from p_content;

  update public.kb_pages
     set title       = p_title,
         icon        = p_icon,
         icon_color  = p_icon_color,
         content     = p_content,
         plain_text  = p_plain_text,
         updated_by  = v_uid
   where id = p_id;

  -- Снапшот версии — только если что-то поменялось.
  -- icon/color менять — не повод плодить версии? Решение: снапшот
  -- пишем, чтобы restore возвращал и иконку тоже. История в UI
  -- группируется по дням, лишний шум скрыт.
  if v_changed then
    select coalesce(max(version_number), 0) + 1
      into v_next_version
      from public.kb_page_versions
     where page_id = p_id;

    insert into public.kb_page_versions (
      page_id, account_id, version_number, title, content, created_by
    ) values (
      p_id, v_account_id, v_next_version, p_title, p_content, v_uid
    );
  else
    select coalesce(max(version_number), 0) into v_next_version
      from public.kb_page_versions where page_id = p_id;
  end if;

  -- Backlinks: replace в одной TX.
  delete from public.kb_page_links where from_page_id = p_id;

  if p_link_targets is not null and array_length(p_link_targets, 1) > 0 then
    insert into public.kb_page_links (from_page_id, to_page_id, account_id)
    select p_id, t, v_account_id
      from unnest(p_link_targets) as t
     where t != p_id
       and exists (
         select 1 from public.kb_pages
          where id = t and account_id = v_account_id
       )
    on conflict do nothing;
  end if;

  return v_next_version;
end;
$$;

comment on function public.kb_save_page(uuid, text, text, text, jsonb, text, uuid[]) is
  'Атомарное сохранение KB-страницы: контент + версия + backlinks. '
  'Возвращает version_number текущего снапшота. С 062 принимает icon_color.';

grant execute on function public.kb_save_page(uuid, text, text, text, jsonb, text, uuid[])
  to authenticated;

-- ============================================================
-- kb_get_ancestors / kb_search — добавляем icon_color в return.
-- Сигнатура (return columns) меняется → DROP + CREATE.
-- ============================================================

drop function if exists public.kb_get_ancestors(uuid);

create or replace function public.kb_get_ancestors(p_page_id uuid)
returns table (
  id          uuid,
  title       text,
  icon        text,
  icon_color  text,
  slug        text,
  depth       integer
)
language sql
stable
security definer
set search_path = public
as $$
  with recursive chain as (
    select kp.id, kp.parent_id, kp.title, kp.icon, kp.icon_color, kp.slug, 0 as depth
      from public.kb_pages kp
     where kp.id = p_page_id
       and kp.account_id = public.get_active_account_id()
    union all
    select kp.id, kp.parent_id, kp.title, kp.icon, kp.icon_color, kp.slug, c.depth + 1
      from public.kb_pages kp
      join chain c on kp.id = c.parent_id
     where kp.account_id = public.get_active_account_id()
  )
  select c.id, c.title, c.icon, c.icon_color, c.slug, c.depth
    from chain c
   order by c.depth desc;
$$;

comment on function public.kb_get_ancestors(uuid) is
  'Цепочка предков KB-страницы от корня до самой страницы. С 062 включает icon_color.';

grant execute on function public.kb_get_ancestors(uuid) to authenticated;

drop function if exists public.kb_search(text, integer);

create or replace function public.kb_search(
  p_query text,
  p_limit integer default 20
)
returns table (
  id          uuid,
  slug        text,
  title       text,
  icon        text,
  icon_color  text,
  snippet     text,
  rank        real
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_clean   text;
  v_terms   text[];
  v_parts   text[] := array[]::text[];
  v_term    text;
  v_tsquery tsquery;
begin
  v_clean := lower(
    regexp_replace(coalesce(p_query, ''), '[^[:alnum:][:space:]]+', ' ', 'g')
  );

  v_terms := array(
    select t
    from unnest(string_to_array(trim(v_clean), ' ')) as t
    where length(t) > 0
  );

  if array_length(v_terms, 1) is null then
    return;
  end if;

  foreach v_term in array v_terms loop
    v_parts := array_append(v_parts, v_term || ':*');
  end loop;

  v_tsquery := to_tsquery('russian', array_to_string(v_parts, ' & '));

  return query
    select
      kp.id,
      kp.slug,
      kp.title,
      kp.icon,
      kp.icon_color,
      ts_headline(
        'russian',
        coalesce(kp.plain_text, ''),
        v_tsquery,
        'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MaxWords=18, MinWords=5'
      ) as snippet,
      ts_rank(kp.search_tsv, v_tsquery) as rank
    from public.kb_pages kp
    where kp.account_id = public.get_active_account_id()
      and kp.deleted_at is null
      and public.has_permission('kb.view_pages')
      and kp.search_tsv @@ v_tsquery
    order by rank desc, kp.updated_at desc nulls last
    limit greatest(1, least(coalesce(p_limit, 20), 50));
end;
$$;

comment on function public.kb_search(text, integer) is
  'Full-text search по KB активного account с prefix-match и icon_color.';

grant execute on function public.kb_search(text, integer) to authenticated;
