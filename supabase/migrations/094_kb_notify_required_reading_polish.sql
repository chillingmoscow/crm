-- ============================================================
-- 094_kb_notify_required_reading_polish.sql
--
-- Полировка required-reading notifications (миграция 079) + новый
-- comment-reply rate-limit.
--
-- Что чиним:
--
-- 1. **`auth.uid()` fallback в kb_notify_required_reading**: текущий
--    `coalesce(auth.uid(), '00000000-...'::uuid)` означает, что при
--    NULL-uid (service-role / триггер из миграции / backfill)
--    sentinel'ный 00000000-... никого не исключает → toggler получает
--    notif сам себе. Заменяем на `early-return if auth.uid() is null`.
--
-- 2. **`required_reading=true` при INSERT не нотифицирует**: trigger
--    079 — `after update of required_reading`, INSERT'ы пропускаются.
--    Добавляем INSERT-вариант триггера: если страница создаётся сразу
--    с required_reading=true, тоже эмитим notifs (все active members
--    с kb.view_pages, исключая creator'а).
--
-- 3. **Comment-reply spam**: trigger kb_notify_comment_added (миграция
--    083) fires на каждый INSERT в kb_comments. Если в одном треде
--    кто-то пишет 5 комментов подряд, все участники получают 5 notifs.
--    Добавляем dedup-таблицу `kb_thread_recipient_cooldown(thread_id,
--    user_id, last_notified_at)` с 5-min cooldown. UPSERT перед
--    INSERT'ом в notifications.
-- ============================================================

-- ============================================================
-- 1. Rewrite kb_notify_required_reading: early-return on null uid +
--    INSERT-вариант через separate trigger
-- ============================================================

create or replace function public.kb_notify_required_reading()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link text;
  v_uid  uuid := auth.uid();
begin
  -- Early-return для service-role / migration-context contexts: если
  -- auth.uid() = NULL, у нас нет «кого исключить из broadcast'а», и
  -- безопасный default — не эмитить вообще, чтобы случайно не послать
  -- notif всем (включая того, кто сделал toggle).
  if v_uid is null then
    return NEW;
  end if;

  -- Fire ТОЛЬКО на переход в required=true:
  --   • UPDATE: false → true.
  --   • INSERT: NULL/false → true (default-row из миграции).
  -- INSERT-вариант: TG_OP = 'INSERT', OLD не существует (NULL во всех
  -- полях), используем coalesce.
  if NEW.required_reading is not true then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and coalesce(OLD.required_reading, false) = true then
    return NEW;
  end if;

  v_link := '/knowledge/' || NEW.slug;

  insert into public.notifications (user_id, type, title, body, link)
  select distinct
    uvr.user_id,
    'kb.required_reading_assigned'                              as type,
    'Требуется прочесть: ' || coalesce(NEW.title, 'без названия') as title,
    'Страница помечена как обязательная к прочтению. ' ||
      'Ознакомьтесь и подтвердите прочтение в баннере.'         as body,
    v_link                                                      as link
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
    -- Исключаем самого blocker'а через auth.uid() (early-return выше
    -- защищает от NULL-fallback'а, sentinel'ный 00000000-... больше
    -- не нужен).
    and uvr.user_id <> v_uid;

  return NEW;
end;
$$;

comment on function public.kb_notify_required_reading() is
  'Notify-trigger: required_reading off→on (UPDATE) или сразу true '
  '(INSERT) → bell-notif для всех active members с kb.view_pages, '
  'кроме toggler''а. early-return на NULL auth.uid() — защита от '
  'service-role-bypass'' notification для самого toggler''а. '
  'Sprint D Phase 4a / refresh миграция 094.';

-- INSERT-вариант триггера (новый): покрывает кейс «создать сразу с
-- required_reading=true» (импорт, дублирование). Тот же handler,
-- TG_OP внутри функции отличает INSERT от UPDATE.
drop trigger if exists kb_notify_required_reading_insert on public.kb_pages;
create trigger kb_notify_required_reading_insert
  after insert on public.kb_pages
  for each row
  when (NEW.required_reading is true)
  execute function public.kb_notify_required_reading();

comment on trigger kb_notify_required_reading_insert on public.kb_pages is
  'Notify-trigger при создании страницы сразу с required_reading=true '
  '(импорт, duplicate). UPDATE-вариант покрывает обычный toggle.';

-- ============================================================
-- 2. Comment-reply rate-limit
-- ============================================================
--
-- Tracking-таблица: для каждого (thread_id, recipient_user_id) храним
-- last_notified_at. На каждый INSERT в kb_comments — проверяем, если
-- последний notif для recipient'а в этом треде < 5 минут назад,
-- пропускаем эмит. UPSERT обновляет last_notified_at.

create table if not exists public.kb_thread_recipient_cooldown (
  thread_id        uuid not null references public.kb_threads(id) on delete cascade,
  recipient_id     uuid not null references auth.users(id)        on delete cascade,
  last_notified_at timestamptz not null default now(),
  primary key (thread_id, recipient_id)
);

create index if not exists kb_thread_recipient_cooldown_recipient_idx
  on public.kb_thread_recipient_cooldown(recipient_id, last_notified_at desc);

comment on table public.kb_thread_recipient_cooldown is
  'Rate-limit для kb_notify_comment_added (миграция 083): не эмитим '
  'notif для recipient''а в треде если последний был < 5 мин назад. '
  'UPSERT в trigger''е, без RLS (внутренняя таблица). '
  'Sprint D refresh, миграция 094.';

-- Внутренняя rate-limit таблица — без RLS (читать/писать может только
-- security-definer trigger). Authenticated роль доступа не получает.
alter table public.kb_thread_recipient_cooldown enable row level security;
-- Намеренно НЕТ policies — RLS закрыт «по умолчанию запрещено».

-- ============================================================
-- 3. Rewrite kb_notify_comment_added: + cooldown gate
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
  --    не получал notif в этом треде в последние 5 минут).
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
  --    треда — иначе дубль с веткой 1, не в cooldown).
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
  )
  insert into public.notifications (user_id, type, title, body, link)
  select
    e.author_id,
    'kb.comment_replied',
    'Новый комментарий: ' || coalesce(v_thread.title, 'без названия'),
    'В треде, где вы участвовали, появился новый комментарий.',
    v_link
  from eligible e;

  -- Update cooldown для всех eligible recipients из ветки 2.
  insert into public.kb_thread_recipient_cooldown (thread_id, recipient_id)
  select distinct NEW.thread_id, c.author_id
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
  on conflict (thread_id, recipient_id)
    do update set last_notified_at = now();

  return NEW;
end;
$$;

comment on function public.kb_notify_comment_added() is
  'Notify-trigger: новый comment в треде → bell-notif для thread '
  'author + previous commenters (active members), с 5-мин cooldown '
  'per (thread, recipient) против spam''а при быстрых ответах подряд. '
  'Sprint D Phase 4b / refresh миграция 094.';
