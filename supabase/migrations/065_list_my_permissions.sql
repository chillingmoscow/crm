-- ============================================================
-- 065_list_my_permissions.sql
-- RPC list_my_permissions() — массив всех permission codes,
-- которые есть у текущего auth.uid() в активном venue.
--
-- Зачем: dashboard layout фильтрует пункты меню по permission'ам.
-- Без batch-fetch'а пришлось бы делать ~12 has_permission()
-- round-trip'ов на каждый рендер layout'а. Один RPC даёт всё за раз.
--
-- Семантика идентична has_permission() из миграции 022: membership
-- active, текущий venue, и **с учётом account_role_permissions
-- overrides** — `coalesce(arp.granted, rp.granted) = true`. Без
-- этого left-join'а account-customised permissions (миграция 022)
-- игнорировались бы и sidebar расходился с реальной авторизацией.
-- ============================================================

create or replace function public.list_my_permissions()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct p.code order by p.code), '{}')
    from public.user_venue_roles uvr
    join public.roles r on r.id = uvr.role_id
    join public.role_permissions rp on rp.role_id = uvr.role_id
    join public.permissions p on p.id = rp.permission_id
    left join public.account_role_permissions arp
      on r.account_id is null
     and arp.account_id = public.get_active_account_id()
     and arp.role_id = rp.role_id
     and arp.permission_id = rp.permission_id
   where uvr.user_id = auth.uid()
     and uvr.venue_id = public.get_active_venue_id()
     and uvr.status = 'active'
     and coalesce(arp.granted, rp.granted) = true;
$$;

comment on function public.list_my_permissions() is
  'Список permission codes, гранчированных текущему пользователю '
  'в активном venue. Используется в dashboard layout для одно-RPC '
  'фильтрации sidebar-пунктов по правам (вместо has_permission per item).';

grant execute on function public.list_my_permissions() to authenticated;
