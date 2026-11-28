-- Сообщения задач в Telegram, чья отправка не подтвердилась («review»).
--
-- 1. Сообщение за прошедший день больше не висит «на проверке» вечно:
--    очередь гасит его вместе с прочими просроченными. Повтор такого
--    сообщения и раньше ничего не давал — очередь сразу списывала его как
--    просроченное, а в задачах оно оставалось.
-- 2. Повтор не требует письменного подтверждения: решение «в чате пусто»
--    принимает управляющий одной кнопкой.
-- 3. Новое действие «Сообщение в чате есть» — закрывает проверку без
--    повторной отправки.
-- 4. Задача без приёмки включается и без чек-листа: сотрудник читает
--    инструкцию и отмечает выполнение. Чек-лист обязателен, только когда
--    выполнение принимает управляющий — ему нужно, что проверять.

begin;

-- 1. Очередь гасит и непроверенные сообщения прошедших дней.
do $migration$
declare
  body text;
  old_expire constant text := 'where v.id = m.venue_id and m.state in (''pending'', ''error'')';
  new_expire constant text := 'where v.id = m.venue_id and m.state in (''pending'', ''error'', ''review'')';
begin
  select pg_get_functiondef('public.schedule_claim_task_message()'::regprocedure) into body;
  if position(old_expire in body) = 0 then
    raise exception 'Не найдена ожидаемая версия schedule_claim_task_message';
  end if;
  execute replace(body, old_expire, new_expire);
end
$migration$;

-- Уже накопленные: за прошедшие дни повторять нечего.
update public.schedule_task_messages m
   set state = 'expired'
  from public.venues v
 where v.id = m.venue_id
   and m.state = 'review'
   and m.business_date < (now() at time zone coalesce(v.timezone, 'Europe/Moscow'))::date;

-- 2. Повтор: только за сегодня, подтверждение текстом необязательно.
create or replace function public.schedule_retry_task_message(p_id uuid, p_evidence text)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v uuid := public.get_active_venue_id();
  a uuid := public.get_active_account_id();
  msg public.schedule_task_messages;
  today date;
begin
  if auth.uid() is null or not public.has_permission('schedule.checklist_edit') then
    raise exception 'Нет доступа к повторной отправке';
  end if;
  select m.* into msg
    from public.schedule_task_messages m
   where m.id = p_id and m.venue_id = v and m.account_id = a
     and m.state in ('error', 'review') and m.message_id is null
   for update;
  if msg.id is null then
    raise exception 'Сообщение уже обработано или недоступно';
  end if;
  select (now() at time zone coalesce(vn.timezone, 'Europe/Moscow'))::date into today
    from public.venues vn where vn.id = v;
  if msg.business_date < today then
    raise exception 'Сообщение за прошедший день уже не отправить';
  end if;
  update public.schedule_task_messages
     set state = 'pending', attempts = 0, available_at = now(),
         lease_token = null, claimed_at = null, error = null
   where id = msg.id;
  insert into public.schedule_task_history(venue_id, entity_id, actor_id, action, details)
  values (v, msg.id, auth.uid(), 'message.retry',
          jsonb_build_object('comment', coalesce(nullif(left(trim(coalesce(p_evidence, '')), 1000), ''), 'Сообщения в чате нет')));
end
$$;
revoke all on function public.schedule_retry_task_message(uuid, text) from public, anon;
grant execute on function public.schedule_retry_task_message(uuid, text) to authenticated;

-- 3. «Сообщение в чате есть»: проверка закрыта, повтора не будет.
create or replace function public.schedule_confirm_task_message(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v uuid := public.get_active_venue_id();
  a uuid := public.get_active_account_id();
begin
  if auth.uid() is null or not public.has_permission('schedule.checklist_edit') then
    raise exception 'Нет доступа к сообщениям задач';
  end if;
  update public.schedule_task_messages
     set state = 'done', error = null, lease_token = null
   where id = p_id and venue_id = v and account_id = a
     and state in ('error', 'review') and message_id is null;
  if not found then
    raise exception 'Сообщение уже обработано или недоступно';
  end if;
  insert into public.schedule_task_history(venue_id, entity_id, actor_id, action, details)
  values (v, p_id, auth.uid(), 'message.confirmed', '{}'::jsonb);
end
$$;
revoke all on function public.schedule_confirm_task_message(uuid) from public, anon;
grant execute on function public.schedule_confirm_task_message(uuid) to authenticated;

-- 4. Чек-лист обязателен только у задачи с приёмкой.
alter table public.schedule_task_definitions
  drop constraint schedule_task_enabled_config;
alter table public.schedule_task_definitions
  add constraint schedule_task_enabled_config check (
    not enabled or (
      template_id is not null and recurrence is not null
      and (review_mode = 'auto' or jsonb_array_length(items) > 0)
    )
  );

do $migration$
declare
  body text;
  old_check constant text := 'or rec is null or jsonb_array_length(p_input->''items'')=0) then raise exception ''Для включения задачи укажите смену, повтор и чек-лист''';
  new_check constant text := 'or rec is null or (p_input->>''review_mode''<>''auto'' and jsonb_array_length(p_input->''items'')=0)) then raise exception ''Для включения задачи укажите смену и повтор, а для задачи с приёмкой — ещё и чек-лист''';
begin
  select pg_get_functiondef('public.schedule_task_command(text,jsonb)'::regprocedure) into body;
  if position(old_check in body) = 0 then
    raise exception 'Не найдена ожидаемая версия schedule_task_command';
  end if;
  execute replace(body, old_check, new_check);
end
$migration$;

do $check$
begin
  if position('m.state in (''pending'', ''error'', ''review'')' in pg_get_functiondef('public.schedule_claim_task_message()'::regprocedure)) = 0 then
    raise exception 'Очередь сообщений не обновилась';
  end if;
  if position('p_input->>''review_mode''<>''auto''' in pg_get_functiondef('public.schedule_task_command(text,jsonb)'::regprocedure)) = 0 then
    raise exception 'Сохранение задач не обновилось';
  end if;
  if has_function_privilege('anon', 'public.schedule_confirm_task_message(uuid)', 'execute') then
    raise exception 'schedule_confirm_task_message доступна анониму';
  end if;
end
$check$;

commit;
