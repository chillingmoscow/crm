-- Официальная выплата (задача 2): проведение официальной части зарплаты,
-- автоматический запуск за прошлый месяц, «На разбор», смена расчётного счёта.
--
-- * private.payroll_post_payment_scoped (последнее тело — 246) понимает ключ
--   official_month: одна аллокация, только зарплата, только расчётный счёт,
--   закрыто (оклад с налогом) ≥ выдано (на руки), не больше одной действующей
--   официальной выплаты на сотрудника и месяц. Для всех прочих выплат
--   проверка «Округление доступно только для чаевых» не меняется.
-- * public.payroll_post_payment (последнее тело — 244) не принимает ключ
--   official_month: официальную часть проводят только функции ниже.
-- * private.payroll_queue_adesk_sync (последнее тело — 347): официальная
--   выплата в очередь Adesk не ставится.
-- * public.payroll_command (последнее тело — 245, патч 253): ветка 'settings'
--   принимает official_from / official_pay_day / official_bank_account_id —
--   только с правами проведения выплат, как прочие финансовые поля.
-- * public.payroll_official_run — крон (только service_role). Для каждого
--   заведения с official_from в день проведения или позже (по поясу аккаунта)
--   обрабатывает прошлый месяц M: каждый период без строки месяца либо
--   проводится (датой дня проведения в M+1, 12:00), либо уходит на разбор.
--   Строка payroll_official_months остаётся и после удаления выплаты —
--   поэтому крон не проводит месяц повторно.
-- * public.payroll_record_official_payment — ручное проведение (карточка
--   «На разбор» или повтор после удаления), payroll_official_skip — пропуск
--   карточки, payroll_official_change_account — перенос выплат на другой
--   расчётный счёт.

begin;

