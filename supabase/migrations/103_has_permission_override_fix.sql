-- 103_has_permission_override_fix.sql
--
-- Bug: has_permission INNER JOIN'ит role_permissions, поэтому override
-- из account_role_permissions может только изменить уже существующий
-- default-row, но не добавить новое право, которого в default-наборе
-- системной роли нет.
--
-- Симптом: владелец аккаунта включил `kb.comment_pages` для системной
-- роли «Хостес» (у которой в default только `kb.view_pages`); запись
-- легла в account_role_permissions с granted=true, но has_permission
-- продолжала возвращать false.
--
-- Fix: переписать has_permission так, чтобы default + override
-- объединялись через LEFT JOIN'ы; coalesce(override, default) решает,
-- granted ли право. Если ни default'а, ни override'а нет — false.

create or replace function public.has_permission(permission_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with active as (
    select uvr.role_id, r.account_id as role_account_id
    from public.user_venue_roles uvr
    join public.roles r on r.id = uvr.role_id
    where uvr.user_id = auth.uid()
      and uvr.venue_id = public.get_active_venue_id()
      and uvr.status = 'active'
  ),
  perm as (
    select id from public.permissions where code = permission_code
  )
  select exists (
    select 1
    from active a
    cross join perm
    left join public.account_role_permissions arp
      on a.role_account_id is null
     and arp.account_id = public.get_active_account_id()
     and arp.role_id = a.role_id
     and arp.permission_id = perm.id
    left join public.role_permissions rp
      on rp.role_id = a.role_id
     and rp.permission_id = perm.id
    where coalesce(arp.granted, rp.granted, false) = true
  );
$$;
