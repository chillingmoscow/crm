-- ============================================================
-- 395_stock_count_tasks.sql
-- Вид задачи «Пересчёт» (взвешивание табака) и очередь проведения.
--
-- * schedule_task_definitions.kind — 'checklist' (как раньше) или 'stock_count';
--   count_config — настройка взвешивания (склад, разделы, тара). Вид задаётся
--   при создании и дальше не меняется. Обе колонки попадают в снимок задания
--   сами: снимок строится как to_jsonb(def) (private.schedule_task_plan,
--   public.schedule_task_assign_once).
-- * Включённой задаче-пересчёту нужен count_config, а не пункты чек-листа.
-- * schedule_task_command пересоздана из 318: definition.save принимает kind
--   и count_config; run.save/run.submit отказывают заданиям-взвешиваниям — у них
--   своя команда public.stock_count_command.
-- * public.stock_count_commits — очередь проведения сданного взвешивания
--   (акт в Quick Resto и документ в Sheerly). Одна строка на задание; пишет
--   только сервер (service_role), кроме повтора упавшего проведения
--   (public.stock_count_retry).
-- * task_evidence_insert дополнительно пускает фото партий
--   {задание}/weighing/{файл} для заданий-взвешиваний.
-- ============================================================

begin;

-- 1. Вид задачи и настройка взвешивания.
alter table public.schedule_task_definitions
  add column kind text not null default 'checklist' check (kind in ('checklist', 'stock_count')),
  add column count_config jsonb;

alter table public.schedule_task_definitions drop constraint schedule_task_enabled_config;
alter table public.schedule_task_definitions add constraint schedule_task_enabled_config check (
  not enabled or (
    template_id is not null and recurrence is not null and (
      (kind = 'checklist' and jsonb_array_length(items) > 0)
      or (kind = 'stock_count' and count_config is not null)
    )
  )
);

-- 2. Проверка настройки взвешивания — та же форма, что countConfigSchema
--    (src/lib/stock-count/tobacco-weighing.ts): склад — действующий склад этого
--    заведения, позиции — того же аккаунта, чат Telegram — числовой ID.
create function private.schedule_count_config_valid(p_config jsonb, p_account uuid, p_venue uuid) returns boolean
language plpgsql stable set search_path = '' as $$
declare s jsonb; t jsonb;
begin
 if p_account is null or p_venue is null or jsonb_typeof(p_config) is distinct from 'object' or octet_length(p_config::text) > 100000
  or p_config->>'mode' is distinct from 'tobacco_weighing'
  or jsonb_typeof(p_config->'storeId') is distinct from 'string'
  or jsonb_typeof(p_config->'telegramChatId') not in ('string', 'null') or not p_config ? 'telegramChatId'
  or (jsonb_typeof(p_config->'telegramChatId') = 'string' and p_config->>'telegramChatId' !~ '^-?[0-9]{1,20}$')
  or jsonb_typeof(p_config->'sections') is distinct from 'array' or jsonb_array_length(p_config->'sections') not between 1 and 10
 then return false; end if;
 if not exists (select 1 from public.stores st where st.id = (p_config->>'storeId')::uuid and st.account_id = p_account
   and st.local_venue_id = p_venue and st.archived_at is null) then return false; end if;
 if (select count(distinct x->>'key') from jsonb_array_elements(p_config->'sections') x) <> jsonb_array_length(p_config->'sections') then return false; end if;
 for s in select value from jsonb_array_elements(p_config->'sections') loop
  if jsonb_typeof(s) is distinct from 'object'
   or coalesce(s->>'key', '') not in ('standard', 'premium', 'parfum')
   or jsonb_typeof(s->'title') is distinct from 'string' or length(s->>'title') < 1
   or jsonb_typeof(s->'hint') is distinct from 'string'
   or jsonb_typeof(s->'productId') is distinct from 'string'
   or jsonb_typeof(s->'tares') is distinct from 'array' or jsonb_array_length(s->'tares') > 20
  then return false; end if;
  if not exists (select 1 from public.ingredients i where i.id = (s->>'productId')::uuid and i.account_id = p_account) then return false; end if;
  for t in select value from jsonb_array_elements(s->'tares') loop
   if jsonb_typeof(t) is distinct from 'object'
    or jsonb_typeof(t->'key') is distinct from 'string' or length(t->>'key') < 1
    or jsonb_typeof(t->'title') is distinct from 'string' or length(t->>'title') < 1
    or jsonb_typeof(t->'grams') is distinct from 'number'
    or (t->>'grams')::numeric <> trunc((t->>'grams')::numeric)
    or (t->>'grams')::numeric not between 1 and 5000
   then return false; end if;
  end loop;
 end loop;
 return true;