-- ────────────────────────────────────────────────────────────
-- 1. Изменённые функции выплат
-- ────────────────────────────────────────────────────────────
-- Последнее тело — 246_payroll_individual_payments.sql.
create or replace function private.payroll_post_payment_scoped(p_input jsonb,a uuid,v uuid,u uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare existing uuid;existing_snapshot jsonb;payment uuid;tx uuid;bank public.bank_accounts;c public.payroll_cashbox;linked public.transactions;
 row jsonb;emp public.payroll_employees;amount numeric:=(p_input->>'amount')::numeric;total numeric:=0;settled numeric:=0;
 kind text:=p_input->>'kind';v_month date;category uuid:=(p_input->>'category_id')::uuid;cash uuid:=(p_input->>'cashbox_id')::uuid;evidence public.payroll_legacy_payments;
 v_official date:=nullif(p_input->>'official_month','')::date;
begin

 perform pg_advisory_xact_lock(hashtextextended(v::text,0));
 select pp.id,pp.input_snapshot into existing,existing_snapshot from public.payroll_payments pp where pp.account_id=a and pp.venue_id=v and pp.request_key=(p_input->>'request_key')::uuid;
 if existing is not null then if existing_snapshot is distinct from p_input then raise exception 'Этот ключ уже использован для другой выплаты';end if;return existing;end if;
 if kind not in ('salary','advance','tips') or amount is null or amount<=0 or amount>1000000000 or round(amount,2)<>amount then raise exception 'Некорректная выплата';end if;
 select * into bank from public.bank_accounts where id=(p_input->>'bank_account_id')::uuid and account_id=a and is_active;
 if bank.id is null or bank.currency<>'RUB' or (bank.venue_id is not null and bank.venue_id<>v) then raise exception 'Счёт недоступен';end if;
 -- Официальная выплата: одна зарплата одному сотруднику, только с расчётного счёта.
 if v_official is not null then
  if kind<>'salary' or cash is not null or p_input->>'legacy_evidence_id' is not null then raise exception 'Официальная выплата — только зарплата';end if;
  if bank.type<>'checking' then raise exception 'Официальную выплату можно провести только с расчётного счёта';end if;
  if date_trunc('month',v_official)::date<>v_official then raise exception 'Некорректный месяц официальной выплаты';end if;
  if jsonb_typeof(p_input->'allocations') is distinct from 'array' or jsonb_array_length(p_input->'allocations')<>1 then raise exception 'Официальная выплата — одному сотруднику за один месяц';end if;
 end if;
 if not exists(select 1 from public.finance_categories where id=category and account_id=a and type='expense' and archived_at is null) then raise exception 'Выберите статью расхода';end if;
 if cash is not null then
  select * into c from public.payroll_cashbox where id=cash and venue_id=v and account_id=a for update;
  if c.id is null or c.state not in ('ready','review') or kind<>'tips' or c.amount<>amount then raise exception 'Инкассация недоступна';end if;
  if exists(select 1 from public.payroll_payments where cashbox_id=cash) then raise exception 'Инкассация уже проведена';end if;
 end if;
 if p_input->>'legacy_evidence_id' is not null then
  if not public.has_permission('payroll.approve') then raise exception 'Нет доступа к подтверждению истории';end if;
  select * into evidence from public.payroll_legacy_payments where id=(p_input->>'legacy_evidence_id')::uuid and account_id=a and venue_id=v and state='review' for update;
  if evidence.id is null or evidence.amount<>amount or evidence.kind<>kind or (p_input->>'date')::timestamptz<>evidence.occurred_at or jsonb_array_length(p_input->'allocations')<>1 then raise exception 'Историческая выплата не соответствует источнику';end if;
 end if;
 if jsonb_typeof(p_input->'allocations')<>'array' or jsonb_array_length(p_input->'allocations')=0 then raise exception 'Укажите получателей';end if;
 for row in select * from jsonb_array_elements(p_input->'allocations') loop
  select * into emp from public.payroll_employees where id=(row->>'employee_id')::uuid and account_id=a and venue_id=v;
  v_month:=(row->>'month')::date;
  if emp.id is null or date_trunc('month',v_month)::date<>v_month or v_month<(select starts_on from public.payroll_settings where venue_id=v) then raise exception 'Получатель или период недоступен';end if;
  if row->>'amount' is null or row->>'settled_amount' is null or v_month is null or (row->>'amount')::numeric<0 or (row->>'settled_amount')::numeric<0 or round((row->>'amount')::numeric,2)<>(row->>'amount')::numeric or round((row->>'settled_amount')::numeric,2)<>(row->>'settled_amount')::numeric then raise exception 'Некорректное распределение';end if;
  -- Официальная: выдано — на руки, закрыто — оклад с налогом (не меньше выданного).
  if v_official is not null then
   if v_month<>v_official then raise exception 'Месяц официальной выплаты не совпадает с периодом';end if;
   if (row->>'settled_amount')::numeric<(row->>'amount')::numeric then raise exception 'Оклад с налогом меньше суммы на руки';end if;
   -- Одна действующая официальная выплата на сотрудника и месяц (удалённая не мешает).
   -- Проверка под блокировкой заведения, общая для всех путей проведения.
   if exists(select 1 from public.payroll_payments op join public.payroll_allocations oa on oa.payment_id=op.id where op.account_id=a and op.venue_id=v and op.state='posted' and op.official_month=v_official and oa.employee_id=emp.id) then raise exception 'За этот месяц уже проведена официальная выплата';end if;
  elsif kind<>'tips' and (row->>'amount')::numeric<>(row->>'settled_amount')::numeric then raise exception 'Округление доступно только для чаевых';end if;
  if kind='tips' then
   if cash is null or row->>'accrual_id' is null or v_month<>date_trunc('month',c.business_date)::date then raise exception 'Чаевые должны быть связаны с инкассацией и начислением';end if;
   if not exists(select 1 from public.payroll_accruals where id=(row->>'accrual_id')::uuid and employee_id=emp.id and venue_id=v and business_date=c.business_date and status in ('ready','approved') and cardinality(issues)=0) then raise exception 'Начисление ещё не проверено';end if;
   if (row->>'settled_amount')::numeric>(select tips from public.payroll_accruals where id=(row->>'accrual_id')::uuid)-coalesce((select sum(x.settled_amount) from public.payroll_allocations x join public.payroll_payments y on y.id=x.payment_id where x.accrual_id=(row->>'accrual_id')::uuid and y.state='posted'),0) then raise exception 'Чаевые уже выданы';end if;
  end if;
  if row ? 'accrual_id' and not exists(select 1 from public.payroll_accruals where id=(row->>'accrual_id')::uuid and employee_id=emp.id and venue_id=v and (cash is null or business_date=c.business_date)) then raise exception 'Начисление недоступно';end if;
  if evidence.id is not null and (emp.id<>evidence.employee_id or v_month<>evidence.month) then raise exception 'Получатель исторической выплаты изменён';end if;
  if exists(select 1 from jsonb_array_elements(p_input->'allocations') recipient where recipient->>'employee_id'=row->>'employee_id' and recipient->>'month'=row->>'month' group by recipient->>'employee_id' having count(*)>1) then raise exception 'Сотрудник указан дважды';end if;
  total:=total+(row->>'amount')::numeric;settled:=settled+(row->>'settled_amount')::numeric;
 end loop;
 if total<>amount then raise exception 'Распределение не совпадает с суммой выплаты';end if;
 if cash is not null and abs(settled-amount)>(select tip_tolerance from public.payroll_settings where venue_id=v) and coalesce(length(trim(p_input->>'reason')),0)<3 then raise exception 'Подтвердите расхождение с причиной';end if;
 if cash is not null then
  if (select count(*) from public.transactions t where t.account_id=a and t.source_external_id='quickresto:encashment:'||v::text||':'||c.external_id)>1 then raise exception 'Найдено несколько расходов инкассации: требуется сверка';end if;
  select * into linked from public.transactions t where t.account_id=a and t.source_external_id='quickresto:encashment:'||v::text||':'||c.external_id for update;
  if linked.id is not null then
   if linked.venue_id is distinct from v or linked.bank_account_id<>bank.id or linked.category_id is distinct from category or linked.type<>'expense' or linked.currency<>'RUB' or linked.legal_entity_id<>bank.legal_entity_id or linked.amount<>amount or linked.date<>(p_input->>'date')::timestamptz or linked.deleted_at is not null then raise exception 'Существующий расход не совпадает с инкассацией';end if;
   tx:=linked.id;
  end if;
 end if;
 if tx is null then
 insert into public.transactions(account_id,legal_entity_id,venue_id,bank_account_id,category_id,type,amount,date,description,source,source_external_id,created_by)
  values(a,bank.legal_entity_id,v,bank.id,category,'expense',amount,(p_input->>'date')::timestamptz,coalesce(p_input->>'note','Выплата сотрудникам'),'manual',case when cash is not null then 'quickresto:encashment:'||v::text||':'||c.external_id else 'payroll:'||(p_input->>'request_key') end,u) returning id into tx;
 end if;
 insert into public.payroll_payments(account_id,venue_id,request_key,transaction_id,cashbox_id,kind,amount,note,created_by,legacy_evidence_id,input_snapshot,occurred_at,official_month)
  values(a,v,(p_input->>'request_key')::uuid,tx,cash,kind,amount,coalesce(p_input->>'note',''),u,evidence.id,p_input,(p_input->>'date')::timestamptz,v_official) returning id into payment;
 if evidence.id is not null then update public.payroll_legacy_payments set state='posted',payment_id=payment where id=evidence.id;end if;
 for row in select * from jsonb_array_elements(p_input->'allocations') loop
  insert into public.payroll_allocations(account_id,venue_id,payment_id,employee_id,accrual_id,month,amount,settled_amount)
   values(a,v,payment,(row->>'employee_id')::uuid,(row->>'accrual_id')::uuid,(row->>'month')::date,(row->>'amount')::numeric,(row->>'settled_amount')::numeric);
 end loop;
 perform private.payroll_link_accruals(payment);
 if cash is not null then update public.payroll_cashbox set state='posted',rounding=settled-(p_input->>'amount')::numeric where id=cash;end if;
 insert into public.payroll_events(account_id,venue_id,entity_id,actor_id,action,details) values(a,v,payment,u,'payment',jsonb_build_object('amount',amount,'kind',kind,'rounding',settled-amount,'reason',p_input->>'reason'));
 return payment;
end $function$;

-- Последнее тело — 244_payroll.sql. Ключ official_month ослабляет проверку
-- «закрыто = выдано», поэтому обычная выплата его не принимает: официальную
-- часть проводят только payroll_record_official_payment, крон и смена счёта.
create or replace function public.payroll_post_payment(p_input jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare a uuid;v uuid;u uuid;
begin
 select s.a,s.v,s.u into a,v,u from private.payroll_scope('payroll.pay') s;
 if not public.has_permission('finance.create_transaction') then raise exception 'Нет доступа к финансовым операциям';end if;
 if p_input->>'kind'='tips' then raise exception 'Используйте общую дневную сверку чаевых';end if;
 if p_input ? 'official_month' then raise exception 'Официальная часть проводится отдельно: включите «Официальная часть» в форме выплаты';end if;
 return private.payroll_post_payment_scoped(p_input,a,v,u);
end $$;

-- Последнее тело — 347_payroll_adesk_sync.sql.
create or replace function private.payroll_queue_adesk_sync()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
begin
 if tg_op = 'INSERT' then
  if new.state = 'posted' and new.kind in ('salary','advance')
     and new.cashbox_id is null and new.legacy_evidence_id is null
     and new.official_month is null then  -- официальная выплата в Adesk не отправляется
   insert into public.payroll_adesk_sync(payment_id, account_id, venue_id)
   values (new.id, new.account_id, new.venue_id)
   on conflict (account_id, payment_id) do nothing;
  end if;
 elsif new.state is distinct from old.state then
  update public.payroll_adesk_sync
     set state = 'pending', attempts = 0, available_at = now(), last_error = null, updated_at = now()
   where account_id = new.account_id and payment_id = new.id and state <> 'sending';
  -- A claimed row is picked up again once the worker reports back (see finish).
 end if;
 return null;
end $function$;

-- Последнее тело — 245_payroll_manual_transfers.sql с патчем 253_payroll_role_compensation.sql.
create or replace function public.payroll_command(p_action text, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare a uuid;v uuid;u uuid;perm text;x uuid;emp public.payroll_employees;m public.payroll_models;p public.payroll_periods;
 r public.payroll_attendance;plan public.schedule_shifts;reason text:=trim(coalesce(p_input->>'reason',''));v_month date;amount numeric;
begin
 perm:=case p_action when 'period' then 'payroll.approve' when 'attendance' then 'payroll.review' when 'missing_shift' then 'payroll.review' when 'adjustment' then 'payroll.review' when 'approve_adjustment' then 'payroll.approve' else 'payroll.configure' end;
 select s.a,s.v,s.u into a,v,u from private.payroll_scope(perm) s;
 if a is null or v is null then raise exception 'Выберите заведение';end if;
 perform pg_advisory_xact_lock(hashtextextended(v::text,0));
 if p_action in ('employee','rule','qualification','attendance','missing_shift','adjustment','approve_adjustment','settings','new_employee') and exists(select 1 from public.payroll_source_days where venue_id=v and state='loading') then raise exception 'Дождитесь обновления расчёта перед изменением условий';end if;
 if p_action='initialize' then
  if exists(select 1 from public.payroll_settings where venue_id=v) then raise exception 'Настройка уже выполнена';end if;
  insert into public.payroll_settings(account_id,venue_id,starts_on,quickresto_venue_id,enabled) values(a,v,(p_input->>'starts_on')::date,(p_input->>'quickresto_venue_id')::bigint,true) returning venue_id into x;
 elsif p_action='model' then
  if coalesce(length(trim(p_input->>'name')),0)<2 or coalesce(length(trim(p_input->>'role_name')),0)<2 then raise exception 'Введите название модели и должность';end if;
  insert into public.payroll_models(account_id,venue_id,name,role_name,basis,monthly_amount,tips,experience,knowledge_amount,food_amount,cleaner_bonus)
  values(a,v,trim(p_input->>'name'),trim(p_input->>'role_name'),p_input->>'basis',coalesce((p_input->>'monthly_amount')::numeric,0),coalesce((p_input->>'tips')::boolean,false),coalesce((p_input->>'experience')::boolean,false),coalesce((p_input->>'knowledge_amount')::numeric,0),coalesce((p_input->>'food_amount')::numeric,0),coalesce((p_input->>'cleaner_bonus')::numeric,0)) returning id into x;
 elsif p_action='new_employee' then
  if not exists(select 1 from public.user_venue_roles where user_id=(p_input->>'local_user_id')::uuid and venue_id=v and status='active' and fired_at is null) then raise exception 'Сотрудник не работает в заведении';end if;
  select * into m from public.payroll_models where id=(p_input->>'model_id')::uuid and venue_id=v and account_id=a and not archived;
  if m.id is null then raise exception 'Модель оплаты недоступна';end if;
  insert into public.payroll_employees(account_id,venue_id,local_user_id,name,model_id,role_name,hired_on,quickresto_id)
  select a,v,profile.id,trim(concat_ws(' ',profile.first_name,profile.last_name)),m.id,m.role_name,(p_input->>'hired_on')::date,
   (select l.external_id::bigint from public.external_entity_links l where l.account_id=a and l.provider='quickresto' and l.entity_type='staff' and l.local_id=profile.id and l.external_id ~ '^[0-9]+$' limit 1)
  from public.profiles profile where profile.id=(p_input->>'local_user_id')::uuid returning id into x;
 elsif p_action='employee' then
  select * into emp from public.payroll_employees where id=(p_input->>'id')::uuid and account_id=a and venue_id=v for update;
  if emp.id is null then raise exception 'Сотрудник не найден';end if;
  if p_input ? 'model_id' and not exists(select 1 from public.payroll_models where id=(p_input->>'model_id')::uuid and account_id=a and venue_id=v and not archived) then raise exception 'Модель оплаты недоступна';end if;
  if p_input ? 'local_user_id' and nullif(p_input->>'local_user_id','') is not null and not exists(select 1 from public.user_venue_roles where user_id=(p_input->>'local_user_id')::uuid and venue_id=v and status='active' and fired_at is null) then raise exception 'Сотрудник не работает в заведении';end if;
  if exists(select 1 from public.payroll_periods where venue_id=v and status<>'draft') and p_input ? 'opening_balance' then raise exception 'Для изменения после проверки ведомости используйте новую версию ставки или корректировку';end if;
  if p_input ? 'model_id' and (p_input->>'model_id')::uuid is distinct from emp.model_id then
   if (p_input->>'valid_from')::date is null then raise exception 'Укажите дату назначения модели';end if;
   if exists(select 1 from public.payroll_periods where venue_id=v and status<>'draft' and month+interval '1 month'>(p_input->>'valid_from')::date) then raise exception 'Утверждённые условия оплаты защищены';end if;
   if not exists(select 1 from public.payroll_employee_models where employee_id=emp.id) and emp.model_id is not null then insert into public.payroll_employee_models(account_id,venue_id,employee_id,model_id,valid_from) select a,v,emp.id,emp.model_id,starts_on from public.payroll_settings where venue_id=v;end if;
   insert into public.payroll_employee_models(account_id,venue_id,employee_id,model_id,valid_from,created_by) values(a,v,emp.id,(p_input->>'model_id')::uuid,(p_input->>'valid_from')::date,u);
  end if;
  update public.payroll_employees set model_id=case when p_input ? 'model_id' then (p_input->>'model_id')::uuid else model_id end,
   local_user_id=case when p_input ? 'local_user_id' then nullif(p_input->>'local_user_id','')::uuid else local_user_id end,
   role_name=case when p_input ? 'model_id' then (select role_name from public.payroll_models where id=(p_input->>'model_id')::uuid) else role_name end,opening_balance=coalesce((p_input->>'opening_balance')::numeric,opening_balance),opening_confirmed=coalesce((p_input->>'opening_confirmed')::boolean,opening_confirmed) where id=emp.id;
  x:=emp.id;
 elsif p_action='rule' then
  select * into m from public.payroll_models where id=(p_input->>'model_id')::uuid and account_id=a and venue_id=v;
  if m.id is null then raise exception 'Модель не найдена';end if;
  if exists(select 1 from public.payroll_periods where venue_id=v and status<>'draft' and month+interval '1 month'>(p_input->>'valid_from')::date) then raise exception 'Проверенный период защищён от изменения ставок';end if;
  if p_input ? 'employee_id' and not exists(select 1 from public.payroll_employees where id=(p_input->>'employee_id')::uuid and venue_id=v and account_id=a and model_id=m.id) then raise exception 'Сотрудник и модель не соответствуют';end if;
  if p_input ? 'config' then
   if jsonb_typeof(p_input->'config')<>'object' or exists(select 1 from jsonb_each(p_input->'config') z where z.key not in ('knowledge_amount','food_amount','cleaner_bonus','tips','experience','basis','shift_pay','extras_enabled')) then raise exception 'Некорректные параметры модели';end if;
   if exists(select 1 from jsonb_each(p_input->'config') z where z.key in ('knowledge_amount','food_amount','cleaner_bonus') and (jsonb_typeof(z.value)<>'number' or (z.value::text)::numeric<0 or (z.value::text)::numeric>1000000)) then raise exception 'Некорректная надбавка';end if;
   if exists(select 1 from jsonb_each(p_input->'config') z where z.key in ('tips','experience','shift_pay','extras_enabled') and jsonb_typeof(z.value)<>'boolean') then raise exception 'Некорректный параметр надбавки';end if;
   if p_input->'config' ? 'basis' and p_input->'config'->>'basis' not in ('hookah','bar','turnover','none') then raise exception 'Некорректная база процента';end if;
  end if;
  if jsonb_typeof(coalesce(p_input->'experience_steps','{}'))<>'object' or exists(select 1 from jsonb_each(coalesce(p_input->'experience_steps','{}')) level where level.key !~ '^[0-9]{1,4}$' or jsonb_typeof(level.value)<>'number' or (level.value::text)::numeric<0 or (level.value::text)::numeric>1000000) then raise exception 'Некорректная шкала стажа';end if;
  if not private.payroll_valid_rates(p_input->'rates') then raise exception 'Некорректные ставки';end if;
  insert into public.payroll_rule_versions(account_id,venue_id,model_id,employee_id,valid_from,rates,experience_steps,monthly_amount,tenure_requires_exam,config,created_by,change_reason)
   values(a,v,m.id,(p_input->>'employee_id')::uuid,(p_input->>'valid_from')::date,p_input->'rates',coalesce(p_input->'experience_steps','{}'),(p_input->>'monthly_amount')::numeric,coalesce((p_input->>'tenure_requires_exam')::boolean,true),coalesce(p_input->'config','{}'),u,p_input->>'reason') returning id into x;
 elsif p_action='attendance' then
  if length(reason)<3 then raise exception 'Укажите причину проверки';end if;
  select * into r from public.payroll_attendance where id=(p_input->>'id')::uuid and account_id=a and venue_id=v for update;
  if r.id is null or r.employee_id is null then raise exception 'Сначала свяжите сотрудника';end if;
  if exists(select 1 from public.payroll_periods where venue_id=v and month=date_trunc('month',r.business_date)::date and status<>'draft') then raise exception 'Период уже проверен';end if;
  if r.version<>(p_input->>'version')::integer then raise exception 'Табель изменился. Обновите страницу';end if;
  if p_input->>'status' not in ('confirmed','ignored') then raise exception 'Некорректный результат проверки';end if;
  update public.payroll_attendance set status=p_input->>'status',reviewed_by=u,review_reason=reason,version=version+1 where id=r.id;
  x:=r.id;
 elsif p_action='missing_shift' then
  if length(reason)<3 then raise exception 'Укажите причину подтверждения невыхода';end if;
  select * into plan from public.schedule_shifts where id=(p_input->>'id')::uuid and venue_id=v and published and user_id is not null;
  if plan.id is null or plan.user_id is distinct from (p_input->>'user_id')::uuid or plan.ends_at>now() or plan.starts_at is distinct from (p_input->>'starts_at')::timestamptz or plan.ends_at is distinct from (p_input->>'ends_at')::timestamptz then raise exception 'График изменился или смена ещё не закончилась';end if;
  if ((plan.starts_at at time zone (select timezone from public.venues where id=v))-make_interval(hours=>(select day_start_hour from public.sales_settings where venue_id=v)))::date is distinct from (p_input->>'date')::date then raise exception 'Рабочий день изменился';end if;
  if not exists(select 1 from public.payroll_source_days where venue_id=v and business_date=(p_input->>'date')::date and state='complete') then raise exception 'Сначала загрузите фактические отметки Quick Resto';end if;
  if exists(select 1 from public.payroll_periods where venue_id=v and month=date_trunc('month',(p_input->>'date')::date)::date and status<>'draft') then raise exception 'Период уже проверен';end if;
  select * into emp from public.payroll_employees where account_id=a and venue_id=v and local_user_id=plan.user_id;
  if exists(select 1 from public.payroll_attendance where venue_id=v and business_date=(p_input->>'date')::date and (shift_id=plan.id or employee_id=emp.id) and status<>'ignored') then raise exception 'У сотрудника есть фактическая отметка: проверьте выход';end if;
  insert into public.payroll_schedule_reviews(account_id,venue_id,shift_id,employee_id,business_date,snapshot,reason,reviewed_by) values(a,v,plan.id,emp.id,(p_input->>'date')::date,jsonb_build_object('starts_at',plan.starts_at,'ends_at',plan.ends_at,'user_id',plan.user_id),reason,u)
   on conflict(shift_id) do update set business_date=excluded.business_date,snapshot=excluded.snapshot,reason=excluded.reason,reviewed_by=u,reviewed_at=now() returning id into x;
 elsif p_action='adjustment' then
  if length(reason)<3 then raise exception 'Укажите основание';end if;
  select * into emp from public.payroll_employees where id=(p_input->>'employee_id')::uuid and account_id=a and venue_id=v;
  if emp.id is null then raise exception 'Сотрудник не найден';end if;
  v_month:=date_trunc('month',(p_input->>'date')::date)::date;
  if exists(select 1 from public.payroll_periods where venue_id=v and payroll_periods.month=v_month and status<>'draft') then raise exception 'Добавьте корректировку в открытый период';end if;
  insert into public.payroll_adjustments(account_id,venue_id,employee_id,business_date,kind,amount,reason,source_ref,created_by)
   values(a,v,emp.id,(p_input->>'date')::date,p_input->>'kind',(p_input->>'amount')::numeric,reason,p_input->>'source_ref',u) returning id into x;
 elsif p_action='approve_adjustment' then
  update public.payroll_adjustments set approved=true,approved_by=u where id=(p_input->>'id')::uuid and account_id=a and venue_id=v and not exists(select 1 from public.payroll_periods q where q.venue_id=v and q.month=date_trunc('month',payroll_adjustments.business_date)::date and q.status<>'draft') returning id into x;
  if x is null then raise exception 'Корректировка недоступна';end if;
 elsif p_action='period' then
  select * into p from public.payroll_periods where id=(p_input->>'id')::uuid and account_id=a and venue_id=v for update;
  if p.id is null or p.version<>(p_input->>'version')::integer then raise exception 'Ведомость изменилась';end if;
  if p.status='closed' or p_input->>'status' not in ('checked','closed') then raise exception 'Недопустимое состояние ведомости';end if;
  if p.status='draft' and p_input->>'status' in ('checked','closed') then
   if exists(select 1 from generate_series(p.month::timestamp,p.month+interval '1 month'-interval '1 day',interval '1 day') day where not exists(select 1 from public.payroll_source_days d where d.venue_id=v and d.business_date=day::date and d.state='complete')) then raise exception 'Дождитесь загрузки всех дней';end if;
   if (current_timestamp at time zone (select timezone from public.venues where id=v))::date<p.month+interval '1 month' then raise exception 'Расчётный месяц ещё не завершён';end if;
   if p.status<>'draft' then raise exception 'Ведомость уже проверена';end if;
   if exists(select 1 from public.payroll_cashbox where venue_id=v and business_date>=p.month and business_date<p.month+interval '1 month' and source_error is not null) then raise exception 'Изменилась проведённая инкассация: требуется сверка';end if;
   if exists(select 1 from public.payroll_attendance where venue_id=v and business_date>=p.month and business_date<p.month+interval '1 month' and private.payroll_blocks_salary(status,issue,ends_at)) or exists(select 1 from public.payroll_source_days where venue_id=v and business_date>=p.month and business_date<p.month+interval '1 month' and (jsonb_array_length(coalesce(source->'cross_boundary_ids','[]'))>0)) then raise exception 'Сначала проверьте табель';end if;
   if exists(select 1 from public.payroll_accruals where period_id=p.id and (status<>'ready' or cardinality(issues)>0)) then raise exception 'Сначала проверьте начисления';end if;
   if exists(select 1 from public.payroll_accruals c where c.period_id=p.id and c.calculation_snapshot->>'financial_day_id' is not null and not exists(select 1 from public.sales_days day where day.id=(c.calculation_snapshot->>'financial_day_id')::uuid and day.account_id=a and day.venue_id=v and day.business_date=c.business_date and day.status='complete' and day.version=(c.calculation_snapshot->>'financial_day_version')::integer)) then raise exception 'Продажи изменились. Обновите расчёт перед проверкой ведомости';end if;
   if not exists(select 1 from public.payroll_accruals where period_id=p.id) then raise exception 'Ведомость пуста';end if;
   if exists(select 1 from public.payroll_employees e where e.venue_id=v and not e.opening_confirmed and exists(select 1 from public.payroll_accruals c where c.period_id=p.id and c.employee_id=e.id)) then raise exception 'Подтвердите начальные остатки';end if;
   if exists(select 1 from public.payroll_adjustments d where d.venue_id=v and date_trunc('month',d.business_date)::date=p.month and not d.approved) then raise exception 'Есть неподтверждённые корректировки';end if;
   update public.payroll_accruals set status='approved' where period_id=p.id;
   update public.payroll_periods set status=p_input->>'status',checked_at=now(),checked_by=u,closed_at=case when p_input->>'status'='closed' then now() end,closed_by=case when p_input->>'status'='closed' then u end,version=version+1 where id=p.id;
   perform private.payroll_link_accruals(pay.id) from public.payroll_payments pay where pay.venue_id=v and pay.state='posted' and pay.kind<>'tips' and exists(select 1 from public.payroll_allocations allocation where allocation.payment_id=pay.id and allocation.month=p.month);
  else
   if p.status<>'checked' then raise exception 'Сначала проверьте ведомость';end if;
   update public.payroll_periods set status='closed',closed_at=now(),closed_by=u,version=version+1 where id=p.id;
  end if;
  x:=p.id;
 elsif p_action='qualification' then
  if length(reason)<3 then raise exception 'Укажите основание сдачи теста';end if;
  if not exists(select 1 from public.payroll_employees where id=(p_input->>'employee_id')::uuid and account_id=a and venue_id=v) then raise exception 'Сотрудник недоступен';end if;
  if exists(select 1 from public.payroll_periods where venue_id=v and status<>'draft' and month+interval '1 month'>(p_input->>'valid_from')::date) then raise exception 'Проверенный период защищён';end if;
  insert into public.payroll_qualifications(account_id,venue_id,employee_id,valid_from,valid_until,knowledge,experience,reason,created_by) values(a,v,(p_input->>'employee_id')::uuid,(p_input->>'valid_from')::date,(p_input->>'valid_until')::date,(p_input->>'knowledge')::boolean,(p_input->>'experience')::boolean,reason,u) returning id into x;
 elsif p_action='settings' then
  if (p_input ? 'tip_comments' and array(select jsonb_array_elements_text(p_input->'tip_comments')) is distinct from (select tip_comments from public.payroll_settings where venue_id=v)) or (p_input ? 'cashbox_accounts' and p_input->'cashbox_accounts' is distinct from (select cashbox_accounts from public.payroll_settings where venue_id=v)) or (p_input ? 'tip_category_id' and (p_input->>'tip_category_id')::uuid is distinct from (select tip_category_id from public.payroll_settings where venue_id=v)) or (p_input ? 'salary_category_id' and (p_input->>'salary_category_id')::uuid is distinct from (select salary_category_id from public.payroll_settings where venue_id=v))
   or (p_input ? 'official_from' and nullif(p_input->>'official_from','') is distinct from (select official_from::text from public.payroll_settings where venue_id=v))
   or (p_input ? 'official_pay_day' and p_input->>'official_pay_day' is distinct from (select official_pay_day::text from public.payroll_settings where venue_id=v))
   or (p_input ? 'official_bank_account_id' and nullif(p_input->>'official_bank_account_id','') is distinct from (select official_bank_account_id::text from public.payroll_settings where venue_id=v)) then
   if not public.has_permission('payroll.pay') or not public.has_permission('finance.create_transaction') then raise exception 'Для связи с финансами нужны права проведения выплат';end if;
  end if;
  if exists(select 1 from public.payroll_source_days where venue_id=v and state='loading') then raise exception 'Дождитесь синхронизации';end if;
  if exists(select 1 from jsonb_each_text(coalesce(p_input->'cashbox_accounts','{}')) z where not exists(select 1 from public.bank_accounts b where b.id=z.value::uuid and b.account_id=a and b.is_active and b.currency='RUB' and (b.venue_id is null or b.venue_id=v))) then raise exception 'Счёт другого заведения';end if;
  if exists(select 1 from jsonb_each_text(p_input) z where z.key in ('salary_category_id','tip_category_id') and not exists(select 1 from public.finance_categories c where c.id=z.value::uuid and c.account_id=a and c.type='expense' and c.archived_at is null)) then raise exception 'Статья расхода недоступна';end if;
  -- Официальная зарплата: с какого месяца, день проведения, расчётный счёт по умолчанию.
  if nullif(p_input->>'official_from','') is not null and extract(day from (p_input->>'official_from')::date)<>1 then raise exception 'Месяц начала официальных выплат — с первого числа';end if;
  if nullif(p_input->>'official_from','') is not null and (p_input->>'official_from')::date<(select starts_on from public.payroll_settings where venue_id=v) then raise exception 'Официальные выплаты не могут начинаться раньше начала расчёта зарплаты';end if;
  if p_input ? 'official_pay_day' and (jsonb_typeof(p_input->'official_pay_day')<>'number' or (p_input->>'official_pay_day')::numeric not between 1 and 28 or (p_input->>'official_pay_day')::numeric<>trunc((p_input->>'official_pay_day')::numeric)) then raise exception 'День официальной выплаты — с 1 по 28 число';end if;
  if nullif(p_input->>'official_bank_account_id','') is not null and not exists(select 1 from public.bank_accounts b join public.venues place on place.id=v where b.id=(p_input->>'official_bank_account_id')::uuid and b.account_id=a and b.is_active and b.deleted_at is null and b.currency='RUB' and b.type='checking' and (b.venue_id=v or (b.venue_id is null and (place.default_legal_entity_id is null or b.legal_entity_id=place.default_legal_entity_id)))) then raise exception 'Выберите расчётный счёт заведения';end if;
  update public.payroll_settings set benefits_mode=coalesce(p_input->>'benefits_mode',benefits_mode),tip_comments=case when p_input ? 'tip_comments' then array(select jsonb_array_elements_text(p_input->'tip_comments')) else tip_comments end,
    tip_tolerance=coalesce((p_input->>'tip_tolerance')::numeric,tip_tolerance),cashbox_accounts=coalesce(p_input->'cashbox_accounts',cashbox_accounts),
    salary_category_id=coalesce((p_input->>'salary_category_id')::uuid,salary_category_id),tip_category_id=coalesce((p_input->>'tip_category_id')::uuid,tip_category_id),
    official_from=case when p_input ? 'official_from' then nullif(p_input->>'official_from','')::date else official_from end,
    official_pay_day=coalesce((p_input->>'official_pay_day')::smallint,official_pay_day),
    official_bank_account_id=case when p_input ? 'official_bank_account_id' then nullif(p_input->>'official_bank_account_id','')::uuid else official_bank_account_id end,
    enabled=coalesce((p_input->>'enabled')::boolean,enabled),updated_at=now() where venue_id=v returning venue_id into x;
  if x is null then raise exception 'Начальная настройка не выполнена';end if;
 else raise exception 'Неизвестное действие';
 end if;
 insert into public.payroll_events(account_id,venue_id,entity_id,actor_id,action,details) values(a,v,x,u,p_action,jsonb_build_object('reason',reason));
 return jsonb_build_object('id',x);
end $function$;

-- ────────────────────────────────────────────────────────────
-- 2. Проведение официальной выплаты
-- ────────────────────────────────────────────────────────────
-- Статья расхода — по должности сотрудника, как у обычных выплат (247).
create or replace function private.payroll_official_category(a uuid, v uuid, p_employee uuid)
returns uuid
language sql
stable
set search_path = public, pg_catalog
as $$
  select c.id
  from public.payroll_employees e
  join public.roles r on r.id = e.role_id
  join public.finance_categories c on c.payroll_role_id = r.id
  where e.id = p_employee and e.account_id = a and e.venue_id = v
    and r.venue_id = v and r.archived_at is null
    and c.account_id = a and c.archived_at is null and c.type = 'expense'
  limit 1
$$;

create or replace function private.payroll_official_post(
  a uuid, v uuid, u uuid, p_employment uuid, p_month date,
  p_gross numeric, p_net numeric, p_bank uuid, p_date timestamptz)
returns uuid
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  oe public.payroll_official_employments;
  emp public.payroll_employees;
  category uuid;
  key uuid;
  month_names text[] := array['январь','февраль','март','апрель','май','июнь',
                              'июль','август','сентябрь','октябрь','ноябрь','декабрь'];
begin
  select * into oe from public.payroll_official_employments
   where id = p_employment and account_id = a and venue_id = v and archived_at is null;
  if oe.id is null then raise exception 'Официальное оформление не найдено'; end if;
  select * into emp from public.payroll_employees where id = oe.employee_id;
  if emp.role_id is null then raise exception 'У сотрудника % не указана должность', emp.name; end if;
  category := private.payroll_official_category(a, v, emp.id);
  if category is null then raise exception 'Проверьте статью ФОТ для должности сотрудника %', emp.name; end if;

  -- Первое проведение месяца — устойчивый ключ; повтор после удаления — новый.
  key := md5('official:' || p_employment::text || p_month::text)::uuid;
  if exists (select 1 from public.payroll_payments where account_id = a and venue_id = v and request_key = key) then
    key := gen_random_uuid();
  end if;

  return private.payroll_post_payment_scoped(jsonb_build_object(
    'request_key', key, 'kind', 'salary', 'bank_account_id', p_bank, 'category_id', category,
    'date', p_date, 'amount', p_net, 'official_month', p_month,
    'note', 'Официальная часть за ' || month_names[extract(month from p_month)::int] || ' ' || extract(year from p_month)::int,
    'allocations', jsonb_build_array(jsonb_build_object(
      'employee_id', emp.id, 'month', p_month, 'amount', p_net, 'settled_amount', p_gross))),
    a, v, u);
end $$;

create or replace function private.payroll_official_month_audit(
  p_row public.payroll_official_months, p_user uuid, p_code text, p_details jsonb)
returns void
language sql
set search_path = public, pg_catalog
as $$
  insert into public.audit_logs(account_id, venue_id, user_id, action_code, entity_type, entity_id, details)
  select p_row.account_id, p_row.venue_id, p_user, p_code, 'payroll_official_month', p_row.id,
         jsonb_build_object('employee_id', pe.id, 'employee_name', pe.name, 'employment_id', p_row.employment_id,
                            'month', p_row.month, 'kind', p_row.kind, 'reason', p_row.reason) || p_details
  from public.payroll_employees pe
  where pe.id = p_row.employee_id
$$;

-- ────────────────────────────────────────────────────────────
-- 3. Ручное проведение, пропуск карточки, смена счёта
-- ────────────────────────────────────────────────────────────
create or replace function public.payroll_record_official_payment(p_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  a uuid; v uuid; u uuid;
  oe public.payroll_official_employments;
  m public.payroll_official_months;
  v_month date; v_gross numeric; v_net numeric; v_date timestamptz;
  v_kind text; prev_status text; payment uuid;
begin
  select s.a, s.v, s.u into a, v, u from private.payroll_scope('payroll.pay') s;
  if a is null or v is null then raise exception 'Выберите заведение'; end if;
  if not public.has_permission('finance.create_transaction') then raise exception 'Нет доступа к финансовым операциям'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v::text, 0));

  select * into oe from public.payroll_official_employments
   where id = nullif(p_input->>'employment_id', '')::uuid and account_id = a and venue_id = v and archived_at is null;
  if oe.id is null then raise exception 'Официальное оформление не найдено'; end if;
  v_month := nullif(p_input->>'month', '')::date;
  if v_month is null or extract(day from v_month) <> 1 then raise exception 'Укажите месяц официальной выплаты'; end if;
  if oe.starts_on >= (v_month + interval '1 month')::date or (oe.ends_on is not null and oe.ends_on < v_month) then
    raise exception 'Сотрудник не оформлен официально в этом месяце';
  end if;
  v_gross := nullif(p_input->>'gross', '')::numeric;
  v_net := nullif(p_input->>'net', '')::numeric;
  if v_gross is null or v_net is null or v_net <= 0 or v_gross > 1000000000
     or round(v_gross, 2) <> v_gross or round(v_net, 2) <> v_net then
    raise exception 'Укажите сумму на руки и оклад с налогом';
  end if;
  if v_net > v_gross then raise exception 'Сумма на руки больше оклада с налогом'; end if;
  v_date := nullif(p_input->>'date', '')::timestamptz;
  if v_date is null then raise exception 'Укажите дату выплаты'; end if;
  -- «Одна действующая официальная выплата за месяц» проверяет
  -- payroll_post_payment_scoped — для всех путей проведения сразу.

  payment := private.payroll_official_post(a, v, u, oe.id, v_month, v_gross, v_net,
    nullif(p_input->>'bank_account_id', '')::uuid, v_date);

  select status into prev_status from public.payroll_official_months
   where employment_id = oe.id and month = v_month for update;
  select g.kind into v_kind from private.payroll_official_gross(oe.id, v_month) g;
  insert into public.payroll_official_months(account_id, venue_id, employment_id, employee_id, month, kind, gross,
    status, payment_id, resolved_by, resolved_at)
  values (a, v, oe.id, oe.employee_id, v_month, coalesce(v_kind, 'full'), v_gross, 'resolved', payment, u, now())
  on conflict (employment_id, month) do update
    set status = 'resolved', payment_id = excluded.payment_id, gross = excluded.gross,
        resolved_by = excluded.resolved_by, resolved_at = excluded.resolved_at
  returning * into m;

  perform private.payroll_official_month_audit(m, u,
    case when prev_status = 'review' then 'payroll.official_month.resolved' else 'payroll.official_payment.created' end,
    jsonb_build_object('payment_id', payment, 'gross', v_gross, 'net', v_net, 'tax', v_gross - v_net,
      'date', v_date, 'previous_status', prev_status,
      'bank_account_id', (select bank_account_id from public.transactions t join public.payroll_payments p on p.transaction_id = t.id where p.id = payment),
      'bank_name', (select b.name from public.bank_accounts b join public.transactions t on t.bank_account_id = b.id
                     join public.payroll_payments p on p.transaction_id = t.id where p.id = payment)));
  return payment;
end $$;

create or replace function public.payroll_official_skip(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  a uuid; v uuid; u uuid;
  m public.payroll_official_months;
begin
  select s.a, s.v, s.u into a, v, u from private.payroll_scope('payroll.pay') s;
  if a is null or v is null then raise exception 'Выберите заведение'; end if;
  if not public.has_permission('finance.create_transaction') then raise exception 'Нет доступа к финансовым операциям'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v::text, 0));

  select * into m from public.payroll_official_months where id = p_id and account_id = a and venue_id = v for update;
  if m.id is null then raise exception 'Карточка не найдена'; end if;
  if m.status <> 'review' then raise exception 'Карточка уже разобрана'; end if;
  update public.payroll_official_months
     set status = 'skipped', resolved_by = u, resolved_at = now()
   where id = m.id
  returning * into m;
  perform private.payroll_official_month_audit(m, u, 'payroll.official_month.skipped', jsonb_build_object('gross', m.gross));
end $$;

create or replace function public.payroll_official_change_account(p_input jsonb)
returns uuid[]
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  a uuid; v uuid; u uuid;
  bank public.bank_accounts;
  pid uuid; new_pid uuid;
  p public.payroll_payments; t public.transactions; al public.payroll_allocations;
  month_ids uuid[] := '{}'; moved jsonb := '[]'; result uuid[] := '{}';
begin
  select s.a, s.v, s.u into a, v, u from private.payroll_scope('payroll.pay') s;
  if a is null or v is null then raise exception 'Выберите заведение'; end if;
  if not public.has_permission('finance.create_transaction') then raise exception 'Нет доступа к финансовым операциям'; end if;
  -- Старая операция удаляется — нужно то же право, что у payroll_cancel_payment.
  if not public.has_permission('finance.delete_transaction') then raise exception 'Нет доступа к отмене финансовой операции'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v::text, 0));

  if jsonb_typeof(p_input->'payment_ids') is distinct from 'array'
     or jsonb_array_length(p_input->'payment_ids') not between 1 and 500 then
    raise exception 'Выберите официальные выплаты';
  end if;
  select * into bank from public.bank_accounts
   where id = nullif(p_input->>'bank_account_id', '')::uuid and account_id = a and is_active and deleted_at is null;
  if bank.id is null or bank.currency <> 'RUB' or (bank.venue_id is not null and bank.venue_id <> v) then
    raise exception 'Счёт недоступен';
  end if;
  if bank.type <> 'checking' then raise exception 'Официальную выплату можно провести только с расчётного счёта'; end if;

  for pid in select distinct x::uuid from jsonb_array_elements_text(p_input->'payment_ids') x loop
    select * into p from public.payroll_payments where id = pid and account_id = a and venue_id = v for update;
    if p.id is null or p.state <> 'posted' or p.official_month is null then
      raise exception 'Выплата недоступна для смены счёта';
    end if;
    select * into t from public.transactions where id = p.transaction_id;
    if t.bank_account_id = bank.id then
      result := array_append(result, p.id);
      continue;
    end if;
    if (select count(*) from public.payroll_allocations where payment_id = p.id) <> 1 then
      raise exception 'Выплата недоступна для смены счёта';
    end if;
    select * into al from public.payroll_allocations where payment_id = p.id;

    -- Мягкое удаление операции отменяет выплату (payroll_transaction_guard).
    update public.transactions set deleted_at = now(), deleted_by = u where id = t.id and deleted_at is null;
    if (select state from public.payroll_payments where id = p.id) <> 'cancelled' then
      raise exception 'Не удалось отменить выплату на прежнем счёте';
    end if;

    new_pid := private.payroll_post_payment_scoped(jsonb_build_object(
      'request_key', gen_random_uuid(), 'kind', 'salary', 'bank_account_id', bank.id, 'category_id', t.category_id,
      'date', p.occurred_at, 'amount', p.amount, 'note', nullif(p.note, ''), 'official_month', p.official_month,
      'allocations', jsonb_build_array(jsonb_build_object(
        'employee_id', al.employee_id, 'month', al.month, 'amount', al.amount, 'settled_amount', al.settled_amount))),
      a, v, u);

    month_ids := month_ids || array(
      select id from public.payroll_official_months where account_id = a and venue_id = v and payment_id = p.id);
    update public.payroll_official_months set payment_id = new_pid
     where account_id = a and venue_id = v and payment_id = p.id;
    moved := moved || jsonb_build_array(jsonb_build_object(
      'previous_payment_id', p.id, 'payment_id', new_pid, 'employee_id', al.employee_id,
      'employee_name', (select name from public.payroll_employees where id = al.employee_id),
      'month', p.official_month, 'amount', p.amount, 'previous_bank_account_id', t.bank_account_id));
    result := array_append(result, new_pid);
  end loop;

  -- Одна строка журнала на команду.
  if jsonb_array_length(moved) > 0 then
    insert into public.audit_logs(account_id, venue_id, user_id, action_code, entity_type, entity_id, details)
    values (a, v, u, 'payroll.official_payment.account_changed', 'payroll_official_month',
      case when cardinality(month_ids) = 1 then month_ids[1] end,
      jsonb_build_object('bank_account_id', bank.id, 'bank_name', bank.name,
        'count', jsonb_array_length(moved), 'payments', moved));
  end if;
  return result;
