-- ============================================================
-- 076_kb_comments.sql
-- Sprint C / 1.3 — Inline комментарии к KB-страницам.
--
-- Маппинг на BlockNote CommentsExtension API
-- (@blocknote/core/comments/threadstore/ThreadStore):
--   ThreadData       → kb_threads (одна строка = один thread)
--   CommentData[]    → kb_comments (children этого thread'а)
--   CommentReaction  → kb_comment_reactions (Optional, MVP — упрощённо)
--
-- ID'шники threads/comments — uuid, генерируются client-side через
-- crypto.randomUUID() (BlockNote ожидает что caller предоставляет id
-- через createThread() возвращаемый ThreadData; см. ThreadStore.d.ts).
--
-- Permission `kb.comment_pages` (UUID …000061) — отдельное от
-- kb.view_pages: даже если юзер видит страницу, он может не иметь
-- права комментировать (например, hostess читает регламент, но не
-- комментирует — отказ от noise'а в обсуждениях).
--
-- Дефолт permission: owner / admin / accountant / manager — yes;
-- hostess / waiter — no (read-only).
-- ============================================================

-- ============================================================
-- 1. kb_threads
-- ============================================================

create table public.kb_threads (
  id          uuid primary key default gen_random_uuid(),
  page_id     uuid not null references public.kb_pages(id) on delete cascade,
  account_id  uuid not null references public.accounts(id) on delete cascade,

  resolved          boolean not null default false,
  resolved_at       timestamptz,
  resolved_by       uuid references public.profiles(id),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id),

  -- Hard-delete не используем (BlockNote'у нужны thread'ы для рендера
  -- markов в документе; soft-delete через deleted_at). UI скрывает
  -- soft-deleted, но mark в документе остаётся. Если пользователь
  -- удаляет последний comment в thread'е — thread тоже soft-deletes.
  deleted_at  timestamptz,

  -- Произвольная metadata из BlockNote API (на будущее: priority/tags/etc).
  metadata    jsonb not null default '{}'::jsonb
);

create index kb_threads_page_idx
  on public.kb_threads(page_id, created_at desc)
  where deleted_at is null;

comment on table public.kb_threads is
  'Comment-thread на KB-странице. Position в документе хранится '
  'через ProseMirror mark в kb_pages.content (BlockNote managment), '
  'эта таблица — только metadata + список comments.';

-- ============================================================
-- 2. kb_comments
-- ============================================================

create table public.kb_comments (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.kb_threads(id) on delete cascade,
  account_id  uuid not null references public.accounts(id) on delete cascade,

  -- BlockNote CommentBody = массив блоков. Хранится 1-в-1 в jsonb.
  body        jsonb not null,

  author_id   uuid not null references public.profiles(id) on delete restrict,

  -- Reactions: { "👍": ["userId1","userId2"], "❤️": ["userId3"] }.
  -- Формат plain {emoji: userIds[]}, потому что BlockNote'овский
  -- CommentReactionData[] приводится к этому в SupabaseThreadStore.
  reactions   jsonb not null default '{}'::jsonb,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Soft-delete (BlockNote показывает «Comment was deleted» placeholder).
  deleted_at  timestamptz,

  metadata    jsonb not null default '{}'::jsonb
);

create index kb_comments_thread_idx
  on public.kb_comments(thread_id, created_at asc);

create index kb_comments_account_idx
  on public.kb_comments(account_id);

comment on table public.kb_comments is
  'Comment в kb_threads. body — jsonb массив BlockNote-блоков. '
  'Reactions хранятся inline в jsonb {emoji: userIds[]}.';

-- ============================================================
-- 3. RLS
-- ============================================================

alter table public.kb_threads enable row level security;
alter table public.kb_comments enable row level security;

-- THREAD select: видны всем у кого есть kb.view_pages, в active account.
create policy "kb_threads_select" on public.kb_threads
  for select using (
    account_id = public.get_active_account_id()
    and public.has_permission('kb.view_pages')
  );

-- THREAD insert: kb.comment_pages + page реально живёт в active account
-- (защита от cross-tenant insert через crafted page_id).
create policy "kb_threads_insert" on public.kb_threads
  for insert with check (
    account_id = public.get_active_account_id()
    and public.has_permission('kb.comment_pages')
    and exists (
      select 1 from public.kb_pages kp
       where kp.id = kb_threads.page_id
         and kp.account_id = public.get_active_account_id()
         and kp.deleted_at is null
    )
  );

-- THREAD update: kb.comment_pages (resolve/unresolve, delete-by-author).
-- ThreadStoreAuth на client-side ограничивает кто что может (resolve —
-- любой commenter; delete — только editor). Server-RLS даёт «коридор».
create policy "kb_threads_update" on public.kb_threads
  for update using (
    account_id = public.get_active_account_id()
    and public.has_permission('kb.comment_pages')
  );

-- THREAD delete: НЕТ — soft-delete через update deleted_at. Hard-delete
-- зарезервирован для admin-CASCADE через kb_pages.deleted (FK CASCADE).

grant select, insert, update on public.kb_threads to authenticated;

-- COMMENT select: видны если viден сам thread (RLS chain).
create policy "kb_comments_select" on public.kb_comments
  for select using (
    account_id = public.get_active_account_id()
    and public.has_permission('kb.view_pages')
  );

-- COMMENT insert: автор = current user (защита от impersonation),
-- thread живёт в active account, есть kb.comment_pages.
create policy "kb_comments_insert" on public.kb_comments
  for insert with check (
    account_id = public.get_active_account_id()
    and public.has_permission('kb.comment_pages')
    and author_id = auth.uid()
    and exists (
      select 1 from public.kb_threads t
       where t.id = kb_comments.thread_id
         and t.account_id = public.get_active_account_id()
    )
  );

-- COMMENT update: только автор может править свой comment.
-- (BlockNote DefaultThreadStoreAuth canUpdateComment = author only.)
-- Reactions update обрабатывается отдельно через RPC для расширения этого
-- (см. ниже kb_comment_react / kb_comment_unreact).
create policy "kb_comments_update_own" on public.kb_comments
  for update using (
    account_id = public.get_active_account_id()
    and author_id = auth.uid()
  );

grant select, insert, update on public.kb_comments to authenticated;

-- ============================================================
-- 4. RPC для reactions (atomic toggle)
-- ============================================================
--
-- Reactions — JSONB field в kb_comments. Updating через UPDATE прямо
-- из client'а небезопасно: race-condition (два юзера react'ят
-- одновременно — кто-то перезатирает). RPC делает атомарное
-- обновление через jsonb operators.
--
-- kb_comment_react: добавить current user в массив для emoji.
-- kb_comment_unreact: убрать.
-- ============================================================

