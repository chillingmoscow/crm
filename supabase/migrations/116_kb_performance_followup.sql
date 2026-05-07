-- ============================================================
-- 116_kb_performance_followup.sql
-- KB performance follow-up:
--   1. Lightweight version history summaries.
--   2. Page-level comments RPCs + denormalized thread_kind.
--   3. KB RLS initPlan wrappers for common auth/permission functions.
--   4. kb_save_page returns NULL when no content/title version was created.
-- ============================================================

-- ── Version history summaries ──────────────────────────────

alter table public.kb_page_versions
  add column if not exists plain_text text,
  add column if not exists text_length integer;

update public.kb_page_versions
   set plain_text = coalesce(plain_text, ''),
       text_length = coalesce(text_length, 0)
 where plain_text is null
    or text_length is null;

alter table public.kb_page_versions
  alter column plain_text set default '',
  alter column plain_text set not null,
  alter column text_length set default 0,
  alter column text_length set not null;

comment on column public.kb_page_versions.plain_text is
  'Plain-text snapshot for lightweight version history lists. Legacy rows may be empty.';
comment on column public.kb_page_versions.text_length is
  'Cached character length of plain_text for version delta display.';

-- ── Page-level comments: denormalized kind + RPCs ───────────

alter table public.kb_comments
  add column if not exists thread_kind text not null default 'inline'
  check (thread_kind in ('inline', 'page'));

update public.kb_comments c
   set thread_kind = t.kind
  from public.kb_threads t
 where c.thread_id = t.id
   and c.thread_kind is distinct from t.kind;

create index if not exists kb_comments_page_kind_idx
  on public.kb_comments(page_id, created_at asc)
  where thread_kind = 'page';

create or replace function public.kb_comments_set_page_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_page_id uuid;
  v_kind text;
begin
  select t.page_id, t.kind
    into v_page_id, v_kind
    from public.kb_threads t
   where t.id = new.thread_id;

  if v_page_id is null then
    raise exception 'kb_comments: thread % not found', new.thread_id
      using errcode = '23503';
  end if;

  new.page_id := v_page_id;
  new.thread_kind := coalesce(v_kind, 'inline');
  return new;
end;
$$;

create or replace function public.kb_list_page_comments(p_page_id uuid)
returns table (
  id uuid,
  thread_id uuid,
  body jsonb,
  author_id uuid,
  reactions jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz
)
language sql
security invoker
stable
set search_path = public
as $$
  select
    c.id,
    c.thread_id,
    c.body,
    c.author_id,
    c.reactions,
    c.created_at,
    c.updated_at,
    c.deleted_at
  from public.kb_comments c
  join public.kb_threads t on t.id = c.thread_id
  where c.page_id = p_page_id
    and c.thread_kind = 'page'
    and t.kind = 'page'
    and t.deleted_at is null
  order by c.created_at asc;
$$;

grant execute on function public.kb_list_page_comments(uuid) to authenticated;

create or replace function public.kb_create_page_comment(
  p_page_id uuid,
  p_body jsonb
)
returns table (
  id uuid,
  thread_id uuid,
  body jsonb,
  author_id uuid,
  reactions jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account_id uuid := public.get_active_account_id();
  v_thread_id uuid;
begin
  if v_uid is null then
    raise exception 'kb_create_page_comment: не авторизован'
      using errcode = '42501';
  end if;
  if v_account_id is null then
    raise exception 'kb_create_page_comment: нет активного account'
      using errcode = '42501';
  end if;
  if not public.has_permission('kb.comment_pages') then
    raise exception 'kb_create_page_comment: нет права kb.comment_pages'
      using errcode = '42501';
  end if;
  if p_body is null or jsonb_typeof(p_body) <> 'array' then
    raise exception 'kb_create_page_comment: p_body must be a JSON array'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
      from public.kb_pages p
     where p.id = p_page_id
       and p.account_id = v_account_id
       and p.deleted_at is null
  ) then
    raise exception 'kb_create_page_comment: страница не найдена'
      using errcode = '42501';
  end if;

  insert into public.kb_threads (page_id, account_id, kind, created_by)
  values (p_page_id, v_account_id, 'page', v_uid)
  returning kb_threads.id into v_thread_id;

  return query
  insert into public.kb_comments (thread_id, account_id, body, author_id)
  values (v_thread_id, v_account_id, p_body, v_uid)
  returning
    kb_comments.id,
    kb_comments.thread_id,
    kb_comments.body,
    kb_comments.author_id,
    kb_comments.reactions,
    kb_comments.created_at,
    kb_comments.updated_at,
    kb_comments.deleted_at;
end;
$$;

grant execute on function public.kb_create_page_comment(uuid, jsonb) to authenticated;

-- ── kb_save_page: store summaries and return NULL for no version ─

