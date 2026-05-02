-- ============================================================
-- 052_kb_rpcs.sql
-- Stage 8.1 — Knowledge Base: Postgres-функции для атомарного
-- сохранения страницы, выборки предков (breadcrumbs) и full-text search.
--
-- См. ~/.claude/plans/imperative-swinging-sparrow.md §3.
-- ============================================================

-- ───────────────────────── kb_save_page ─────────────────────────
-- Атомарно: UPDATE kb_pages → INSERT kb_page_versions (если изменилось)
-- → REPLACE kb_page_links для from_page_id = p_id.
--
-- Возвращает version_number созданного снапшота, либо текущий
-- version_number если контент/title не изменились.
--
-- security definer: чтобы функция могла писать в kb_page_versions /
-- kb_page_links поверх RLS. Внутри явно проверяем kb.edit_*
-- permissions через has_permission(), повторяя смысл RLS-политик.
-- ============================================================

create or replace function public.kb_save_page(
  p_id            uuid,
  p_title         text,
  p_icon          text,
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

  -- Берём текущую версию страницы и проверяем доступ.
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

  -- Контент или title изменились?
  v_changed :=
    coalesce(v_page.title, '') is distinct from coalesce(p_title, '')
    or v_page.content is distinct from p_content;

  -- UPDATE страницы.
  update public.kb_pages
     set title       = p_title,
         icon        = p_icon,
         content     = p_content,
         plain_text  = p_plain_text,
         updated_by  = v_uid
   where id = p_id;

  -- Снапшот версии — только если что-то поменялось.
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

  -- Заменяем backlinks (delete + insert в одной TX, что и есть RPC).
  delete from public.kb_page_links where from_page_id = p_id;

  if p_link_targets is not null and array_length(p_link_targets, 1) > 0 then
    insert into public.kb_page_links (from_page_id, to_page_id, account_id)
    select p_id, t, v_account_id
      from unnest(p_link_targets) as t
     where t != p_id  -- self-links игнорируем
       and exists (
         select 1 from public.kb_pages
          where id = t and account_id = v_account_id
       )
    on conflict do nothing;
  end if;

  return v_next_version;
end;
$$;

comment on function public.kb_save_page(uuid, text, text, jsonb, text, uuid[]) is
  'Атомарное сохранение KB-страницы: контент + версия + backlinks. '
  'Возвращает version_number текущего снапшота.';

grant execute on function public.kb_save_page(uuid, text, text, jsonb, text, uuid[])
  to authenticated;

-- ───────────────────────── kb_get_ancestors ─────────────────────────
-- Цепочка предков от корня до самой страницы (включительно).
-- Используется для breadcrumbs.
-- ============================================================

create or replace function public.kb_get_ancestors(p_page_id uuid)
returns table (
  id     uuid,
  title  text,
  icon   text,
  slug   text,
  depth  integer
)
language sql
stable
security definer
set search_path = public
as $$
  with recursive chain as (
    select kp.id, kp.parent_id, kp.title, kp.icon, kp.slug, 0 as depth
      from public.kb_pages kp
     where kp.id = p_page_id
       and kp.account_id = public.get_active_account_id()
    union all
    select kp.id, kp.parent_id, kp.title, kp.icon, kp.slug, c.depth + 1
      from public.kb_pages kp
      join chain c on kp.id = c.parent_id
     where kp.account_id = public.get_active_account_id()
  )
  select c.id, c.title, c.icon, c.slug, c.depth
    from chain c
    -- Корень → лист.
   order by c.depth desc;
$$;

comment on function public.kb_get_ancestors(uuid) is
  'Цепочка предков KB-страницы от корня до самой страницы (для breadcrumbs).';

grant execute on function public.kb_get_ancestors(uuid) to authenticated;

-- ───────────────────────── kb_search ─────────────────────────
-- Full-text search по kb_pages.search_tsv. websearch_to_tsquery
-- понимает обычные пользовательские запросы (фразы в кавычках,
-- OR/AND, минус). RLS на kb_pages не действует на тело SECURITY
-- DEFINER функции — поэтому явно гейтим по has_permission +
-- account_id внутри.
-- ============================================================

create or replace function public.kb_search(
  p_query text,
  p_limit integer default 20
)
returns table (
  id      uuid,
  slug    text,
  title   text,
  icon    text,
  snippet text,
  rank    real
)
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select websearch_to_tsquery('russian', coalesce(p_query, '')) as tsq
  )
  select
    kp.id,
    kp.slug,
    kp.title,
    kp.icon,
    ts_headline(
      'russian',
      coalesce(kp.plain_text, ''),
      q.tsq,
      'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, MaxWords=18, MinWords=5'
    ) as snippet,
    ts_rank(kp.search_tsv, q.tsq) as rank
  from public.kb_pages kp, q
  where kp.account_id = public.get_active_account_id()
    and kp.deleted_at is null
    and public.has_permission('kb.view_pages')
    and kp.search_tsv @@ q.tsq
  order by rank desc, kp.updated_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

comment on function public.kb_search(text, integer) is
  'Full-text search по KB активного account с ts_headline-снипетами.';

grant execute on function public.kb_search(text, integer) to authenticated;