create or replace function public.kb_comment_react(
  p_comment_id uuid,
  p_emoji text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account uuid := public.get_active_account_id();
  v_existing jsonb;
  v_users jsonb;
begin
  if v_uid is null then
    raise exception 'kb_comment_react: not authenticated' using errcode = '28000';
  end if;
  if not public.has_permission('kb.comment_pages') then
    raise exception 'kb_comment_react: no kb.comment_pages' using errcode = '42501';
  end if;

  -- Берём текущий список юзеров для этого emoji (или пустой массив).
  select coalesce(reactions -> p_emoji, '[]'::jsonb) into v_existing
    from public.kb_comments
   where id = p_comment_id and account_id = v_account;
  if not found then
    raise exception 'kb_comment_react: comment not found' using errcode = '42704';
  end if;

  -- Уже отреагировал? — no-op.
  if v_existing @> to_jsonb(v_uid::text) then
    return;
  end if;

  -- Append uid в массив.
  v_users := v_existing || to_jsonb(v_uid::text);

  update public.kb_comments
     set reactions = jsonb_set(reactions, array[p_emoji], v_users, true),
         updated_at = now()
   where id = p_comment_id and account_id = v_account;
end;
$$;

create or replace function public.kb_comment_unreact(
  p_comment_id uuid,
  p_emoji text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account uuid := public.get_active_account_id();
  v_existing jsonb;
  v_users jsonb;
begin
  if v_uid is null then
    raise exception 'kb_comment_unreact: not authenticated' using errcode = '28000';
  end if;

  select coalesce(reactions -> p_emoji, '[]'::jsonb) into v_existing
    from public.kb_comments
   where id = p_comment_id and account_id = v_account;
  if not found then
    return;  -- no-op
  end if;

  -- Filter out current user.
  select coalesce(jsonb_agg(elem), '[]'::jsonb)
    into v_users
    from jsonb_array_elements(v_existing) as elem
   where elem != to_jsonb(v_uid::text);

  -- Если массив стал пустым — удаляем ключ emoji целиком (clean state).
  if jsonb_array_length(v_users) = 0 then
    update public.kb_comments
       set reactions = reactions - p_emoji,
           updated_at = now()
     where id = p_comment_id and account_id = v_account;
  else
    update public.kb_comments
       set reactions = jsonb_set(reactions, array[p_emoji], v_users, false),
           updated_at = now()
     where id = p_comment_id and account_id = v_account;
  end if;
end;
$$;

grant execute on function public.kb_comment_react(uuid, text) to authenticated;
grant execute on function public.kb_comment_unreact(uuid, text) to authenticated;

-- ============================================================
-- 5. Permission `kb.comment_pages`
-- ============================================================

insert into public.permissions (id, code, description, module) values
  ('10000000-0000-0000-0000-000000000061',
   'kb.comment_pages',
   'Оставлять комментарии к страницам базы знаний',
   'kb');

-- Дефолтная матрица: owner / admin / accountant / manager — yes.
-- Hostess / waiter — нет (только чтение, без участия в обсуждениях
-- регламентов; их feedback идёт через other-channels).
insert into public.role_permissions (role_id, permission_id, granted)
select role_id, '10000000-0000-0000-0000-000000000061'::uuid, true
from (values
  ('00000000-0000-0000-0000-000000000001'::uuid),  -- owner
  ('00000000-0000-0000-0000-000000000002'::uuid),  -- manager
  ('00000000-0000-0000-0000-000000000003'::uuid),  -- admin
  ('00000000-0000-0000-0000-000000000006'::uuid)   -- accountant
) as r(role_id);
