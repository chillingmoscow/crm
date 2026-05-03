-- ============================================================
-- 085_kb_recently_viewed.sql
-- Sprint D / Phase 6 — Recently-viewed RPC для landing-redesign'а.
--
-- Зачем: новый KB-landing (`/knowledge` page.tsx) показывает виджет
-- «Мои недавние» — последние страницы, которые открывал текущий юзер.
-- Источник данных — `kb_page_view_sessions` (миграция 077).
--
-- Проблема: RLS на kb_page_view_sessions (077) разрешает SELECT
-- только под `kb.view_analytics` permission. Это намеренное ограничение
-- — admin-only stats. Но «recently viewed» — это навигационная
-- помощь, НЕ stats: мы НЕ показываем юзеру time / counts, только
-- список страниц для quick-jump.
--
-- Поэтому делаем отдельный security-definer RPC, который возвращает
-- только page-meta (id/slug/title/icon) для self без time-данных.
-- Не нарушает «admin-only analytics» decision из плана §4.
-- ============================================================

create or replace function public.kb_get_my_recently_viewed(
  p_limit integer default 7
)
returns table (
  page_id        uuid,
  slug           text,
  title          text,
  icon           text,
  icon_color     text,
  last_visit_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_account_id uuid := public.get_active_account_id();
begin
  if v_uid is null or v_account_id is null then
    return;
  end if;

  -- Permission gate: kb.view_pages — без права на чтение KB
  -- recently-viewed'а быть не должно.
  if not public.has_permission('kb.view_pages') then
    return;
  end if;

  return query
  select
    kp.id            as page_id,
    kp.slug,
    kp.title,
    kp.icon,
    kp.icon_color,
    max(s.started_at) as last_visit_at
  from public.kb_page_view_sessions s
  join public.kb_pages kp on kp.id = s.page_id
  where s.user_id = v_uid
    and s.account_id = v_account_id
    and kp.deleted_at is null
  group by kp.id, kp.slug, kp.title, kp.icon, kp.icon_color
  order by max(s.started_at) desc
  limit greatest(1, least(coalesce(p_limit, 7), 20));
end;
$$;

comment on function public.kb_get_my_recently_viewed(integer) is
  'Self-view recent pages для KB-landing-виджета. Возвращает только '
  'page-meta + last-visit timestamp для сортировки. БЕЗ time/sessions '
  'данных — это навигационный helper, не аналитика. Гейт kb.view_pages.';

revoke all on function public.kb_get_my_recently_viewed(integer) from public;
grant execute on function public.kb_get_my_recently_viewed(integer) to authenticated;
