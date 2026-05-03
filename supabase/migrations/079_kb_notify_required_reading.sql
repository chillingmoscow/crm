-- ============================================================
-- 079_kb_notify_required_reading.sql
-- Sprint D / Phase 4a — Notifications для required-reading.
--
-- Зачем: до сих пор toggle `required_reading=true` ничего не делал
-- для сотрудников активно — они узнавали о необходимости прочесть
-- регламент только при следующем заходе на страницу. Если регламент
-- критичный (новый порядок эвакуации), это плохо.
--
-- Решение: trigger на kb_pages UPDATE OF required_reading. При
-- переключении NULL/false → true для всех members active account'а
-- с эффективным `kb.view_pages` создаём notification со ссылкой
-- на страницу. Бэлл в shared topbar (notification-bell.tsx) уже
-- умеет показывать unread-counter и список — отдельный UI не нужен.
--
-- Что НЕ покрывает (Phase 4b):
--   • @-mentions в страницах / комментариях
--   • Comment replies
--   • Audit-events kb_thread.* — отдельная миграция 081 (тот же PR).
-- ============================================================

create or replace function public.kb_notify_required_reading()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link text;
begin
  -- Fire ТОЛЬКО на переход в required=true (off → on). Если admin
  -- снимает флаг — не нотифицируем (это не «срочный сигнал»).
  -- coalesce(OLD.required, false) — чтобы не падать на INSERT
  -- (теоретически tригер может быть навешен на INSERT тоже).
  if NEW.required_reading <> true then
    return NEW;
  end if;
  if coalesce(OLD.required_reading, false) = true then
    return NEW;
  end if;

  v_link := '/knowledge/' || NEW.slug;

  -- Notification per active member account'а с эффективным kb.view_pages.
  -- Permission-resolution идентична has_permission() (миграция 022) и
  -- members-CTE из миграции 080: system-role grant + account override.
  --
  -- INSERT'имся в существующую notifications (миграция 013, RLS:
  -- select/update own only). Для security definer функций RLS не
  -- enforce'ится, так что вставлять в чужой row позволено.
  insert into public.notifications (user_id, type, title, body, link)
  select distinct
    uvr.user_id,
    'kb.required_reading_assigned'                    as type,
    'Требуется прочесть: ' || coalesce(NEW.title, 'без названия') as title,
    'Страница помечена как обязательная к прочтению. ' ||
      'Ознакомьтесь и подтвердите прочтение в баннере.'           as body,
    v_link                                            as link
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
    -- Исключаем самого blocker'а — admin не должен нотифицировать
    -- сам себя на свой же toggle. updated_by пишется RLS-сменой
    -- updated_at-trigger'ом — но required-reading toggle делает
    -- через .update(...), updated_by не выставляется. Используем
    -- auth.uid() из текущей сессии.
    and uvr.user_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);

  return NEW;
end;
$$;

comment on function public.kb_notify_required_reading() is
  'Триггер-функция: уведомляет всех members account''а с kb.view_pages '
  'когда страница помечается как обязательная к прочтению. Бэлл-counter '
  'обновляется автоматически (RLS на notifications.select разрешает '
  'юзеру свои строки). Sprint D Phase 4a, plan §2.7-B.';

drop trigger if exists kb_notify_required_reading on public.kb_pages;
create trigger kb_notify_required_reading
  after update of required_reading on public.kb_pages
  for each row
  when (NEW.required_reading is distinct from OLD.required_reading)
  execute function public.kb_notify_required_reading();

comment on trigger kb_notify_required_reading on public.kb_pages is
  'Notify-trigger при toggle required_reading. См. функцию.';