create or replace function public.kb_save_page(
  p_id uuid,
  p_title text,
  p_icon text,
  p_icon_color text,
  p_content jsonb,
  p_plain_text text,
  p_link_targets uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid              uuid := auth.uid();
  v_page             public.kb_pages%rowtype;
  v_can_edit_any     boolean := public.has_permission('kb.edit_any_page');
  v_can_edit_own     boolean := public.has_permission('kb.edit_own_pages');
  v_content_changed  boolean;
  v_title_changed    boolean;
  v_icon_changed     boolean;
  v_icon_color_changed boolean;
  v_version          integer;
  v_saved_version    integer := null;
begin
  if v_uid is null then
    raise exception 'Не авторизован' using errcode = '42501';
  end if;

  select * into v_page from public.kb_pages where id = p_id;
  if not found or v_page.deleted_at is not null then
    raise exception 'Страница не найдена' using errcode = 'P0002';
  end if;
  if v_page.account_id <> public.get_active_account_id() then
    raise exception 'Страница из другого аккаунта' using errcode = '42501';
  end if;
  if v_page.locked_at is not null then
    raise exception 'Страница заблокирована для редактирования' using errcode = '42501';
  end if;
  if not (v_can_edit_any or (v_can_edit_own and v_page.created_by = v_uid)) then
    raise exception 'Нет права редактировать страницу' using errcode = '42501';
  end if;

  v_content_changed := coalesce(v_page.content, '[]'::jsonb) is distinct from coalesce(p_content, '[]'::jsonb);
  v_title_changed := coalesce(v_page.title, '') is distinct from coalesce(p_title, '');
  v_icon_changed := coalesce(v_page.icon, '') is distinct from coalesce(p_icon, '');
  v_icon_color_changed := coalesce(v_page.icon_color, '') is distinct from coalesce(p_icon_color, '');

  update public.kb_pages
     set title = coalesce(nullif(trim(p_title), ''), 'Без названия'),
         icon = nullif(trim(coalesce(p_icon, '')), ''),
         icon_color = nullif(trim(coalesce(p_icon_color, '')), ''),
         content = coalesce(p_content, '[]'::jsonb),
         plain_text = coalesce(p_plain_text, ''),
         updated_by = v_uid
   where id = p_id;

  if v_content_changed or v_title_changed then
    select coalesce(max(version_number), 0) + 1
      into v_version
      from public.kb_page_versions
     where page_id = p_id;

    insert into public.kb_page_versions (
      page_id,
      account_id,
      version_number,
      title,
      content,
      plain_text,
      text_length,
      created_by
    ) values (
      p_id,
      v_page.account_id,
      v_version,
      coalesce(nullif(trim(p_title), ''), 'Без названия'),
      coalesce(p_content, '[]'::jsonb),
      coalesce(p_plain_text, ''),
      char_length(coalesce(p_plain_text, '')),
      v_uid
    );
    v_saved_version := v_version;
  end if;

  delete from public.kb_page_links where from_page_id = p_id;
  if p_link_targets is not null and array_length(p_link_targets, 1) > 0 then
    insert into public.kb_page_links (from_page_id, to_page_id, account_id)
    select p_id, target_id, v_page.account_id
      from unnest(p_link_targets) as target_id
     where target_id <> p_id
       and exists (
         select 1 from public.kb_pages p
          where p.id = target_id
            and p.account_id = v_page.account_id
            and p.deleted_at is null
       )
    on conflict do nothing;
  end if;

  return v_saved_version;
end;
$$;

grant execute on function public.kb_save_page(uuid, text, text, text, jsonb, text, uuid[]) to authenticated;

-- ── KB RLS initPlan wrappers ────────────────────────────────

drop policy if exists "kb_pages_select" on public.kb_pages;
create policy "kb_pages_select"
  on public.kb_pages for select
  using (
    account_id = (select public.get_active_account_id())
    and (select public.has_permission('kb.view_pages'))
    and (
      deleted_at is null
      or (select public.has_permission('kb.delete_pages'))
    )
  );

drop policy if exists "kb_pages_insert" on public.kb_pages;
create policy "kb_pages_insert"
  on public.kb_pages for insert
  with check (
    account_id = (select public.get_active_account_id())
    and (select public.has_permission('kb.create_pages'))
  );

drop policy if exists "kb_pages_update" on public.kb_pages;
create policy "kb_pages_update"
  on public.kb_pages for update
  using (
    account_id = (select public.get_active_account_id())
    and (
      (select public.has_permission('kb.edit_any_page'))
      or (
        (select public.has_permission('kb.edit_own_pages'))
        and created_by = (select auth.uid())
      )
      or (select public.has_permission('kb.delete_pages'))
    )
  )
  with check (
    account_id = (select public.get_active_account_id())
  );

drop policy if exists "kb_page_versions_select" on public.kb_page_versions;
create policy "kb_page_versions_select"
  on public.kb_page_versions for select
  using (
    account_id = (select public.get_active_account_id())
    and (select public.has_permission('kb.view_pages'))
    and exists (
      select 1 from public.kb_pages p
      where p.id = kb_page_versions.page_id
        and p.account_id = (select public.get_active_account_id())
    )
  );

drop policy if exists "kb_page_versions_insert" on public.kb_page_versions;
create policy "kb_page_versions_insert"
  on public.kb_page_versions for insert
  with check (
    account_id = (select public.get_active_account_id())
    and (
      (select public.has_permission('kb.edit_any_page'))
      or (
        (select public.has_permission('kb.edit_own_pages'))
        and exists (
          select 1 from public.kb_pages p
          where p.id = kb_page_versions.page_id
            and p.created_by = (select auth.uid())
        )
      )
    )
  );

drop policy if exists "kb_page_links_select" on public.kb_page_links;
create policy "kb_page_links_select"
  on public.kb_page_links for select
  using (
    account_id = (select public.get_active_account_id())
    and (select public.has_permission('kb.view_pages'))
  );

drop policy if exists "kb_page_links_write" on public.kb_page_links;
create policy "kb_page_links_write"
  on public.kb_page_links for all
  using (
    account_id = (select public.get_active_account_id())
    and (
      (select public.has_permission('kb.edit_any_page'))
      or (
        (select public.has_permission('kb.edit_own_pages'))
        and exists (
          select 1 from public.kb_pages p
          where p.id = kb_page_links.from_page_id
            and p.created_by = (select auth.uid())
        )
      )
    )
  )
  with check (
    account_id = (select public.get_active_account_id())
    and (
      (select public.has_permission('kb.edit_any_page'))
      or (
        (select public.has_permission('kb.edit_own_pages'))
        and exists (
          select 1 from public.kb_pages p
          where p.id = kb_page_links.from_page_id
            and p.created_by = (select auth.uid())
        )
      )
    )
  );

drop policy if exists "kb_threads_select" on public.kb_threads;
create policy "kb_threads_select" on public.kb_threads
  for select using (
    account_id = (select public.get_active_account_id())
    and (select public.has_permission('kb.view_pages'))
  );

drop policy if exists "kb_threads_insert" on public.kb_threads;
create policy "kb_threads_insert" on public.kb_threads
  for insert with check (
    account_id = (select public.get_active_account_id())
    and (select public.has_permission('kb.comment_pages'))
    and exists (
      select 1 from public.kb_pages kp
       where kp.id = kb_threads.page_id
         and kp.account_id = (select public.get_active_account_id())
         and kp.deleted_at is null
    )
  );

drop policy if exists "kb_threads_update" on public.kb_threads;
create policy "kb_threads_update" on public.kb_threads
  for update using (
    account_id = (select public.get_active_account_id())
    and (select public.has_permission('kb.comment_pages'))
  )
  with check (
    account_id = (select public.get_active_account_id())
  );

drop policy if exists "kb_comments_select" on public.kb_comments;
create policy "kb_comments_select" on public.kb_comments
  for select using (
    account_id = (select public.get_active_account_id())
    and (select public.has_permission('kb.view_pages'))
  );

drop policy if exists "kb_comments_insert" on public.kb_comments;
create policy "kb_comments_insert" on public.kb_comments
  for insert with check (
    account_id = (select public.get_active_account_id())
    and (select public.has_permission('kb.comment_pages'))
    and author_id = (select auth.uid())
    and exists (
      select 1 from public.kb_threads t
       where t.id = kb_comments.thread_id
         and t.account_id = (select public.get_active_account_id())
    )
  );

drop policy if exists "kb_comments_update_own" on public.kb_comments;
create policy "kb_comments_update_own" on public.kb_comments
  for update using (
    account_id = (select public.get_active_account_id())
    and author_id = (select auth.uid())
  );

drop policy if exists "kb_page_reads_select_own" on public.kb_page_reads;
drop policy if exists "kb_page_reads_insert_own" on public.kb_page_reads;
create policy "kb_page_reads_select_own" on public.kb_page_reads
  for select using (
    user_id = (select auth.uid())
    and account_id = (select public.get_active_account_id())
  );
create policy "kb_page_reads_insert_own" on public.kb_page_reads
  for insert with check (
    user_id = (select auth.uid())
    and account_id = (select public.get_active_account_id())
    and exists (
      select 1 from public.kb_pages kp
       where kp.id = kb_page_reads.page_id
         and kp.account_id = (select public.get_active_account_id())
         and kp.deleted_at is null
         and kp.required_reading = true
    )
    and (select public.has_permission('kb.view_pages'))
  );

drop policy if exists "kb_user_favorites_select" on public.kb_user_favorites;
drop policy if exists "kb_user_favorites_insert" on public.kb_user_favorites;
drop policy if exists "kb_user_favorites_delete" on public.kb_user_favorites;
create policy "kb_user_favorites_select" on public.kb_user_favorites
  for select using (
    user_id = (select auth.uid())
    and account_id = (select public.get_active_account_id())
  );
create policy "kb_user_favorites_insert" on public.kb_user_favorites
  for insert with check (
    user_id = (select auth.uid())
    and account_id = (select public.get_active_account_id())
    and exists (
      select 1 from public.kb_pages kp
       where kp.id = kb_user_favorites.page_id
         and kp.account_id = (select public.get_active_account_id())
         and kp.deleted_at is null
    )
    and (select public.has_permission('kb.view_pages'))
  );
create policy "kb_user_favorites_delete" on public.kb_user_favorites
  for delete using (
    user_id = (select auth.uid())
    and account_id = (select public.get_active_account_id())
  );
