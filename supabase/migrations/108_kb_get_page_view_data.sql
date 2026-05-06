-- ============================================================
-- Миграция 108: kb_get_page_view_data — single RPC для всех
-- page-specific данных, нужных при рендере /knowledge/[slug].
--
-- ПРОБЛЕМА:
--   `[slug]/page.tsx` на каждой навигации делает Promise.all из ~10
--   запросов. После #161 (pool=60) timeouts ушли, но трешолд
--   остаётся: tree-клики ощущаются медленно из-за 6+ unique DB-hits
--   per navigation. Каждый — отдельный round-trip к Postgres, и хотя
--   они идут параллельно (latency = max), pool footprint = sum.
--
--   В частности:
--     • isKbPageFavorited(pageId)        — 1 query (kb_user_favorites)
--     • getKbPageReadStatus(pageId)       — 3 queries параллельно
--                                          (kb_pages + kb_page_versions
--                                          + kb_page_reads)
--     • getKbBreadcrumbs(pageId)          — 1 RPC (kb_get_ancestors)
--     • listBacklinksTo(pageId)           — 1 query (kb_page_links join kb_pages)
--   Итого ~6 DB-connections per page-nav, только под одну функцию
--   getKbPageReadStatus уходит 3.
--
-- РЕШЕНИЕ:
--   Один RPC возвращает JSONB со всем сразу:
--     {
--       required_reading: boolean,
--       current_version: int,
--       my_read_at: timestamptz | null,
--       my_read_version: int | null,
--       favorited: boolean,
--       breadcrumbs: [{id, slug, title, icon, icon_color}],
--       backlinks: [{id, slug, title, icon, icon_color}]
--     }
--   Pool footprint per page-nav: 6 → 1. Под нагрузкой 5-10 пользователей,
--   navigating одновременно, разница заметная.
--
--   SECURITY INVOKER — RLS на каждой внутренней SELECT'е применяется
--   как и раньше; функция не обходит permissions, только консолидирует
--   round-trip'ы.
--
--   STABLE — функция читает БД, но не модифицирует. PG может оптимизировать
--   повторные вызовы внутри одной транзакции (pg-cache).
-- ============================================================

CREATE OR REPLACE FUNCTION public.kb_get_page_view_data(p_page_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_required boolean;
  v_current_version int;
  v_my_read_at timestamptz;
  v_my_read_version int;
  v_is_read_current boolean;
  v_needs_reread boolean;
  v_favorited boolean;
  v_breadcrumbs jsonb;
  v_backlinks jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    -- Без auth.uid() RLS всё равно reject'нул бы все SELECT'ы,
    -- но явная ошибка читаемее.
    RAISE EXCEPTION 'Не авторизован' USING ERRCODE = '42501';
  END IF;

  -- ── required-reading flag ────────────────────────────────
  -- RLS на kb_pages SELECT: kb.view_pages + active account.
  -- Если страница недоступна → v_required останется NULL → caller
  -- получит required_reading=false (как и раньше через
  -- `Boolean(page?.required_reading)`).
  SELECT required_reading INTO v_required
  FROM public.kb_pages
  WHERE id = p_page_id;

  -- ── current version ──────────────────────────────────────
  SELECT version_number INTO v_current_version
  FROM public.kb_page_versions
  WHERE page_id = p_page_id
  ORDER BY version_number DESC
  LIMIT 1;

  -- Default version=1 если ни одного save'а не было (свежесозданная
  -- страница). Совпадает с поведением migration 097.
  v_current_version := COALESCE(v_current_version, 1);

  -- ── my last read row ─────────────────────────────────────
  SELECT read_at, read_version
  INTO v_my_read_at, v_my_read_version
  FROM public.kb_page_reads
  WHERE page_id = p_page_id AND user_id = v_user_id
  ORDER BY read_version DESC
  LIMIT 1;

  -- Versioning logic — те же правила что в JS-функции
  -- getKbPageReadStatus:
  --   • myReadAt отдаём только если юзер прочитал ТЕКУЩУЮ версию.
  --   • needsReread=true если юзер прочитал старую версию.
  v_is_read_current :=
    v_my_read_version IS NOT NULL AND v_my_read_version >= v_current_version;
  v_needs_reread :=
    v_my_read_version IS NOT NULL AND v_my_read_version < v_current_version;

  -- ── favorited ───────────────────────────────────────────
  SELECT EXISTS (
    SELECT 1 FROM public.kb_user_favorites
    WHERE page_id = p_page_id AND user_id = v_user_id
  ) INTO v_favorited;

  -- ── breadcrumbs (root → current) ────────────────────────
  -- Делегируем в существующий kb_get_ancestors RPC. Он уже
  -- оптимально написан (одна recursive CTE) и возвращает rows
  -- ordered by depth DESC (root first, leaf last). ORDER BY в
  -- jsonb_agg сохраняет этот порядок в массиве.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'slug', a.slug,
    'title', a.title,
    'icon', a.icon,
    'icon_color', a.icon_color
  ) ORDER BY a.depth DESC), '[]'::jsonb)
  INTO v_breadcrumbs
  FROM public.kb_get_ancestors(p_page_id) AS a;

  -- ── backlinks (страницы которые ссылаются на текущую) ───
  -- Совпадает с listBacklinksTo: join kb_page_links → kb_pages.
  -- RLS на kb_pages SELECT отфильтрует страницы из чужих аккаунтов /
  -- soft-deleted / без kb.view_pages. coalesce → пустой [] если ничего.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', kp.id,
    'slug', kp.slug,
    'title', kp.title,
    'icon', kp.icon,
    'icon_color', kp.icon_color
  )), '[]'::jsonb)
  INTO v_backlinks
  FROM public.kb_page_links pl
  JOIN public.kb_pages kp ON kp.id = pl.from_page_id
  WHERE pl.to_page_id = p_page_id
    AND kp.deleted_at IS NULL;

  RETURN jsonb_build_object(
    'required_reading', COALESCE(v_required, false),
    'current_version', v_current_version,
    'my_read_at', CASE WHEN v_is_read_current THEN v_my_read_at ELSE NULL END,
    'my_read_version', v_my_read_version,
    'needs_reread', v_needs_reread,
    'favorited', v_favorited,
    'breadcrumbs', v_breadcrumbs,
    'backlinks', v_backlinks
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.kb_get_page_view_data(uuid) TO authenticated;

COMMENT ON FUNCTION public.kb_get_page_view_data(uuid) IS
  'Консолидированный page-view RPC: required-reading + read status + favorited + breadcrumbs + backlinks одним round-trip''ом. SECURITY INVOKER (RLS в силе). См. миграцию 108.';
