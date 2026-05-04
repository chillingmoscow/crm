-- ============================================================
-- 095_kb_notify_comment_cooldown_fix.sql
--
-- Fix Codex #84 P1: kb_notify_comment_added (миграция 094) обновлял
-- last_notified_at в kb_thread_recipient_cooldown для ВСЕХ предыдущих
-- commenter'ов треда, а не только для тех, кому notif реально ушёл.
--
-- Сценарий бага:
--   1. User A пишет comment в тред с участниками B, C, D.
--   2. B сейчас в cooldown'е (получал notif < 5 мин назад).
--   3. C, D — eligible, получают notif. Eligible CTE их находит.
--   4. Но второй UPSERT в cooldown пихает rows для B, C, D одинаково
--      → у B last_notified_at обновляется БЕЗ нового notif'а.
--   5. Через 5 минут B всё ещё в cooldown'е, потому что timestamp
--      сместился. Эффективно B mute'ится навсегда пока активен тред.
--
-- Фикс: единый CTE-pipeline (eligible → INSERT INTO notifications
-- RETURNING user_id → UPSERT cooldown). Cooldown апдейтится только
-- для тех recipient'ов, кому notif реально ушёл.
-- ============================================================

create or replace function public.kb_notify_comment_added()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread record;
  v_link   text;
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

  -- 1. Notify thread author (если active member, не сам commenter, и
  --    не получал notif в этом треде в последние 5 минут). Cooldown
  --    апдейтится только если notif реально ушёл.
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
    insert into public.notifications (user_id, type, title, body, link)
    values (
      v_thread.created_by,
      'kb.comment_replied',
      'Новый комментарий: ' || coalesce(v_thread.title, 'без названия'),
      'В вашем треде появился новый комментарий.',
      v_link
    );
    insert into public.kb_thread_recipient_cooldown (thread_id, recipient_id)
    values (NEW.thread_id, v_thread.created_by)
    on conflict (thread_id, recipient_id)
      do update set last_notified_at = now();
  end if;

  -- 2. Notify previous commenters (active, не сам commenter, не автор
  --    треда — иначе дубль с веткой 1, не в cooldown'е).
  --
  -- Codex #84 P1 fix: ОДИН pipeline через CTE chain — eligible →
  -- INSERT INTO notifications RETURNING → UPSERT cooldown. Cooldown
  -- меняется ТОЛЬКО для тех, кому реально ушёл notif (а не для всех
  -- prior-commenter'ов треда).
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
    insert into public.notifications (user_id, type, title, body, link)
    select
      e.author_id,
      'kb.comment_replied',
      'Новый комментарий: ' || coalesce(v_thread.title, 'без названия'),
      'В треде, где вы участвовали, появился новый комментарий.',
      v_link
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
  'Notify-trigger: новый comment в треде → bell-notif для thread '
  'author + previous commenters (active members), с 5-мин cooldown '
  'per (thread, recipient). Cooldown timestamp обновляется ТОЛЬКО '
  'для actual-notified recipient''ов (Codex #84 P1 fix). '
  'Sprint D Phase 4b / refresh миграции 094+095.';
