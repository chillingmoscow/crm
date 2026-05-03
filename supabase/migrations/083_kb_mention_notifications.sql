-- ============================================================
-- 083_kb_mention_notifications.sql
-- Sprint D / Phase 4b — Notifications для @-mentions и comments.
--
-- Закрывает три пункта плана:
--   • §2.7 / §2.8 — push-notification @-упомянутым в странице.
--   • §2.8-G — push-notification @-упомянутым в комментариях /
--     authors-у thread'а / previous commenters при new comment.
--
-- Page-mentions (страницы):
--   • Tracking table `kb_page_user_mentions(page_id, user_id)` —
--     один INSERT на user'а. PK гарантирует, что юзер получит
--     notification ОДИН РАЗ — повторный save с тем же mention'ом
--     не даст спам каждые 2 сек на debounced auto-save.
--   • RPC `kb_emit_page_mentions(p_page_id, p_user_ids uuid[])` —
--     batch-вызывается из server-action saveKbPage после успешного
--     save'а. Insert'ит в tracking-table on conflict do nothing,
--     RETURNING — для новых rows эмитит notification.
--
-- Comment-events (треды):
--   • Trigger `kb_notify_comment` на INSERT в kb_comments.
--   • При создании comment'а в thread'е notify:
--     - thread.created_by (если не сам commenter)
--     - distinct previous commenters в этом thread'е (не сам commenter)
--   • Type 'kb.comment_replied' — соединённый event-type для обоих
--     сценариев (reply на свой comment / activity в thread'е где ты
--     участвовал).
--
-- @-mentions В комментариях НЕ покрыты — extracting из BlockNote body
-- jsonb на стороне SQL слишком сложно. Если понадобится — отдельный
-- PR с client-side extraction (как с saveKbPage), передавать через
-- метаданные comment'а.
-- ============================================================

-- ============================================================
-- 1. kb_page_user_mentions — idempotency для page-notifications
-- ============================================================

create table public.kb_page_user_mentions (
  page_id            uuid not null references public.kb_pages(id) on delete cascade,
  user_id            uuid not null references auth.users(id)      on delete cascade,
  account_id         uuid not null references public.accounts(id) on delete cascade,
  first_notified_at  timestamptz not null default now(),
  primary key (page_id, user_id)
);

create index kb_page_user_mentions_user_idx
  on public.kb_page_user_mentions(account_id, user_id);

comment on table public.kb_page_user_mentions is
  'Idempotency-маркер для @-mention notifications на KB-страницах. '
  'PK (page_id, user_id) гарантирует, что юзер получит notification '
  'один раз на страницу — повторный save с тем же mention''ом не '
  'спамит. См. RPC kb_emit_page_mentions.';

