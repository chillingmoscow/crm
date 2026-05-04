-- ============================================================
-- 100_kb_notif_emitters_payload.sql
--
-- Refresh всех KB-emitter'ов (079→094, 083, 090, 094, 095) с
-- заполнением новых полей notifications: category, actor_user_id,
-- entity_type, entity_id, payload. Позволяет Notion-style bell
-- рендерить preview-cards с actor + entity + snippet.
--
-- Sprint E §1, миграция 100.
-- ============================================================

-- ============================================================
-- 1. kb_notify_required_reading (refresh миграции 094)
-- ============================================================
-- Required-reading toggle: notify all members с kb.view_pages.
-- Actor = toggler (auth.uid()), entity = kb_page, payload.preview =
-- первые 180 символов plain_text страницы (если есть).

create or replace function public.kb_notify_required_reading()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link    text;
  v_uid     uuid := auth.uid();
  v_preview text;
begin
  if v_uid is null then
    return NEW;
  end if;

  if NEW.required_reading is not true then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and coalesce(OLD.required_reading, false) = true then
    return NEW;
  end if;

  v_link := '/knowledge/' || NEW.slug;
  v_preview := substr(coalesce(NEW.plain_text, ''), 1, 180);

  insert into public.notifications (
    user_id, type, title, body, link,
    category, actor_user_id, entity_type, entity_id, payload
  )
  select distinct
    uvr.user_id,
    'kb.required_reading_assigned'                              as type,
    'Требуется прочесть: ' || coalesce(NEW.title, 'без названия') as title,
    'Страница помечена как обязательная к прочтению. ' ||
      'Ознакомьтесь и подтвердите прочтение в баннере.'         as body,
    v_link                                                      as link,
    'kb'        as category,
    v_uid       as actor_user_id,
    'kb_page'   as entity_type,
    NEW.id      as entity_id,
    jsonb_build_object(
      'preview', v_preview,
      'preview_kind', 'page_excerpt',
      'page_title', coalesce(NEW.title, 'без названия')
    )           as payload
  from public.user_venue_roles uvr
  join public.venues v on v.id = uvr.venue_id
  join public.role_permissions rp on rp.role_id = uvr.role_id
  join public.permissions perm
    on perm.id = rp.permission_id and perm.code = 'kb.view_pages'
  join public.roles r on r.id = uvr.role_id
  left join public.account_role_permissions arp
    on r.account_id is null
   and arp.account_id = NEW.account_id
   and arp.role_id = rp.role_id
   and arp.permission_id = rp.permission_id
  where v.account_id = NEW.account_id
    and uvr.status = 'active'
    and coalesce(arp.granted, rp.granted) = true
    and uvr.user_id <> v_uid;

  return NEW;
end;
$$;

comment on function public.kb_notify_required_reading() is
  'Notify-trigger required_reading off→on (UPDATE) или сразу true '
  '(INSERT) → bell-notif всем active members с kb.view_pages, кроме '
  'toggler''а. С payload-preview и actor для Notion-style bell. '
  'Sprint E §1, refresh миграции 100.';

-- ============================================================
-- 2. kb_notify_comment_added (refresh миграций 094, 095)
-- ============================================================
-- Notify thread author + previous commenters с 5-min cooldown.
-- Actor = NEW.author_id (commenter), entity = kb_thread, payload.preview
-- = текст нового comment'а (extract из BN body).

create or replace function public.kb_notify_comment_added()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread record;
  v_link   text;
  v_preview text;
  v_cooldown_window interval := interval '5 minutes';