-- Неверный uuid склада или позиции — это «настройка неверна», а не ошибка запроса.
exception when invalid_text_representation then return false;
end $$;
revoke all on function private.schedule_count_config_valid(jsonb, uuid, uuid) from public, anon, authenticated;

-- 3. Команда задач: 318 + вид задачи и отказ старого пути для взвешиваний.
-- Browser writes are scoped and versioned. No direct table/storage write can approve a report.
create or replace function public.schedule_task_command(p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_catalog as $$
declare u uuid:=auth.uid();v uuid:=public.get_active_venue_id();a uuid:=public.get_active_account_id();
 ident uuid:=nullif(p_input->>'id','')::uuid;def public.schedule_task_definitions;o public.schedule_task_occurrences;
 ans jsonb;item jsonb;perm text;rec jsonb;settings public.schedule_task_settings;correct_until timestamptz;activation_date date;is_paused boolean;task_today date;instruction_page uuid;instruction jsonb;
 task_kind text;task_items jsonb;task_config jsonb;
begin
 if u is null or v is null or a is null or not exists(select 1 from public.venues where id=v and account_id=a) then raise exception 'Выберите заведение';end if;
 if p_action='definition.save' then
  perm:=case when ident is null then 'schedule.checklist_create' else 'schedule.checklist_edit' end;
  if not public.has_permission(perm) then raise exception 'Нет доступа к настройке задач';end if;
  -- Serialize definition edits with generation/settlement, so a stale worker cannot restore obsolete assignments.
  perform pg_advisory_xact_lock(hashtextextended(v::text,0));
  perform pg_advisory_xact_lock(hashtextextended('schedule-tasks:'||v::text,0));
  if ident is not null then select * into def from public.schedule_task_definitions where id=ident and venue_id=v and account_id=a and deleted_at is null for update;
   if not found or def.version is distinct from (p_input->>'version')::integer then raise exception 'Задача изменилась. Обновите страницу';end if;
  end if;
  -- Вид задачи задаётся при создании; без kind в запросе остаётся прежний.
  task_kind:=coalesce(nullif(p_input->>'kind',''),case when ident is not null then def.kind else 'checklist' end);
  if task_kind not in ('checklist','stock_count') then raise exception 'Неизвестный вид задачи';end if;
  if ident is not null and task_kind is distinct from def.kind then raise exception 'Вид задачи нельзя изменить';end if;
  -- Взвешивание проводит акт в учёте: настраивает его только тот, кто может проводить результаты.
  if task_kind='stock_count' and not public.has_permission('inventory.finalize_results') then raise exception 'Нет доступа к настройке взвешиваний';end if;
  if task_kind='stock_count' and p_input->>'review_mode' is distinct from 'auto' then raise exception 'Взвешивание принимается автоматически: приёмка управляющим пока недоступна';end if;
  task_items:=case when task_kind='stock_count' then '[]'::jsonb else p_input->'items' end;
  task_config:=case when task_kind='stock_count' then nullif(p_input->'count_config','null'::jsonb) end;
  if task_config is not null and not private.schedule_count_config_valid(task_config,a,v) then raise exception 'Проверьте склад и позиции взвешивания';end if;
  if length(trim(coalesce(p_input->>'name',''))) not between 1 and 160 or length(coalesce(p_input->>'instructions',''))>50000
   or p_input->>'review_mode' not in ('auto','manager') or p_input->>'review_mode' is null or not private.schedule_task_items_valid(task_items)
   or jsonb_typeof(p_input->'enabled') is distinct from 'boolean' or jsonb_typeof(p_input->'penalty_enabled') is distinct from 'boolean'
   or (p_input->>'fine_amount')::numeric not between 0 and 100000 or (p_input->>'reward_amount')::numeric not between 0 and 100000
   or (nullif(p_input->>'template_id','') is not null and not exists(select 1 from public.schedule_templates where id=(p_input->>'template_id')::uuid and venue_id=v and not archived)) then raise exception 'Проверьте название, чек-лист, шаблон и суммы';end if;
  instruction_page:=nullif(p_input->>'instruction_page_id','')::uuid;
  if instruction_page is not null then
   if (ident is null or instruction_page is distinct from def.instruction_page_id) and not public.has_permission('kb.view_pages') then raise exception 'Нет доступа к выбору инструкции из базы знаний';end if;
   instruction:=private.schedule_task_instruction(instruction_page,a);
   if instruction is null then raise exception 'Страница инструкции удалена или принадлежит другому аккаунту';end if;
  end if;
  rec:=nullif(p_input->'recurrence','null'::jsonb);
  if (p_input->>'enabled')::boolean and (nullif(p_input->>'template_id','') is null or rec is null
    or (task_kind='checklist' and jsonb_array_length(task_items)=0) or (task_kind='stock_count' and task_config is null)) then
   if task_kind='stock_count' then raise exception 'Для включения задачи укажите смену, повтор, склад и позиции взвешивания';end if;
   raise exception 'Для включения задачи укажите смену, повтор и чек-лист';
  end if;
  if ((ident is null and ((p_input->>'penalty_enabled')::boolean or coalesce((p_input->>'reward_amount')::numeric,0)>0)) or
    (ident is not null and ((p_input->>'penalty_enabled')::boolean is distinct from def.penalty_enabled or (p_input->>'fine_amount')::numeric is distinct from def.fine_amount or (p_input->>'reward_amount')::numeric is distinct from def.reward_amount)))
   and not public.has_permission('payroll.configure') then raise exception 'Нет доступа к изменению начислений';end if;
  if (p_input->>'enabled')::boolean and (ident is null or not def.enabled) and not public.has_permission('schedule.checklist_publish') then raise exception 'Нет доступа к включению задачи';end if;
  if coalesce(p_input->>'starts_on','') !~ '^\d{4}-\d{2}-\d{2}$' or not isfinite((p_input->>'starts_on')::date) then raise exception 'Проверьте дату начала';end if;
  if rec is not null and (jsonb_typeof(rec) is distinct from 'object' or coalesce(rec->>'unit','') not in ('week','month') or rec->>'interval' is null or (rec->>'interval')::integer not between 1 and 52
   or coalesce(rec->>'anchor','') !~ '^\d{4}-\d{2}-\d{2}$' or not isfinite((rec->>'anchor')::date)) then raise exception 'Проверьте периодичность';end if;
  if jsonb_typeof(coalesce(p_input->'equipment_groups','[]')) is distinct from 'array' or jsonb_array_length(coalesce(p_input->'equipment_groups','[]'))>12 then raise exception 'Проверьте группы оборудования';end if;
  for item in select value from jsonb_array_elements(coalesce(p_input->'equipment_groups','[]')) loop
   if jsonb_typeof(item) is distinct from 'array' or jsonb_array_length(item) not between 1 and 100 or exists(select 1 from jsonb_array_elements(item) x where jsonb_typeof(x)<>'number' or (x#>>'{}')::numeric<>trunc((x#>>'{}')::numeric) or (x#>>'{}')::numeric not between 1 and 999) then raise exception 'Проверьте номера оборудования';end if;
  end loop;
  if ident is null then
   if nullif(p_input->>'source_key','') is null and coalesce(p_input->>'request_key','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Нужен ключ создания задачи';end if;
   if length(coalesce(p_input->>'source_key',''))>200 then raise exception 'Неверный источник';end if;
   insert into public.schedule_task_definitions(account_id,venue_id,name,instructions,instruction_page_id,instruction_snapshot,template_id,review_mode,items,recurrence,starts_on,enabled,penalty_enabled,fine_amount,reward_amount,equipment_groups,source_key,kind,count_config)
   values(a,v,trim(p_input->>'name'),coalesce(p_input->>'instructions',''),instruction_page,instruction,(p_input->>'template_id')::uuid,p_input->>'review_mode',task_items,rec,(p_input->>'starts_on')::date,(p_input->>'enabled')::boolean,(p_input->>'penalty_enabled')::boolean,(p_input->>'fine_amount')::numeric,(p_input->>'reward_amount')::numeric,coalesce(p_input->'equipment_groups','[]'),coalesce(nullif(p_input->>'source_key',''),'manual:'||(p_input->>'request_key')),task_kind,task_config)
   on conflict(venue_id,source_key) do nothing returning id into ident;
   if ident is null then select id into ident from public.schedule_task_definitions where venue_id=v and source_key=coalesce(nullif(p_input->>'source_key',''),'manual:'||(p_input->>'request_key'));return jsonb_build_object('id',ident,'existing',true);end if;
  else
   update public.schedule_task_definitions set name=trim(p_input->>'name'),instructions=coalesce(p_input->>'instructions',''),instruction_page_id=instruction_page,instruction_snapshot=instruction,template_id=(p_input->>'template_id')::uuid,review_mode=p_input->>'review_mode',items=task_items,count_config=task_config,recurrence=rec,starts_on=(p_input->>'starts_on')::date,enabled=(p_input->>'enabled')::boolean,penalty_enabled=(p_input->>'penalty_enabled')::boolean,fine_amount=(p_input->>'fine_amount')::numeric,reward_amount=(p_input->>'reward_amount')::numeric,equipment_groups=coalesce(p_input->'equipment_groups','[]'),version=version+1,updated_at=now() where id=ident;
  end if;
  if def.id is not null then
   select (now() at time zone coalesce(timezone,'Europe/Moscow'))::date into task_today from public.venues where id=v;
   perform private.schedule_task_cancel_future(ident,v,a,task_today,u,'definition.updated');
  end if;
 elsif p_action='definition.delete' then
  if not public.has_permission('schedule.checklist_edit') then raise exception 'Нет доступа к удалению задач';end if;
  perform pg_advisory_xact_lock(hashtextextended(v::text,0));
  perform pg_advisory_xact_lock(hashtextextended('schedule-tasks:'||v::text,0));
  select * into def from public.schedule_task_definitions where id=ident and venue_id=v and account_id=a for update;
  if not found then raise exception 'Задача не найдена';end if;
  if def.deleted_at is not null then return jsonb_build_object('id',ident,'existing',true);end if;
  if def.version is distinct from (p_input->>'version')::integer then raise exception 'Задача изменилась. Обновите страницу';end if;
  select (now() at time zone coalesce(timezone,'Europe/Moscow'))::date into task_today from public.venues where id=v;
  update public.schedule_task_definitions set enabled=false,deleted_at=now(),updated_at=now(),version=version+1 where id=ident;
  perform private.schedule_task_cancel_future(ident,v,a,task_today,u,'definition.deleted');
  insert into public.schedule_task_history(venue_id,entity_id,actor_id,action,details)
  values(v,ident,u,'definition.deleted',jsonb_build_object('before',to_jsonb(def),'after',(select to_jsonb(d) from public.schedule_task_definitions d where d.id=ident)));
 elsif p_action='settings.save' then
  if not public.has_permission('schedule.checklist_edit') or not public.has_permission('payroll.configure') or not public.has_permission('payroll.review') then raise exception 'Нет доступа к переключению задач';end if;
  select * into settings from public.schedule_task_settings where venue_id=v and account_id=a for update;
  -- Same lock order as the task worker; the bonus send checks the saved pause under the venue lock.
  perform pg_advisory_xact_lock(hashtextextended(v::text,0));
  if settings.venue_id is not null and settings.version is distinct from (p_input->>'version')::integer then raise exception 'Настройки изменились';end if;
  activation_date:=coalesce(nullif(p_input->>'enabled_from','')::date,settings.enabled_from);
  is_paused:=coalesce((p_input->>'paused')::boolean,false) or (nullif(p_input->>'enabled_from','') is null and settings.enabled_from is not null);
  if settings.enabled_from is not null and activation_date is distinct from settings.enabled_from and exists(select 1 from public.schedule_task_occurrences where venue_id=v) then raise exception 'Дата перехода уже используется отчётами. Используйте паузу без изменения даты';end if;
  if activation_date is distinct from settings.enabled_from and activation_date < (now() at time zone coalesce((select timezone from public.venues where id=v),'Europe/Moscow'))::date then raise exception 'Переключение задним числом запрещено';end if;
  if activation_date is not null and (p_input->>'legacy_stopped')::boolean is distinct from true then raise exception 'Сначала отключите прежние начисления за задачи';end if;
  if activation_date is not null and (not exists(select 1 from public.payroll_settings where venue_id=v and account_id=a) or not exists(select 1 from public.payroll_automation_settings where venue_id=v and account_id=a and version>0)) then raise exception 'Сначала настройте зарплату и подтвердите правила задач';end if;
  if nullif(p_input->>'chat_id','') is not null and p_input->>'chat_id' !~ '^-?[0-9]{1,20}$' then raise exception 'Неверный ID чата';end if;
  if jsonb_typeof(coalesce(p_input->'reminder_chat_ids','[]')) is distinct from 'array' or jsonb_array_length(coalesce(p_input->'reminder_chat_ids','[]'))>30 or exists(select 1 from jsonb_array_elements_text(coalesce(p_input->'reminder_chat_ids','[]')) x where x !~ '^-?[0-9]{1,20}$') then raise exception 'Проверьте чаты напоминаний';end if;
  insert into public.schedule_task_settings(venue_id,account_id,enabled_from,paused,legacy_stopped,chat_id,reminder_chat_ids) values(v,a,activation_date,is_paused,coalesce((p_input->>'legacy_stopped')::boolean,false),nullif(p_input->>'chat_id',''),coalesce(p_input->'reminder_chat_ids','[]'))
  on conflict(venue_id) do update set enabled_from=excluded.enabled_from,paused=excluded.paused,legacy_stopped=excluded.legacy_stopped,chat_id=excluded.chat_id,reminder_chat_ids=excluded.reminder_chat_ids,version=schedule_task_settings.version+1;
  ident:=v;
 elsif p_action in ('run.save','run.submit','run.approve','run.return') then
  select * into o from public.schedule_task_occurrences where id=ident and venue_id=v and account_id=a for update;
  -- Взвешивание сохраняется и сдаётся через stock_count_command: проверка пунктов чек-листа к нему не относится.
  if found and p_action in ('run.save','run.submit') and o.snapshot->>'kind'='stock_count' then raise exception 'Это взвешивание: откройте его из графика';end if;
  if not found or o.version is distinct from (p_input->>'version')::integer then raise exception 'Задание изменилось. Обновите страницу';end if;
  if p_action in ('run.save','run.submit') then
   if o.user_id is distinct from u or o.status not in ('assigned','in_progress','returned') or o.settled_at is not null then raise exception 'Выполнение недоступно';end if;
   if o.business_date>(now() at time zone coalesce((select timezone from public.venues where id=v),'Europe/Moscow'))::date then raise exception 'Задание доступно в день назначенной смены';end if;
   if p_action='run.submit' and o.deadline_at<=now() then raise exception 'Срок сдачи истёк. Обратитесь к управляющему';end if;
   if not exists(select 1 from public.schedule_shifts s where s.id=o.shift_id and s.published and (s.user_id=u or (s.user_id is null and exists(select 1 from public.payroll_employees e where e.id=s.payroll_employee_id and e.local_user_id=u)))) then raise exception 'Ответственный в графике изменился';end if;
   ans:=coalesce(p_input->'answers','{}');
   if jsonb_typeof(ans) is distinct from 'object' or octet_length(ans::text)>100000 or exists(select 1 from jsonb_object_keys(ans) k where not exists(select 1 from jsonb_array_elements(o.snapshot->'items') i where i->>'id'=k)) then raise exception 'Неверные ответы';end if;
   for item in select value from jsonb_array_elements(o.snapshot->'items') loop
    if p_action='run.submit' and (item->>'required')::boolean and item->>'kind'<>'info' and (not ans ? (item->>'id') or ans->(item->>'id')='null'::jsonb or length(trim(coalesce(ans->>(item->>'id'),'')))=0 or (item->>'kind'='check' and ans->>(item->>'id')<>'true')) then raise exception 'Заполните пункт: %',item->>'title';end if;
    if ans ? (item->>'id') and ans->(item->>'id')<>'null'::jsonb then
     if (item->>'kind'='check' and jsonb_typeof(ans->(item->>'id'))<>'boolean') or (item->>'kind' in ('photo','text') and jsonb_typeof(ans->(item->>'id'))<>'string') or (item->>'kind'='number' and (jsonb_typeof(ans->(item->>'id'))<>'number' or ((item->>'min') is not null and (ans->>(item->>'id'))::numeric<(item->>'min')::numeric) or ((item->>'max') is not null and (ans->>(item->>'id'))::numeric>(item->>'max')::numeric))) then raise exception 'Неверный тип или значение ответа';end if;
     if item->>'kind'='text' and length(ans->>(item->>'id'))>coalesce((item->>'max_length')::integer,2000) then raise exception 'Ответ слишком длинный';end if;
     if item->>'kind'='photo' and length(coalesce(ans->>(item->>'id'),''))>0 and not exists(select 1 from storage.objects where bucket_id='task-evidence' and name=ans->>(item->>'id') and name like o.id::text||'/'||(item->>'id')||'/%') then raise exception 'Фотография не загружена к этому пункту';end if;
    end if;
   end loop;
   update public.schedule_task_occurrences set answers=ans,status=case when p_action='run.submit' then case when snapshot->>'review_mode'='auto' then 'completed' else 'submitted' end else 'in_progress' end,submitted_at=case when p_action='run.submit' then now() else submitted_at end,completed_at=case when p_action='run.submit' and snapshot->>'review_mode'='auto' then now() else completed_at end,version=version+1,updated_at=now() where id=ident;
  else
   if not public.has_permission('schedule.review') or o.status<>'submitted' or o.user_id=u then raise exception 'Нет доступа к проверке этой задачи';end if;
   if length(coalesce(p_input->>'comment',''))>5000 or (p_action='run.return' and length(trim(coalesce(p_input->>'comment','')))=0) then raise exception 'Укажите замечания';end if;
   if p_action='run.return' then
    correct_until:=nullif(p_input->>'correct_until','')::timestamptz;
    if correct_until is null or not isfinite(correct_until) or correct_until<=now() or correct_until>now()+interval '30 days' then raise exception 'Укажите будущий срок исправления, не позже 30 дней';end if;
   end if;
   update public.schedule_task_occurrences set deadline_at=case when p_action='run.return' then correct_until else deadline_at end,status=case when p_action='run.approve' then 'completed' else 'returned' end,review_comment=coalesce(p_input->>'comment',''),completed_at=case when p_action='run.approve' then now() else null end,version=version+1,updated_at=now() where id=ident;
  end if;
 else raise exception 'Неизвестное действие';end if;
 if p_action not in ('definition.save','definition.delete') then
  insert into public.schedule_task_history(venue_id,entity_id,actor_id,action,details) values(v,ident,u,p_action,jsonb_build_object('comment',p_input->>'comment','before',case when p_action like 'run.%' then to_jsonb(o) else to_jsonb(settings) end,'after',case when p_action like 'run.%' then (select to_jsonb(r) from public.schedule_task_occurrences r where r.id=ident) else (select to_jsonb(s) from public.schedule_task_settings s where s.venue_id=v) end));
 end if;
 return jsonb_build_object('id',ident);
end $$;
revoke all on function public.schedule_task_command(text,jsonb) from public,anon;
grant execute on function public.schedule_task_command(text,jsonb) to authenticated;

-- 4. Очередь проведения взвешиваний.
create table public.stock_count_commits (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  venue_id uuid not null references public.venues(id),
  occurrence_id uuid not null unique references public.schedule_task_occurrences(id),
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  attempts integer not null default 0,
  last_error text,
  qr_document_id bigint,
  document_id uuid,
  -- sending — отчёт ушёл в Telegram, а ответ ещё не записан: после падения
  -- воркера такой отчёт не повторяется (лучше потерять, чем прислать дважды).
  telegram_status text not null default 'pending' check (telegram_status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  telegram_attempts integer not null default 0,
  -- Когда повторить отчёт; null — повторов не будет (отправлен или попытки кончились).
  telegram_next_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  -- Аренда строки воркером: меняется при каждом захвате, запись идёт только с ним.
  lease_token uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, id),
  -- Документ Sheerly — того же аккаунта.
  foreign key (account_id, document_id) references public.documents(account_id, id)
);
create index stock_count_commits_queue on public.stock_count_commits(next_attempt_at) where status in ('pending', 'processing');
create index stock_count_commits_telegram_queue on public.stock_count_commits(telegram_next_attempt_at) where status = 'done' and telegram_status in ('pending', 'sending', 'failed');
create index stock_count_commits_document on public.stock_count_commits(account_id, document_id) where document_id is not null;
create index stock_count_commits_venue on public.stock_count_commits(venue_id);

alter table public.stock_count_commits enable row level security;
revoke all on public.stock_count_commits from public, anon, authenticated;
grant select on public.stock_count_commits to authenticated;
grant all on public.stock_count_commits to service_role;

create policy stock_count_commits_read on public.stock_count_commits for select to authenticated using (
  venue_id = (select public.get_active_venue_id()) and account_id = (select public.get_active_account_id()) and (
    (select public.has_permission('schedule.view_all')) or (select public.has_permission('schedule.review'))
    or (select public.has_permission('inventory.view_results'))
    or exists (select 1 from public.schedule_task_occurrences o where o.id = occurrence_id and o.user_id = (select auth.uid()))
  )
);

-- 5. Сохранение и сдача взвешивания исполнителем.
--    Партии и тару проверяет сервер приложения; здесь — права, срок, смена и фото.
create function public.stock_count_command(p_action text, p_input jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := auth.uid(); v uuid := public.get_active_venue_id(); a uuid := public.get_active_account_id();
 ident uuid := nullif(p_input->>'id', '')::uuid; o public.schedule_task_occurrences; ans jsonb; photo jsonb; started text;
begin
 if u is null or v is null or a is null or not exists (select 1 from public.venues where id = v and account_id = a) then raise exception 'Выберите заведение'; end if;
 if p_action not in ('run.save', 'run.submit') then raise exception 'Неизвестное действие'; end if;
 select * into o from public.schedule_task_occurrences where id = ident and venue_id = v and account_id = a for update;
 if not found or o.version is distinct from (p_input->>'version')::integer then raise exception 'Задание изменилось. Обновите страницу'; end if;
 if o.snapshot->>'kind' is distinct from 'stock_count' then raise exception 'Это задание не взвешивание'; end if;
 if o.user_id is distinct from u or o.status not in ('assigned', 'in_progress', 'returned') or o.settled_at is not null then raise exception 'Выполнение недоступно'; end if;
 if o.business_date > (now() at time zone coalesce((select timezone from public.venues where id = v), 'Europe/Moscow'))::date then raise exception 'Задание доступно в день назначенной смены'; end if;
 if p_action = 'run.submit' and o.deadline_at <= now() then raise exception 'Срок сдачи истёк. Обратитесь к управляющему'; end if;
 if not exists (select 1 from public.schedule_shifts s where s.id = o.shift_id and s.published and (s.user_id = u or (s.user_id is null and exists (select 1 from public.payroll_employees e where e.id = s.payroll_employee_id and e.local_user_id = u)))) then raise exception 'Ответственный в графике изменился'; end if;
 ans := coalesce(p_input->'answers', '{}');
 if jsonb_typeof(ans) is distinct from 'object' or octet_length(ans::text) > 100000
  or exists (select 1 from jsonb_object_keys(ans) k where k <> 'weighing')
  or (ans ? 'weighing' and (jsonb_typeof(ans->'weighing') is distinct from 'object'
      or jsonb_typeof(ans->'weighing'->'sections') is distinct from 'object')) then raise exception 'Неверные ответы'; end if;
 if p_action = 'run.submit' and not ans ? 'weighing' then raise exception 'Заполните взвешивание'; end if;
 -- Фото партии — только файл, загруженный к этому заданию: {задание}/weighing/{файл}.
 -- Любое поле photo на любой глубине, чтобы другая форма черновика не обошла проверку.
 for photo in select p from jsonb_path_query(ans, 'lax $.weighing.**.photo') p loop
  if jsonb_typeof(photo) = 'null' then continue; end if;
  if jsonb_typeof(photo) <> 'string' then raise exception 'Неверные ответы'; end if;
  if length(photo#>>'{}') > 0 and not exists (select 1 from storage.objects where bucket_id = 'task-evidence' and name = photo#>>'{}' and name like o.id::text || '/weighing/%') then
   raise exception 'Фотография взвешивания не загружена';
  end if;
 end loop;
 -- Время начала (от него зависит дата акта) задаёт только сервер: сохранённое не меняется,
 -- первое ставится при первой партии, присланное клиентом игнорируется.
 if ans ? 'weighing' then
  started := nullif(o.answers#>>'{weighing,startedAt}', '');
  if started is null and exists (
   select 1 from jsonb_each(ans->'weighing'->'sections') e
   where jsonb_typeof(e.value) = 'object' and e.value->'empty' is distinct from 'true'::jsonb
     and jsonb_typeof(e.value->'batches') = 'array' and jsonb_array_length(e.value->'batches') > 0
  ) then
   started := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  end if;
  ans := jsonb_set(ans, '{weighing,startedAt}', coalesce(to_jsonb(started), 'null'::jsonb));
 end if;
 -- Приёмки нет: сданное взвешивание сразу выполнено, проведение идёт очередью.
 update public.schedule_task_occurrences set answers = ans,
   status = case when p_action = 'run.submit' then 'completed' else 'in_progress' end,
   submitted_at = case when p_action = 'run.submit' then now() else submitted_at end,
   completed_at = case when p_action = 'run.submit' then now() else completed_at end,
   version = version + 1, updated_at = now()
  where id = ident;
 if p_action = 'run.submit' then
  insert into public.stock_count_commits(account_id, venue_id, occurrence_id, status)
  values (a, v, ident, 'pending') on conflict (occurrence_id) do nothing;
 end if;
 insert into public.schedule_task_history(venue_id, entity_id, actor_id, action, details)
 values (v, ident, u, p_action, jsonb_build_object('before', to_jsonb(o), 'after', (select to_jsonb(r) from public.schedule_task_occurrences r where r.id = ident)));
 return jsonb_build_object('id', ident, 'version', o.version + 1);
end $$;
revoke all on function public.stock_count_command(text, jsonb) from public, anon;
grant execute on function public.stock_count_command(text, jsonb) to authenticated;

-- 6. Повтор упавшего проведения.
create function public.stock_count_retry(p_commit uuid) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare u uuid := auth.uid(); v uuid := public.get_active_venue_id(); a uuid := public.get_active_account_id();
 c public.stock_count_commits;
begin
 if u is null or v is null or a is null or not exists (select 1 from public.venues where id = v and account_id = a) then raise exception 'Выберите заведение'; end if;
 if not (public.has_permission('schedule.review') or public.has_permission('inventory.finalize_results')) then raise exception 'Нет доступа к повтору проведения'; end if;
 update public.stock_count_commits set status = 'pending', attempts = 0, last_error = null, next_attempt_at = now(), updated_at = now()
  where id = p_commit and venue_id = v and account_id = a and status = 'failed'
  returning * into c;
 if not found then raise exception 'Проведение не найдено или уже идёт'; end if;
 insert into public.schedule_task_history(venue_id, entity_id, actor_id, action, details)
 values (v, c.occurrence_id, u, 'stock_count.retry', jsonb_build_object('commit_id', c.id));
end $$;
revoke all on function public.stock_count_retry(uuid) from public, anon;
grant execute on function public.stock_count_retry(uuid) to authenticated;

-- 7. Фото: для взвешивания — {задание}/weighing/{файл}, остальные условия как в 318.
drop policy task_evidence_insert on storage.objects;
create policy task_evidence_insert on storage.objects for insert to authenticated with check(bucket_id='task-evidence' and exists(select 1 from public.schedule_task_occurrences o where o.id::text=(storage.foldername(name))[1] and o.user_id=(select auth.uid()) and o.status in ('assigned','in_progress','returned') and o.settled_at is null and (
  exists(select 1 from jsonb_array_elements(o.snapshot->'items') i where i->>'id'=(storage.foldername(name))[2] and i->>'kind'='photo')
  or (o.snapshot->>'kind'='stock_count' and (storage.foldername(name))[2]='weighing' and array_length(storage.foldername(name),1)=2))));

-- 8. Права на функции.
do $$
declare f text;
begin
 foreach f in array array['public.schedule_task_command(text,jsonb)', 'public.stock_count_command(text,jsonb)', 'public.stock_count_retry(uuid)'] loop
  if has_function_privilege('anon', f, 'execute') then raise exception 'anon не должен вызывать %', f; end if;
  if not has_function_privilege('authenticated', f, 'execute') then raise exception 'authenticated должен вызывать %', f; end if;
 end loop;
 foreach f in array array['anon', 'authenticated'] loop
  if has_function_privilege(f, 'private.schedule_count_config_valid(jsonb,uuid,uuid)', 'execute') then raise exception '% не должен вызывать private.schedule_count_config_valid', f; end if;
  if has_table_privilege(f, 'public.stock_count_commits', 'insert') or has_table_privilege(f, 'public.stock_count_commits', 'update')
   or has_table_privilege(f, 'public.stock_count_commits', 'delete') then raise exception '% не должен писать в stock_count_commits', f; end if;
 end loop;
 if has_table_privilege('anon', 'public.stock_count_commits', 'select') then raise exception 'anon не должен читать stock_count_commits'; end if;
 if not has_table_privilege('service_role', 'public.stock_count_commits', 'insert') then raise exception 'service_role должен писать в stock_count_commits'; end if;
end $$;

commit;
