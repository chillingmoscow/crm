-- ============================================================
-- 090_kb_emit_comment_mentions.sql
-- Comment @-mention notifications. Аналог 083 для page-mention'ов:
-- tracking-table + idempotent emit-RPC. Вызывается из
-- SupabaseThreadStore.createThread / addComment после успешного
-- INSERT'а с user_id'ами, извлечёнными из BlockNote body на
-- клиенте через extractMentionedUserIds().
--
-- Note: 083-документ говорил «не покрыто, SQL-extraction слишком
-- сложен». Решение — extract на клиенте и передать через RPC, то
-- же что мы делаем для page-mention'ов в `saveKbPage`.
-- ============================================================

-- ============================================================
-- 1. kb_comment_user_mentions — idempotency PK
-- ============================================================

create table if not exists public.kb_comment_user_mentions (
  comment_id        uuid not null references public.kb_comments(id) on delete cascade,
  user_id           uuid not null references auth.users(id)         on delete cascade,
  account_id        uuid not null references public.accounts(id)    on delete cascade,
  first_notified_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create index if not exists kb_comment_user_mentions_user_idx
  on public.kb_comment_user_mentions(account_id, user_id);

comment on table public.kb_comment_user_mentions is
  'Idempotency-маркер для @-mention notifications в комментариях. '
  'PK (comment_id, user_id) гарантирует one-shot delivery даже если '
  'клиент случайно вызвал emit повторно. Аналог kb_page_user_mentions.';

alter table public.kb_comment_user_mentions enable row level security;
create policy "kb_comment_user_mentions_select_own"
  on public.kb_comment_user_mentions for select
  using (
    user_id = auth.uid()
    and account_id = public.get_active_account_id()
  );
grant select on public.kb_comment_user_mentions to authenticated;

-- ============================================================
-- 2. RPC kb_emit_comment_mentions
-- ============================================================
--
-- Гейтинг — `kb.comment_pages` permission (миграция 076). RLS на
-- kb_comments.INSERT уже его проверяет, но RPC callable напрямую
-- через PostgREST — повторяем gate (паттерн Codex #61 P1 из
-- kb_emit_page_mentions).

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
  v_inserted_user_id uuid;
  v_can_comment boolean := public.has_permission('kb.comment_pages');
begin
  if v_uid is null then
    return;
  end if;
  if not v_can_comment then
    return;
  end if;
  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return;
  end if;

  -- Достаём comment + thread + page (slug/title для link'а + проверка
  -- что comment живёт в active account и не soft-deleted).
  select
    c.id              as comment_id,
    c.author_id       as author_id,
    p.slug            as page_slug,
    p.title           as page_title,
    p.account_id      as account_id
  into v_comment
  from public.kb_comments c
  join public.kb_threads  t on t.id = c.thread_id
  join public.kb_pages    p on p.id = t.page_id
  where c.id = p_comment_id
    and c.deleted_at is null
    and t.deleted_at is null
    and p.deleted_at is null
    and p.account_id = v_account_id;
  if not found then
    return;
  end if;

  -- Author-check: только сам автор коммента может эмитить mention'ы
  -- по этому commentId. Защита от cross-user fabrication через
  -- callable PostgREST.
  if v_comment.author_id <> v_uid then
    return;
  end if;

  v_link := '/knowledge/' || v_comment.page_slug;

  -- Insert tracking-rows для distinct user_id'ов (исключая автора
  -- коммента и тех, кто уже получил notification по этому comment'у
  -- через PK + ON CONFLICT DO NOTHING). RETURNING — новые user_id'ы
  -- → каждому отдельная notification.
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
    insert into public.notifications (user_id, type, title, body, link)
    values (
      v_inserted_user_id,
      'kb.mention_in_comment',
      'Вас упомянули в комментарии: ' || coalesce(v_comment.page_title, 'без названия'),
      'Вас @-упомянули в обсуждении на странице базы знаний.',
      v_link
    );
  end loop;
end;
$$;

comment on function public.kb_emit_comment_mentions(uuid, uuid[]) is
  'Idempotent emit для @-mention notifications в KB-комментариях. '
  'Вызывается из SupabaseThreadStore.createThread/addComment после '
  'успешного INSERT''а с user_id''ами из BlockNote body. PK '
  'kb_comment_user_mentions гарантирует one-shot delivery.';

revoke all on function public.kb_emit_comment_mentions(uuid, uuid[]) from public;
grant execute on function public.kb_emit_comment_mentions(uuid, uuid[]) to authenticated;