begin
  if NEW.deleted_at is not null then
    return NEW;
  end if;

  select t.id, t.created_by, t.page_id, p.slug, p.title, p.account_id
    into v_thread
    from public.kb_threads t
    join public.kb_pages p on p.id = t.page_id
   where t.id = NEW.thread_id
     and t.deleted_at is null
     and p.deleted_at is null;
  if not found then
    return NEW;
  end if;

  v_link := '/knowledge/' || v_thread.slug;

  -- Extract first 180 chars из BN body для preview. body — jsonb-array
  -- блоков; берём конкатенацию text-run'ов первого paragraph'а как
  -- approximation. Для kbStaffMention'ов добавляем @FullName.
  v_preview := substr(
    coalesce(
      (
        select string_agg(
          case
            when item->>'type' = 'text' then item->>'text'
            when item->>'type' = 'kbStaffMention' then '@' || (item->'props'->>'fullName')
            else ''
          end,
          ''
          order by ord
        )
        from jsonb_array_elements(NEW.body) with ordinality blk(b, ord)
        cross join lateral jsonb_array_elements(b->'content') item
        where b->>'type' = 'paragraph'
      ),
      ''
    ),
    1, 180
  );

  -- 1. Thread author (с cooldown).
  if v_thread.created_by is not null
     and v_thread.created_by <> NEW.author_id
     and exists (
       select 1 from public.user_venue_roles uvr
       join public.venues v on v.id = uvr.venue_id
       where uvr.user_id = v_thread.created_by
         and v.account_id = v_thread.account_id
         and uvr.status = 'active'
     )
     and not exists (
       select 1 from public.kb_thread_recipient_cooldown c
       where c.thread_id = NEW.thread_id
         and c.recipient_id = v_thread.created_by
         and c.last_notified_at > now() - v_cooldown_window
     )
  then
    insert into public.notifications (
      user_id, type, title, body, link,
      category, actor_user_id, entity_type, entity_id, payload
    )
    values (
      v_thread.created_by,
      'kb.comment_replied',
      'Новый комментарий: ' || coalesce(v_thread.title, 'без названия'),
      'В вашем треде появился новый комментарий.',
      v_link,
      'kb',
      NEW.author_id,
      'kb_thread',
      v_thread.id,
      jsonb_build_object(
        'preview', v_preview,
        'preview_kind', 'comment_text',
        'page_title', coalesce(v_thread.title, 'без названия')
      )
    );
    insert into public.kb_thread_recipient_cooldown (thread_id, recipient_id)
    values (NEW.thread_id, v_thread.created_by)
    on conflict (thread_id, recipient_id)
      do update set last_notified_at = now();
  end if;

  -- 2. Previous commenters (CTE pipeline + per-recipient cooldown,
  --    Codex #84 P1 fix из миграции 095 сохраняем).
  with eligible as (
    select distinct c.author_id
    from public.kb_comments c
    where c.thread_id = NEW.thread_id
      and c.id <> NEW.id
      and c.author_id <> NEW.author_id
      and c.author_id is distinct from v_thread.created_by
      and c.deleted_at is null
      and exists (
        select 1 from public.user_venue_roles uvr
        join public.venues v on v.id = uvr.venue_id
        where uvr.user_id = c.author_id
          and v.account_id = v_thread.account_id
          and uvr.status = 'active'
      )
      and not exists (
        select 1 from public.kb_thread_recipient_cooldown cd
        where cd.thread_id = NEW.thread_id
          and cd.recipient_id = c.author_id
          and cd.last_notified_at > now() - v_cooldown_window
      )
  ),
  inserted_notifs as (
    insert into public.notifications (
      user_id, type, title, body, link,
      category, actor_user_id, entity_type, entity_id, payload
    )
    select
      e.author_id,
      'kb.comment_replied',
      'Новый комментарий: ' || coalesce(v_thread.title, 'без названия'),
      'В треде, где вы участвовали, появился новый комментарий.',
      v_link,
      'kb',
      NEW.author_id,
      'kb_thread',
      v_thread.id,
      jsonb_build_object(
        'preview', v_preview,
        'preview_kind', 'comment_text',
        'page_title', coalesce(v_thread.title, 'без названия')
      )
    from eligible e
    returning user_id
  )
  insert into public.kb_thread_recipient_cooldown (thread_id, recipient_id)
  select NEW.thread_id, user_id from inserted_notifs
  on conflict (thread_id, recipient_id)
    do update set last_notified_at = now();

  return NEW;
end;
$$;

comment on function public.kb_notify_comment_added() is
  'Notify-trigger новый comment в треде → bell-notif для thread '
  'author + previous commenters с 5-мин cooldown. С payload-preview '
  '(текст коммента) и actor для Notion-style bell. Sprint E §1, '
  'refresh миграции 100.';

-- ============================================================
-- 3. kb_emit_page_mentions (refresh миграции 093)
-- ============================================================
-- Page @-mention notifications, per-version idempotency.
-- Actor = caller (v_uid), entity = kb_page, payload.preview = первые
-- 180 символов plain_text страницы.

drop function if exists public.kb_emit_page_mentions(uuid, uuid[], integer);

create or replace function public.kb_emit_page_mentions(
  p_page_id        uuid,
  p_user_ids       uuid[],
  p_version_number integer default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid := public.get_active_account_id();
  v_uid        uuid := auth.uid();
  v_page       record;
  v_link       text;
  v_preview    text;
  v_inserted_user_id uuid;
  v_can_edit_any boolean := public.has_permission('kb.edit_any_page');
  v_can_edit_own boolean := public.has_permission('kb.edit_own_pages');
  v_version_id uuid;
  v_emitted    int := 0;
begin
  if v_uid is null then return 0; end if;
  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return 0;
  end if;

  select id, slug, title, account_id, created_by, plain_text
    into v_page
    from public.kb_pages
   where id = p_page_id
     and account_id = v_account_id
     and deleted_at is null;
  if not found then return 0; end if;

  if not (
    v_can_edit_any
    or (v_can_edit_own and v_page.created_by = v_uid)
  ) then
    return 0;
  end if;

  if p_version_number is not null then
    select id into v_version_id
      from public.kb_page_versions
     where page_id = p_page_id
       and version_number = p_version_number;
    if v_version_id is null then
      v_version_id := '00000000-0000-0000-0000-000000000000';
    end if;
  else
    v_version_id := '00000000-0000-0000-0000-000000000000';
  end if;

  v_link := '/knowledge/' || v_page.slug;
  v_preview := substr(coalesce(v_page.plain_text, ''), 1, 180);

  for v_inserted_user_id in
    insert into public.kb_page_user_mentions (page_id, user_id, account_id, version_id)
    select distinct p_page_id, u, v_account_id, v_version_id
      from unnest(p_user_ids) as u
     where u <> v_uid
       and exists (
         select 1 from public.user_venue_roles uvr
         join public.venues v on v.id = uvr.venue_id
         where uvr.user_id = u
           and v.account_id = v_account_id
           and uvr.status = 'active'
       )
    on conflict (page_id, user_id, version_id) do nothing
    returning user_id
  loop
    insert into public.notifications (
      user_id, type, title, body, link,
      category, actor_user_id, entity_type, entity_id, payload
    )
    values (
      v_inserted_user_id,
      'kb.mention_in_page',
      'Вас упомянули: ' || coalesce(v_page.title, 'без названия'),
      'Вас @-упомянули в странице базы знаний.',
      v_link,
      'kb',
      v_uid,
      'kb_page',
      p_page_id,
      jsonb_build_object(
        'preview', v_preview,
        'preview_kind', 'page_excerpt',
        'page_title', coalesce(v_page.title, 'без названия')
      )
    );
    v_emitted := v_emitted + 1;
  end loop;

  return v_emitted;
end;
$$;

comment on function public.kb_emit_page_mentions(uuid, uuid[], integer) is
  'Per-version idempotent emit для @-mention notifications в KB-странице. '
  'С payload-preview и actor. Sprint E §1, refresh миграции 100.';

revoke all on function public.kb_emit_page_mentions(uuid, uuid[], integer) from public;
grant execute on function public.kb_emit_page_mentions(uuid, uuid[], integer) to authenticated;

-- ============================================================
-- 4. kb_emit_comment_mentions (refresh миграции 090)
-- ============================================================
-- Comment @-mention notifications. Actor = caller (комментер),
-- entity = kb_comment, payload.preview = текст коммента.

create or replace function public.kb_emit_comment_mentions(
  p_comment_id uuid,
  p_user_ids   uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid := public.get_active_account_id();
  v_uid        uuid := auth.uid();
  v_comment    record;
  v_link       text;
  v_preview    text;
  v_inserted_user_id uuid;
  v_can_comment boolean := public.has_permission('kb.comment_pages');
begin
  if v_uid is null then return; end if;
  if not v_can_comment then return; end if;
  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return;
  end if;

  select
    c.id              as comment_id,
    c.author_id       as author_id,
    c.body            as comment_body,
    p.slug            as page_slug,
    p.title           as page_title,
    p.account_id      as account_id,
    t.id              as thread_id
  into v_comment
  from public.kb_comments c
  join public.kb_threads  t on t.id = c.thread_id
  join public.kb_pages    p on p.id = t.page_id
  where c.id = p_comment_id
    and c.deleted_at is null
    and t.deleted_at is null
    and p.deleted_at is null
    and p.account_id = v_account_id;
  if not found then return; end if;

  if v_comment.author_id <> v_uid then return; end if;

  v_link := '/knowledge/' || v_comment.page_slug;

  -- Extract preview-text из comment body (JSON-parsing аналогично
  -- kb_notify_comment_added выше).
  v_preview := substr(
    coalesce(
      (
        select string_agg(
          case
            when item->>'type' = 'text' then item->>'text'
            when item->>'type' = 'kbStaffMention' then '@' || (item->'props'->>'fullName')
            else ''
          end,
          ''
          order by ord
        )
        from jsonb_array_elements(v_comment.comment_body) with ordinality blk(b, ord)
        cross join lateral jsonb_array_elements(b->'content') item
        where b->>'type' = 'paragraph'
      ),
      ''
    ),
    1, 180
  );

  for v_inserted_user_id in
    insert into public.kb_comment_user_mentions (comment_id, user_id, account_id)
    select distinct p_comment_id, u, v_account_id
      from unnest(p_user_ids) as u
     where u <> v_uid
       and exists (
         select 1 from public.user_venue_roles uvr
         join public.venues v on v.id = uvr.venue_id
         where uvr.user_id = u
           and v.account_id = v_account_id
           and uvr.status = 'active'
       )
    on conflict (comment_id, user_id) do nothing
    returning user_id
  loop
    insert into public.notifications (
      user_id, type, title, body, link,
      category, actor_user_id, entity_type, entity_id, payload
    )
    values (
      v_inserted_user_id,
      'kb.mention_in_comment',
      'Вас упомянули в комментарии: ' || coalesce(v_comment.page_title, 'без названия'),
      'Вас @-упомянули в обсуждении на странице базы знаний.',
      v_link,
      'kb',
      v_uid,
      'kb_comment',
      p_comment_id,
      jsonb_build_object(
        'preview', v_preview,
        'preview_kind', 'comment_text',
        'page_title', coalesce(v_comment.page_title, 'без названия'),
        'thread_id', v_comment.thread_id
      )
    );
  end loop;
end;
$$;

comment on function public.kb_emit_comment_mentions(uuid, uuid[]) is
  'Idempotent emit @-mention notifications в KB-комментариях с payload-'
  'preview и actor. Sprint E §1, refresh миграции 100.';

revoke all on function public.kb_emit_comment_mentions(uuid, uuid[]) from public;
grant execute on function public.kb_emit_comment_mentions(uuid, uuid[]) to authenticated;
