-- Две утечки личных данных, найденные при ревью PR #677 (проверены на проде).
--
-- 1. claim_birthday_colleague_targets() / claim_birthday_self_targets() —
--    SECURITY DEFINER без проверки вызывающего. Миграция 140 делала
--    `revoke all ... from public`, но явные права anon/authenticated, которые
--    Supabase выдаёт по умолчанию, это не снимает: функции вызывались
--    анонимно через /rest/v1/rpc с публичным ключом и отдавали имена и даты
--    рождения людей из ВСЕХ аккаунтов. Побочно вызов помечал «уже поздравлен»,
--    и cron не отправлял поздравления. Вызывает их только cron
--    (`/api/cron/birthday-notifications`) сервисным ключом.
--
-- 2. Политика user_venue_roles_select: `user_id = uid OR has_permission(
--    'people.view_staff')` — вторая ветка не ограничена ни заведением, ни
--    аккаунтом. Любой с правом видеть сотрудников читал строки чужих
--    аккаунтов, включая причину увольнения и PIN кассы. Ограничиваем
--    заведениями активного аккаунта: чтения из других заведений своего
--    аккаунта в коде есть (счётчики на странице заведений, поиск в журнале,
--    вход от имени сотрудника), их не ломаем.
--
-- Политика задаётся целиком (alter policy ... using), а не заменой текста,
-- поэтому разница сериализации auth.uid()/uid() между локалью и продом не
-- важна. Применять от supabase_admin, без `psql -1` (свои begin/commit).

begin;

revoke execute on function public.claim_birthday_colleague_targets() from public, anon, authenticated;
revoke execute on function public.claim_birthday_self_targets() from public, anon, authenticated;
grant execute on function public.claim_birthday_colleague_targets() to service_role;
grant execute on function public.claim_birthday_self_targets() to service_role;

-- Аккаунт заведения — через public.venue_account_id (SECURITY DEFINER):
-- подзапрос к venues здесь дал бы бесконечную рекурсию, потому что политика
-- venues сама смотрит в user_venue_roles.
alter policy user_venue_roles_select on public.user_venue_roles using (
  user_id = (select auth.uid())
  or (
    (select public.has_permission('people.view_staff'))
    and public.venue_account_id(venue_id) = (select public.get_active_account_id())
  )
);

-- Проверяем результат, а не надеемся на него: от роли-не-владельца REVOKE
-- выдаёт только WARNING.
do $$
begin
  if has_function_privilege('anon', 'public.claim_birthday_colleague_targets()', 'EXECUTE')
    or has_function_privilege('anon', 'public.claim_birthday_self_targets()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.claim_birthday_colleague_targets()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.claim_birthday_self_targets()', 'EXECUTE')
  then
    raise exception 'claim_birthday_* всё ещё доступны anon/authenticated: применяйте от supabase_admin';
  end if;
end $$;

commit;
