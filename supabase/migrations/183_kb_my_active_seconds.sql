-- ============================================================
-- 183_kb_my_active_seconds.sql
--
-- Read-gate на обязательных страницах раньше считал dwell-таймер
-- заново при каждом монтировании баннера: открыл страницу повторно
-- (или она обновилась → needsReread) — снова жди полный порог,
-- хотя пользователь уже потратил активное время раньше. Глупо.
--
-- У нас уже копится активное время чтения по странице в
-- kb_page_view_sessions (миграция 077, duration_seconds считает
-- сервер). Эта RPC отдаёт СУММУ активных секунд ТЕКУЩЕГО юзера по
-- конкретной странице в активном account — read-gate ориентируется
-- на накопленное время, а не на свежий таймер.
--
-- security definer + явный гейт kb.view_pages: RLS на
-- kb_page_view_sessions для SELECT гейтится kb.view_analytics
-- (рядовой сотрудник свои сессии напрямую не видит), поэтому нужна
-- привилегированная обёртка. Возвращает только число секунд своего
-- же юзера — чужие данные не утекают.
-- ============================================================

create or replace function public.kb_my_active_seconds(
  p_page_id uuid
)
returns integer
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(sum(s.duration_seconds), 0)::integer
  from public.kb_page_view_sessions s
  where s.page_id = p_page_id
    and s.account_id = public.get_active_account_id()
    and s.user_id = (select auth.uid())
    and public.has_permission('kb.view_pages');
$$;

comment on function public.kb_my_active_seconds(uuid) is
  'Сумма активных секунд текущего юзера по странице (active account, '
  'гейт kb.view_pages). Для read-gate обязательного чтения — порог '
  'по накопленному времени, не по свежему таймеру.';

grant execute on function public.kb_my_active_seconds(uuid) to authenticated;
