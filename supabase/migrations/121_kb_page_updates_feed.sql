-- 121_kb_page_updates_feed.sql
-- Lightweight Notion-style Updates feed for one KB page.
-- Version History keeps restore snapshots; Updates is a one-year activity
-- feed and never returns heavy page content.

create index if not exists audit_logs_kb_page_updates_idx
  on public.audit_logs(account_id, entity_type, entity_id, created_at desc)
  where entity_type in ('kb_page', 'kb_thread');

create or replace function public.kb_set_page_lock(
  p_page_id uuid,
  p_locked  boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account_id uuid := public.get_active_account_id();
  v_title text;
  v_slug text;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.has_permission('kb.lock_pages') then
    raise exception 'kb.lock_pages permission required' using errcode = '42501';
  end if;

  select title, slug
    into v_title, v_slug
    from public.kb_pages
   where id = p_page_id
     and account_id = v_account_id
     and deleted_at is null;

  if not found then
    raise exception 'Page not found or not accessible' using errcode = '42704';
  end if;

  if p_locked then
    update public.kb_pages
       set locked_at = now(),
           locked_by = v_uid
     where id = p_page_id;
  else
    update public.kb_pages
       set locked_at = null,
           locked_by = null
     where id = p_page_id;
  end if;

  insert into public.audit_logs (
    account_id,
    user_id,
    action_code,
    entity_type,
    entity_id,
    details
  ) values (
    v_account_id,
    v_uid,
    case when p_locked then 'kb_page.locked' else 'kb_page.unlocked' end,
    'kb_page',
    p_page_id,
    jsonb_build_object('title', v_title, 'slug', v_slug)
  );
end;
$$;

comment on function public.kb_set_page_lock(uuid, boolean) is
  'Toggle Notion-style KB page lock. Also writes lightweight lock/unlock events for page Updates.';

grant execute on function public.kb_set_page_lock(uuid, boolean) to authenticated;

create or replace function public.kb_list_page_updates(
  p_page_id uuid,
  p_limit integer default 80
)
returns table (
  id text,
  source text,
  action_code text,
  created_at timestamptz,
  actor_id uuid,
  actor_first_name text,
  actor_last_name text,
  actor_avatar_url text,
  details jsonb
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account_id uuid := public.get_active_account_id();
  v_limit integer := least(greatest(coalesce(p_limit, 80), 1), 200);
begin
  if v_uid is null then
    raise exception 'Не авторизован' using errcode = '42501';
  end if;
  if v_account_id is null then
    raise exception 'Нет активного account' using errcode = '42501';
  end if;
  if not public.has_permission('kb.view_pages') then
    raise exception 'Нет права просматривать базу знаний' using errcode = '42501';
  end if;
  if not exists (
    select 1
      from public.kb_pages p
     where p.id = p_page_id
       and p.account_id = v_account_id
       and p.deleted_at is null
  ) then
    raise exception 'Страница не найдена' using errcode = 'P0002';
  end if;

  return query
  with raw_updates as (
    select
      ('version:' || v.id::text) as id,
      'version'::text as source,
      case
        when coalesce(v.change_kinds, '{}'::text[]) @> array['restore']::text[]
          then 'kb_page.version_restored'
        else 'kb_page.edited'
      end as action_code,
      coalesce(v.updated_at, v.created_at) as created_at,
      v.created_by as actor_id,
      jsonb_build_object(
        'title', v.title,
        'change_kinds', coalesce(v.change_kinds, '{}'::text[]),
        'text_length', v.text_length
      ) as details
    from public.kb_page_versions v
    where v.page_id = p_page_id
      and v.account_id = v_account_id
      and coalesce(v.updated_at, v.created_at) >= now() - interval '1 year'

    union all

    select
      ('audit:' || a.id::text) as id,
      'audit'::text as source,
      a.action_code,
      a.created_at,
      a.user_id as actor_id,
      coalesce(a.details, '{}'::jsonb) as details
    from public.audit_logs a
    where a.account_id = v_account_id
      and a.created_at >= now() - interval '1 year'
      and (
        (a.entity_type = 'kb_page' and a.entity_id = p_page_id)
        or (
          a.entity_type = 'kb_thread'
          and a.details ->> 'page_id' = p_page_id::text
        )
      )

    union all

    select
      ('comment:' || c.id::text) as id,
      'comment'::text as source,
      case
        when c.thread_kind = 'page' then 'kb_comment.page_created'
        else 'kb_comment.inline_created'
      end as action_code,
      c.created_at,
      c.author_id as actor_id,
      jsonb_build_object(
        'thread_id', c.thread_id,
        'thread_kind', c.thread_kind,
        'deleted', c.deleted_at is not null
      ) as details
    from public.kb_comments c
    where c.page_id = p_page_id
      and c.account_id = v_account_id
      and c.created_at >= now() - interval '1 year'
  )
  select
    u.id,
    u.source,
    u.action_code,
    u.created_at,
    u.actor_id,
    pr.first_name as actor_first_name,
    pr.last_name as actor_last_name,
    pr.avatar_url as actor_avatar_url,
    u.details
  from raw_updates u
  left join public.profiles pr on pr.id = u.actor_id
  order by u.created_at desc, u.id desc
  limit v_limit;
end;
$$;

comment on function public.kb_list_page_updates(uuid, integer) is
  'Lightweight one-year Updates feed for a single KB page. Checks page visibility and returns no heavy content snapshots.';

revoke all on function public.kb_list_page_updates(uuid, integer) from public;
grant execute on function public.kb_list_page_updates(uuid, integer) to authenticated;
