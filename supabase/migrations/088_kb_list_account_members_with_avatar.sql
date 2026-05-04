-- ============================================================
-- 088_kb_list_account_members_with_avatar.sql
-- Atomic @-mention chips для людей: добавляем avatar_url в return
-- type RPC kb_list_account_members, чтобы chip мог рендерить мини-фото
-- (а не lucide-User-icon как раньше).
--
-- DROP + CREATE — изменение return-type невозможно через CREATE OR
-- REPLACE.
-- ============================================================

drop function if exists public.kb_list_account_members(text, integer);

create or replace function public.kb_list_account_members(
  p_query text,
  p_limit integer default 10
)
returns table (
  id          uuid,
  first_name  text,
  last_name   text,
  avatar_url  text
)
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select
      public.get_active_account_id()                  as acc,
      lower(coalesce(p_query, ''))                    as q
  )
  select distinct
    p.id,
    p.first_name,
    p.last_name,
    p.avatar_url
  from public.profiles p
  join public.user_venue_roles uvr on uvr.user_id = p.id
  join public.venues v on v.id = uvr.venue_id
  cross join q
  where v.account_id = q.acc
    and uvr.status = 'active'
    and public.has_permission('kb.view_pages')
    and (
      q.q = ''
      or coalesce(p.first_name, '') ilike '%' || q.q || '%'
      or coalesce(p.last_name, '')  ilike '%' || q.q || '%'
    )
  order by p.first_name nulls last, p.last_name nulls last
  limit greatest(1, least(coalesce(p_limit, 10), 25));
$$;

comment on function public.kb_list_account_members(text, integer) is
  'KB @-mentions: список сотрудников активного account с avatar_url. '
  'Используется в chip-style mention''ах (см. kb-staff-mention.tsx).';

grant execute on function public.kb_list_account_members(text, integer) to authenticated;
