-- 103_has_permission_override_fix.sql
--
-- Bug: has_permission И list_my_permissions INNER JOIN'ят role_permissions,
-- поэтому override из account_role_permissions может только изменить
-- уже существующий default-row, но не добавить новое право, которого в
-- default-наборе системной роли нет.
--
-- Симптом: владелец аккаунта включил `kb.comment_pages` для системной
-- роли «Хостес» (у которой в default только `kb.view_pages`); запись
-- легла в account_role_permissions с granted=true, но has_permission
-- продолжала возвращать false. Аналогично list_my_permissions ломает
-- sidebar-gating в layout'е — backend разрешает, фронт прячет.
--
-- Fix: переписать обе функции так, чтобы default + override
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

-- list_my_permissions (миграция 065) — то же исправление: UNION
-- default'ов и override'ов, override-row'ы выигрывают.
create or replace function public.list_my_permissions()
returns text[]
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
  -- Кандидаты — все (role, permission) пары, относящиеся к active-юзеру:
  -- объединение default'ов из role_permissions и override'ов из
  -- account_role_permissions (последние применимы только к system-ролям).
  candidates as (
    select rp.role_id, rp.permission_id
      from public.role_permissions rp
      join active a on a.role_id = rp.role_id
    union
    select arp.role_id, arp.permission_id
      from public.account_role_permissions arp
      join active a on a.role_id = arp.role_id
     where a.role_account_id is null
       and arp.account_id = public.get_active_account_id()
  ),
  resolved as (
    select c.role_id, c.permission_id,
           coalesce(arp.granted, rp.granted, false) as granted
      from candidates c
      left join public.account_role_permissions arp
        on arp.role_id = c.role_id
       and arp.permission_id = c.permission_id
       and arp.account_id = public.get_active_account_id()
      left join public.role_permissions rp
        on rp.role_id = c.role_id
       and rp.permission_id = c.permission_id
  )
  select coalesce(array_agg(distinct p.code order by p.code), '{}')
    from resolved r
    join public.permissions p on p.id = r.permission_id
   where r.granted = true;
$$;