end $$;

-- ────────────────────────────────────────────────────────────
-- 4. Крон: официальные выплаты за прошлый месяц
-- ────────────────────────────────────────────────────────────
-- Только service_role. Сегодня — по поясу аккаунта (как finance_account_today,
-- но от p_now, чтобы пропущенный запуск и тесты считались от заданного момента).
-- До дня проведения ничего не делает; позже — проводит один раз, датой дня
-- проведения (крон не работал 5-го, запустился 9-го — выплата всё равно от 5-го).
-- Порядок разбора: неактивный в зарплате без даты увольнения → inactive
-- (не больше одной открытой карточки на период); месяц увольнения →
-- final_month; нет счёта → no_bank_account; нет статьи → no_category.
-- Ошибка одного периода откатывает только его: остальные проводятся, а ошибка
-- попадает в элемент заведения (errors: [{employment_id, message}]); строки
-- месяца у такого периода нет, следующий запуск попробует снова. Ошибка всего
-- заведения откатывает только его (error). Обе — ещё и warning в лог базы.
create or replace function public.payroll_official_run(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  s record;
  today date; m date; pay_date timestamptz;
  oe public.payroll_official_employments;
  emp public.payroll_employees;
  g record;
  bank_ok boolean;
  posted int; review int; total numeric; net numeric;
  st text; rs text; pid uuid;
  errors jsonb;
  result jsonb := '[]';
begin
  for s in
    select ps.account_id, ps.venue_id, ps.official_from, ps.official_pay_day, ps.official_bank_account_id,
           coalesce(acc.timezone, 'Europe/Moscow') as tz
    from public.payroll_settings ps
    join public.accounts acc on acc.id = ps.account_id
    join public.venues place on place.id = ps.venue_id
    where ps.official_from is not null and place.archived_at is null
    order by ps.account_id, ps.venue_id
  loop
    today := (p_now at time zone s.tz)::date;
    if extract(day from today) < s.official_pay_day then continue; end if;
    m := (date_trunc('month', today::timestamp) - interval '1 month')::date;
    if m < s.official_from then continue; end if;
    pay_date := (((m + interval '1 month')::date + (s.official_pay_day - 1)) + time '12:00') at time zone s.tz;

    begin
      perform pg_advisory_xact_lock(hashtextextended(s.venue_id::text, 0));
      select exists (
        select 1 from public.bank_accounts b
        where b.id = s.official_bank_account_id and b.account_id = s.account_id
          and b.is_active and b.deleted_at is null and b.currency = 'RUB' and b.type = 'checking'
          and (b.venue_id is null or b.venue_id = s.venue_id)) into bank_ok;
      posted := 0; review := 0; total := 0; errors := '[]';

      for oe in
        select e.* from public.payroll_official_employments e
        where e.account_id = s.account_id and e.venue_id = s.venue_id and e.archived_at is null
          and e.starts_on < (m + interval '1 month')::date
          and (e.ends_on is null or e.ends_on >= m)
          and not exists (select 1 from public.payroll_official_months om where om.employment_id = e.id and om.month = m)
        order by e.starts_on, e.id
      loop
        begin
          select * into g from private.payroll_official_gross(oe.id, m);
          if g.kind is null then continue; end if;
          select * into emp from public.payroll_employees where id = oe.employee_id;
          st := 'review'; rs := null; pid := null; net := 0;

          if not emp.active and oe.ends_on is null then
            -- Уже висит карточка «проверьте увольнение» — вторую не создаём.
            if exists (select 1 from public.payroll_official_months om
                        where om.employment_id = oe.id and om.status = 'review' and om.reason = 'inactive' and om.month < m) then
              continue;
            end if;
            rs := 'inactive';
          elsif g.kind = 'final' then
            rs := 'final_month';
          elsif not bank_ok then
            rs := 'no_bank_account';
          elsif private.payroll_official_category(s.account_id, s.venue_id, emp.id) is null then
            rs := 'no_category';
          else
            net := g.gross - round(g.gross * 0.13, 0);
            pid := private.payroll_official_post(s.account_id, s.venue_id, null, oe.id, m, g.gross, net,
                                                 s.official_bank_account_id, pay_date);
            st := 'posted';
          end if;

          insert into public.payroll_official_months(account_id, venue_id, employment_id, employee_id, month,
            kind, gross, status, reason, payment_id)
          values (s.account_id, s.venue_id, oe.id, oe.employee_id, m, g.kind, g.gross, st, rs, pid);
          -- Счётчики — только после успешной записи (переменные не откатываются).
          if st = 'posted' then
            posted := posted + 1;
            total := total + net;
          else
            review := review + 1;
          end if;
        exception when others then
          raise warning 'payroll_official_run: account %, venue %, employment %, month %: %',
            s.account_id, s.venue_id, oe.id, m, sqlerrm;
          errors := errors || jsonb_build_array(jsonb_build_object('employment_id', oe.id, 'message', sqlerrm));
        end;
      end loop;

      if posted + review > 0 or jsonb_array_length(errors) > 0 then
        result := result || jsonb_build_array(jsonb_build_object(
          'account_id', s.account_id, 'venue_id', s.venue_id, 'month', m,
          'posted', posted, 'review', review, 'amount', total, 'errors', errors));
      end if;
    exception when others then
      raise warning 'payroll_official_run: account %, venue %, month %: %', s.account_id, s.venue_id, m, sqlerrm;
      result := result || jsonb_build_array(jsonb_build_object(
        'account_id', s.account_id, 'venue_id', s.venue_id, 'month', m,
        'posted', 0, 'review', 0, 'amount', 0, 'error', sqlerrm));
    end;
  end loop;
  return result;
end $$;

-- ────────────────────────────────────────────────────────────
-- 5. Права на функции и проверка результата
-- ────────────────────────────────────────────────────────────
revoke all on function private.payroll_official_category(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.payroll_official_post(uuid, uuid, uuid, uuid, date, numeric, numeric, uuid, timestamptz) from public, anon, authenticated;
revoke all on function private.payroll_official_month_audit(public.payroll_official_months, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.payroll_record_official_payment(jsonb) from public, anon;
grant execute on function public.payroll_record_official_payment(jsonb) to authenticated;
revoke all on function public.payroll_official_skip(uuid) from public, anon;
grant execute on function public.payroll_official_skip(uuid) to authenticated;
revoke all on function public.payroll_official_change_account(jsonb) from public, anon;
grant execute on function public.payroll_official_change_account(jsonb) to authenticated;
revoke all on function public.payroll_post_payment(jsonb) from public, anon;
grant execute on function public.payroll_post_payment(jsonb) to authenticated;
revoke all on function public.payroll_official_run(timestamptz) from public, anon, authenticated;
grant execute on function public.payroll_official_run(timestamptz) to service_role;

-- От роли-не-владельца REVOKE/GRANT дают только WARNING — проверяем итог.
do $$
begin
  if has_function_privilege('anon', 'public.payroll_official_run(timestamptz)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.payroll_official_run(timestamptz)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.payroll_official_run(timestamptz)', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.payroll_official_post(uuid, uuid, uuid, uuid, date, numeric, numeric, uuid, timestamptz)', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.payroll_official_category(uuid, uuid, uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.payroll_official_month_audit(public.payroll_official_months, uuid, text, jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.payroll_post_payment_scoped(jsonb, uuid, uuid, uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.payroll_queue_adesk_sync()', 'EXECUTE')
    or has_function_privilege('anon', 'public.payroll_record_official_payment(jsonb)', 'EXECUTE')
    or has_function_privilege('anon', 'public.payroll_official_skip(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.payroll_official_change_account(jsonb)', 'EXECUTE')
    or has_function_privilege('anon', 'public.payroll_command(text, jsonb)', 'EXECUTE')
    or has_function_privilege('anon', 'public.payroll_post_payment(jsonb)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.payroll_post_payment(jsonb)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.payroll_record_official_payment(jsonb)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.payroll_official_skip(uuid)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.payroll_official_change_account(jsonb)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.payroll_command(text, jsonb)', 'EXECUTE')
  then
    raise exception 'payroll_official_*: права на функции не применились — применяйте от supabase_admin';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