alter table public.kb_page_user_mentions enable row level security;
-- Read-only для юзера (увидеть свои mention'ы — опциональная фича).
-- Insert — только через security definer RPC.
create policy "kb_page_user_mentions_select_own"
  on public.kb_page_user_mentions for select
  using (
    user_id = auth.uid()
    and account_id = public.get_active_account_id()
  );
grant select on public.kb_page_user_mentions to authenticated;

-- ============================================================
-- 2. RPC kb_emit_page_mentions — page @-mention pump
-- ============================================================

create or replace function public.kb_emit_page_mentions(
  p_page_id  uuid,
  p_user_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid := public.get_active_account_id();
  v_uid        uuid := auth.uid();
  v_page       record;
  v_link       text;
  v_inserted_user_id uuid;
begin
  if v_uid is null then
    return; -- silent no-op для unauthorized — caller всё равно
            -- проверяет permission на save'е выше
  end if;

  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return;
  end if;

  -- Валидируем page: live, в active account.
  select id, slug, title, account_id into v_page
    from public.kb_pages
   where id = p_page_id
     and account_id = v_account_id
     and deleted_at is null;
  if not found then
    return;
  end if;

  v_link := '/knowledge/' || v_page.slug;

  -- Вставляем tracking-row для каждого distinct user_id, исключая
  -- самого автора правки (self-mention не нотифицируется). Получаем
  -- ТОЛЬКО новые user_ids (которых не было) через ON CONFLICT DO
  -- NOTHING + RETURNING.
  for v_inserted_user_id in
    insert into public.kb_page_user_mentions (page_id, user_id, account_id)
    select distinct p_page_id, u, v_account_id
      from unnest(p_user_ids) as u
     where u <> v_uid
       and exists (
         -- Защита от cross-tenant: упомянутый user должен быть в active
         -- account'е. Pool — те же members, что @-mention picker.
         select 1 from public.user_venue_roles uvr
         join public.venues v on v.id = uvr.venue_id
         where uvr.user_id = u
           and v.account_id = v_account_id
           and uvr.status = 'active'
       )
    on conflict (page_id, user_id) do nothing
    returning user_id
  loop
    insert into public.notifications (user_id, type, title, body, link)
    values (
      v_inserted_user_id,
      'kb.mention_in_page',
      'Вас упомянули: ' || coalesce(v_page.title, 'без названия'),
      'Вас @-упомянули в странице базы знаний.',
      v_link
    );
  end loop;
end;
$$;

comment on function public.kb_emit_page_mentions(uuid, uuid[]) is
  'Idempotent emit для @-mention notifications в KB-странице. Batch-'
  'вызывается из server-action saveKbPage после успешного save''а. '
  'Использует kb_page_user_mentions PK для one-shot guarantee. '
  'Sprint D Phase 4b plan §2.7/§2.8.';

revoke all on function public.kb_emit_page_mentions(uuid, uuid[]) from public;
grant execute on function public.kb_emit_page_mentions(uuid, uuid[]) to authenticated;

-- ============================================================
-- 3. Trigger kb_notify_comment — comment-thread participation
-- ============================================================
--
-- На каждый INSERT в kb_comments эмитим notification:
--   1. thread.created_by — author оригинального thread'а (если не
--      сам commenter)
--   2. distinct previous commenters в этом thread'е (исключая сам
--      NEW.author_id и thread.created_by чтобы не дублировать)
--
-- Спам-защита: BlockNote делает edit как UPDATE, не INSERT — fires
-- только на новый comment. Если thread'а нет (deleted) — silent
-- skip.

create or replace function public.kb_notify_comment_added()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread record;
  v_page_slug text;
  v_page_title text;
  v_link text;
begin
  -- Soft-deleted comment — не нотифицируем (это не «новый comment»).
  if NEW.deleted_at is not null then
    return NEW;
  end if;

  -- Берём thread для author'а + page для link'а.
  select t.id, t.created_by, t.page_id, p.slug, p.title
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

  -- 1. Notify thread author (если не сам commenter и author определён).
  if v_thread.created_by is not null and v_thread.created_by <> NEW.author_id then
    insert into public.notifications (user_id, type, title, body, link)
    values (
      v_thread.created_by,
      'kb.comment_replied',
      'Новый комментарий: ' || coalesce(v_thread.title, 'без названия'),
      'В вашем треде появился новый комментарий.',
      v_link
    );
  end if;

  -- 2. Notify distinct previous commenters в этом thread'е, исключая
  --    NEW.author_id и thread.created_by (его уже notify'нули).
  insert into public.notifications (user_id, type, title, body, link)
  select distinct
    c.author_id,
    'kb.comment_replied',
    'Новый комментарий: ' || coalesce(v_thread.title, 'без названия'),
    'В треде, где вы участвовали, появился новый комментарий.',
    v_link
  from public.kb_comments c
  where c.thread_id = NEW.thread_id
    and c.id <> NEW.id
    and c.author_id <> NEW.author_id
    and c.author_id is distinct from v_thread.created_by
    and c.deleted_at is null;

  return NEW;
end;
$$;

comment on function public.kb_notify_comment_added() is
  'Триггер-функция: notify thread author + previous commenters при '
  'добавлении нового comment''а. Sprint D Phase 4b plan §2.8-G.';

drop trigger if exists kb_notify_comment_added on public.kb_comments;
create trigger kb_notify_comment_added
  after insert on public.kb_comments
  for each row
  execute function public.kb_notify_comment_added();

comment on trigger kb_notify_comment_added on public.kb_comments is
  'Notify-trigger при создании comment''а. См. функцию.';
