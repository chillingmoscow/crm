-- ============================================================
-- 101_kb_resolve_users_by_ids.sql
--
-- RPC `kb_resolve_users_by_ids(p_user_ids uuid[])` — account-scoped
-- batch-fetch профилей по точному списку user-id'ов. Используется
-- comments-store'ом (resolveKbUsers) и bell'ом (getNotificationActors)
-- вместо `kb_list_account_members(p_query='', p_limit=200)`, который
-- hard-cap'ит на 25 results (миграция 088). При >25 members часть
-- юзеров не находилась → BN-ThreadsSidebar крашился (Codex #92 P1).
--
-- Account-membership filter сохраняется (тот же что в 088): только
-- active members любого venue в active account caller'а. Юзеры вне
-- аккаунта возвращаются НЕ возвращаются — caller получит для них
-- placeholder.
-- ============================================================

create or replace function public.kb_resolve_users_by_ids(
  p_user_ids uuid[]
)
returns table (
  id uuid,
  first_name text,
  last_name text,
  avatar_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (p.id)
    p.id,
    p.first_name,
    p.last_name,
    p.avatar_url
  from public.profiles p
  join public.user_venue_roles uvr on uvr.user_id = p.id
  join public.venues v on v.id = uvr.venue_id
  where v.account_id = public.get_active_account_id()
    and uvr.status = 'active'
    and p.id = any(p_user_ids);
$$;

comment on function public.kb_resolve_users_by_ids(uuid[]) is
  'Account-scoped batch-fetch профилей по точному списку user-id''ов. '
  'Без лимита: возвращает все matched ids в active account. '
  'Replaces kb_list_account_members(p_query='''') hack для '
  'comments-store.resolveKbUsers и bell.getNotificationActors. '
  'Sprint E §2 / fix Codex #92 P1.';

revoke all on function public.kb_resolve_users_by_ids(uuid[]) from public;
grant execute on function public.kb_resolve_users_by_ids(uuid[]) to authenticated;
