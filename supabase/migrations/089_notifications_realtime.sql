-- ============================================================
-- 089_notifications_realtime.sql
-- Notifications через Supabase Realtime — `notifications` таблица
-- добавляется в `supabase_realtime` publication, чтобы клиент мог
-- subscribe'иться на INSERT-events и обновлять bell-counter без
-- перезагрузки страницы.
--
-- До этой миграции bell делал `getNotifications()` только при
-- первом открытии — новые нотификации не появлялись пока юзер
-- не нажимал F5. Триггеры (079, 083) писали в БД, но клиент не
-- знал что что-то изменилось.
--
-- Паттерн идентичен 084_kb_comments_realtime.sql:
--   • replica identity full — UPDATE/DELETE event'ы содержат полный
--     row, не только PK (нам пригодится когда добавим mark-as-read
--     events для синхронизации между tab'ами).
--   • alter publication add table — идемпотентно через DO-block.
-- ============================================================

alter table public.notifications replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;

comment on table public.notifications is
  'Multi-module notifications. Включена в supabase_realtime '
  'publication (089): клиент-bell подписывается на INSERT-events и '
  'обновляет UI без F5. Любой emit-RPC (kb_emit_page_mentions, '
  'kb_emit_comment_mentions, finance.*, staff.*, …) после INSERT''а '
  'автоматически попадает в Realtime broadcast.';
