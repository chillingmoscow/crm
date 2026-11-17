-- Чаты Telegram для настроек задач: название и ID из «Интеграции → Telegram».
--
-- Таблица telegram_chats закрыта правом на интеграции. Настройки задач
-- сохраняет другой круг (schedule.checklist_edit + payroll.configure +
-- payroll.review — как в schedule_task_command 'settings.save'), и им нужно
-- выбрать чат по названию. Отдаём только название и ID, проверка — в базе.
begin;

create or replace function public.schedule_task_chat_choices()
returns table (chat_id text, title text)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select c.chat_id, c.title
    from public.telegram_chats c
   where c.account_id = (select public.get_active_account_id())
     and c.archived_at is null
     and (select public.has_permission('schedule.checklist_edit'))
     and (select public.has_permission('payroll.configure'))
     and (select public.has_permission('payroll.review'))
   order by c.title
$$;

revoke all on function public.schedule_task_chat_choices() from public, anon;
grant execute on function public.schedule_task_chat_choices() to authenticated;

notify pgrst, 'reload schema';
commit;
