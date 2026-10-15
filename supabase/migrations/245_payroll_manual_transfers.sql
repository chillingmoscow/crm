-- A transfer moves an existing debt between statements; it never creates salary or a financial expense.
create table public.payroll_transfers (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,employee_id uuid not null,
 from_month date not null,to_month date not null,amount numeric(15,2) not null,
 reason text not null check(length(trim(reason))>=3),state text not null default 'posted' check(state in ('posted','cancelled')),
 request_key uuid not null,input_snapshot jsonb not null,created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 cancelled_by uuid references public.profiles(id),cancelled_at timestamptz,
 check(to_month>from_month and date_trunc('month',from_month)::date=from_month and date_trunc('month',to_month)::date=to_month),
 check(amount<>0 and abs(amount)<=1000000000),unique(venue_id,request_key),
 foreign key(account_id,venue_id,employee_id) references public.payroll_employees(account_id,venue_id,id)
);
create index payroll_transfers_employee_month on public.payroll_transfers(employee_id,from_month,to_month) where state='posted';
alter table public.payroll_transfers enable row level security;
revoke all on public.payroll_transfers from public,anon,authenticated;
grant select on public.payroll_transfers to authenticated;
grant all on public.payroll_transfers to service_role;
create policy payroll_transfer_read on public.payroll_transfers for select to authenticated using(private.payroll_read(account_id,venue_id,employee_id));

create or replace function private.payroll_month_balance(e uuid,m date,approved_only boolean default false)
returns numeric language sql stable security definer set search_path='' as $$
 select coalesce((select opening_balance from public.payroll_employees employee join public.payroll_settings settings using(account_id,venue_id) where employee.id=e and settings.starts_on=m),0)
 +coalesce((select sum(salary) from public.payroll_accruals where employee_id=e and business_date>=m and business_date<m+interval '1 month' and (not approved_only or status='approved')),0)
 +coalesce((select sum(case when to_month=m then amount else -amount end) from public.payroll_transfers where employee_id=e and state='posted' and (from_month=m or to_month=m)),0)
 -coalesce((select sum(allocation.settled_amount) from public.payroll_allocations allocation join public.payroll_payments payment on payment.id=allocation.payment_id where allocation.employee_id=e and allocation.month=m and payment.state='posted' and payment.kind<>'tips'),0);
$$;
revoke all on function private.payroll_month_balance(uuid,date,boolean) from public,anon,authenticated;

create or replace function public.payroll_transfer(p_input jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid;v uuid;u uuid;e public.payroll_employees;t public.payroll_transfers;x uuid;
 f date:=(p_input->>'from_month')::date;dest date:=(p_input->>'to_month')::date;n numeric:=(p_input->>'amount')::numeric;balance numeric;
begin
 select s.a,s.v,s.u into a,v,u from private.payroll_scope('payroll.review') s;
 if a is null or v is null then raise exception 'Выберите заведение';end if;
 perform pg_advisory_xact_lock(hashtextextended(v::text,0));
 select * into t from public.payroll_transfers where account_id=a and venue_id=v and request_key=(p_input->>'request_key')::uuid;
 if t.id is not null then if t.input_snapshot is distinct from p_input then raise exception 'Ключ уже использован для другого переноса';end if;return t.id;end if;
 select * into e from public.payroll_employees where id=(p_input->>'employee_id')::uuid and account_id=a and venue_id=v for update;
 if e.id is null then raise exception 'Сотрудник недоступен';end if;
 if not e.opening_confirmed then raise exception 'Сначала укажите начальный долг или переплату';end if;
 if exists(select 1 from public.payroll_legacy_payments where employee_id=e.id and month=f and state='review') then raise exception 'Сначала внесите прежние выплаты этого месяца';end if;
 if f is null or dest is null or dest<=f or date_trunc('month',f)::date<>f or date_trunc('month',dest)::date<>dest or f<(select starts_on from public.payroll_settings where venue_id=v) then raise exception 'Выберите следующий месяц';end if;
 if not exists(select 1 from public.payroll_periods where venue_id=v and month=f) then raise exception 'Расчёт исходного месяца не готов';end if;
 if exists(select 1 from public.payroll_periods where venue_id=v and month=dest and status='closed') then raise exception 'Месяц назначения уже закрыт';end if;
 if n is null or n=0 or abs(n)>1000000000 or round(n,2)<>n or coalesce(length(trim(p_input->>'reason')),0)<3 or p_input->>'request_key' is null then raise exception 'Укажите сумму и причину переноса';end if;
 if exists(select 1 from public.payroll_source_days where venue_id=v and business_date>=f and business_date<f+interval '1 month' and state<>'complete') or exists(select 1 from public.payroll_accruals where employee_id=e.id and business_date>=f and business_date<f+interval '1 month' and cardinality(issues)>0) or exists(select 1 from public.payroll_adjustments where employee_id=e.id and business_date>=f and business_date<f+interval '1 month' and not approved) then raise exception 'Сначала завершите расчёт сотрудника за исходный месяц';end if;
 balance:=private.payroll_month_balance(e.id,f);
 if sign(n)<>sign(balance) or abs(n)>abs(balance) then raise exception 'Сумма превышает остаток этого месяца';end if;
 insert into public.payroll_transfers(account_id,venue_id,employee_id,from_month,to_month,amount,reason,request_key,input_snapshot,created_by)
 values(a,v,e.id,f,dest,n,trim(p_input->>'reason'),(p_input->>'request_key')::uuid,p_input,u) returning id into x;
 insert into public.payroll_events(account_id,venue_id,employee_id,entity_id,actor_id,action,details) values(a,v,e.id,x,u,'transfer',jsonb_build_object('from_month',f,'to_month',dest,'amount',n,'reason',p_input->>'reason'));
 return x;
end $$;
revoke all on function public.payroll_transfer(jsonb) from public,anon;
grant execute on function public.payroll_transfer(jsonb) to authenticated;

create or replace function public.payroll_cancel_transfer(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare a uuid;v uuid;u uuid;t public.payroll_transfers;balance numeric;
begin
 select s.a,s.v,s.u into a,v,u from private.payroll_scope('payroll.review') s;
 perform pg_advisory_xact_lock(hashtextextended(v::text,0));
 select * into t from public.payroll_transfers where id=p_id and account_id=a and venue_id=v for update;
 if t.id is null then raise exception 'Перенос недоступен';end if;
 if t.state='cancelled' then return;end if;
 if exists(select 1 from public.payroll_periods where venue_id=v and month=t.to_month and status='closed') then raise exception 'Месяц назначения закрыт';end if;
 balance:=private.payroll_month_balance(t.employee_id,t.to_month);
 if sign(balance)<>sign(t.amount) or abs(balance)<abs(t.amount) then raise exception 'Перенесённая сумма уже использована. Сначала отмените связанную выплату или следующий перенос';end if;
 update public.payroll_transfers set state='cancelled',cancelled_at=now(),cancelled_by=u where id=t.id;
 insert into public.payroll_events(account_id,venue_id,employee_id,entity_id,actor_id,action) values(a,v,t.employee_id,t.id,u,'transfer_cancelled');
end $$;
revoke all on function public.payroll_cancel_transfer(uuid) from public,anon;
grant execute on function public.payroll_cancel_transfer(uuid) to authenticated;

create or replace function private.payroll_blocks_salary(s text,issue text,ends_at timestamptz)
returns boolean language sql immutable set search_path='' as $$
 select s<>'ignored' and (s in ('unlinked','open') or ends_at is null or (s='deviation' and coalesce(issue,'') like '%границ%'));
$$;
revoke all on function private.payroll_blocks_salary(text,text,timestamptz) from public,anon,authenticated;
create or replace function public.payroll_command(p_action text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
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
   if jsonb_typeof(p_input->'config')<>'object' or exists(select 1 from jsonb_each(p_input->'config') z where z.key not in ('knowledge_amount','food_amount','cleaner_bonus','tips','experience','basis')) then raise exception 'Некорректные параметры модели';end if;
   if exists(select 1 from jsonb_each(p_input->'config') z where z.key in ('knowledge_amount','food_amount','cleaner_bonus') and (jsonb_typeof(z.value)<>'number' or (z.value::text)::numeric<0 or (z.value::text)::numeric>1000000)) then raise exception 'Некорректная надбавка';end if;
   if exists(select 1 from jsonb_each(p_input->'config') z where z.key in ('tips','experience') and jsonb_typeof(z.value)<>'boolean') then raise exception 'Некорректный параметр надбавки';end if;
   if p_input->'config' ? 'basis' and p_input->'config'->>'basis' not in ('hookah','bar','turnover','none') then raise exception 'Некорректная база процента';end if;
  end if;
  if jsonb_typeof(coalesce(p_input->'experience_steps','{}'))<>'object' or exists(select 1 from jsonb_each(coalesce(p_input->'experience_steps','{}')) level where level.key !~ '^[0-9]{1,4}$' or jsonb_typeof(level.value)<>'number' or (level.value::text)::numeric<0 or (level.value::text)::numeric>1000000) then raise exception 'Некорректная шкала стажа';end if;
  if not private.payroll_valid_rates(p_input->'rates') then raise exception 'Некорректные ставки';end if;
  insert into public.payroll_rule_versions(account_id,venue_id,model_id,employee_id,valid_from,rates,experience_steps,monthly_amount,tenure_requires_exam,config,created_by)
   values(a,v,m.id,(p_input->>'employee_id')::uuid,(p_input->>'valid_from')::date,p_input->'rates',coalesce(p_input->'experience_steps','{}'),(p_input->>'monthly_amount')::numeric,coalesce((p_input->>'tenure_requires_exam')::boolean,true),coalesce(p_input->'config','{}'),u) returning id into x;
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
  if (p_input ? 'tip_comments' and array(select jsonb_array_elements_text(p_input->'tip_comments')) is distinct from (select tip_comments from public.payroll_settings where venue_id=v)) or (p_input ? 'cashbox_accounts' and p_input->'cashbox_accounts' is distinct from (select cashbox_accounts from public.payroll_settings where venue_id=v)) or (p_input ? 'tip_category_id' and (p_input->>'tip_category_id')::uuid is distinct from (select tip_category_id from public.payroll_settings where venue_id=v)) or (p_input ? 'salary_category_id' and (p_input->>'salary_category_id')::uuid is distinct from (select salary_category_id from public.payroll_settings where venue_id=v)) then
   if not public.has_permission('payroll.pay') or not public.has_permission('finance.create_transaction') then raise exception 'Для связи с финансами нужны права проведения выплат';end if;
  end if;
  if exists(select 1 from public.payroll_source_days where venue_id=v and state='loading') then raise exception 'Дождитесь синхронизации';end if;
  if exists(select 1 from jsonb_each_text(coalesce(p_input->'cashbox_accounts','{}')) z where not exists(select 1 from public.bank_accounts b where b.id=z.value::uuid and b.account_id=a and b.is_active and b.currency='RUB' and (b.venue_id is null or b.venue_id=v))) then raise exception 'Счёт другого заведения';end if;
  if exists(select 1 from jsonb_each_text(p_input) z where z.key in ('salary_category_id','tip_category_id') and not exists(select 1 from public.finance_categories c where c.id=z.value::uuid and c.account_id=a and c.type='expense' and c.archived_at is null)) then raise exception 'Статья расхода недоступна';end if;
  update public.payroll_settings set benefits_mode=coalesce(p_input->>'benefits_mode',benefits_mode),tip_comments=case when p_input ? 'tip_comments' then array(select jsonb_array_elements_text(p_input->'tip_comments')) else tip_comments end,
    tip_tolerance=coalesce((p_input->>'tip_tolerance')::numeric,tip_tolerance),cashbox_accounts=coalesce(p_input->'cashbox_accounts',cashbox_accounts),
    salary_category_id=coalesce((p_input->>'salary_category_id')::uuid,salary_category_id),tip_category_id=coalesce((p_input->>'tip_category_id')::uuid,tip_category_id),
    enabled=coalesce((p_input->>'enabled')::boolean,enabled),updated_at=now() where venue_id=v returning venue_id into x;
  if x is null then raise exception 'Начальная настройка не выполнена';end if;
 else raise exception 'Неизвестное действие';
 end if;
 insert into public.payroll_events(account_id,venue_id,entity_id,actor_id,action,details) values(a,v,x,u,p_action,jsonb_build_object('reason',reason));
 return jsonb_build_object('id',x);
end $$;
revoke all on function public.payroll_command(text,jsonb) from public,anon;
grant execute on function public.payroll_command(text,jsonb) to authenticated;
create or replace function private.payroll_post_payment_scoped(p_input jsonb,a uuid,v uuid,u uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare existing uuid;existing_snapshot jsonb;payment uuid;tx uuid;bank public.bank_accounts;c public.payroll_cashbox;linked public.transactions;
 row jsonb;emp public.payroll_employees;amount numeric:=(p_input->>'amount')::numeric;total numeric:=0;settled numeric:=0;
 kind text:=p_input->>'kind';v_month date;category uuid:=(p_input->>'category_id')::uuid;cash uuid:=(p_input->>'cashbox_id')::uuid;evidence public.payroll_legacy_payments;
begin

 perform pg_advisory_xact_lock(hashtextextended(v::text,0));
 select pp.id,pp.input_snapshot into existing,existing_snapshot from public.payroll_payments pp where pp.account_id=a and pp.venue_id=v and pp.request_key=(p_input->>'request_key')::uuid;
 if existing is not null then if existing_snapshot is distinct from p_input then raise exception 'Этот ключ уже использован для другой выплаты';end if;return existing;end if;
 if kind not in ('salary','advance','tips') or amount is null or amount<=0 or amount>1000000000 or round(amount,2)<>amount then raise exception 'Некорректная выплата';end if;
 select * into bank from public.bank_accounts where id=(p_input->>'bank_account_id')::uuid and account_id=a and is_active;
 if bank.id is null or bank.currency<>'RUB' or (bank.venue_id is not null and bank.venue_id<>v) then raise exception 'Счёт недоступен';end if;
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
  if kind<>'tips' and (row->>'amount')::numeric<>(row->>'settled_amount')::numeric then raise exception 'Округление доступно только для чаевых';end if;
  if kind='tips' then
   if cash is null or row->>'accrual_id' is null or v_month<>date_trunc('month',c.business_date)::date then raise exception 'Чаевые должны быть связаны с инкассацией и начислением';end if;
   if not exists(select 1 from public.payroll_accruals where id=(row->>'accrual_id')::uuid and employee_id=emp.id and venue_id=v and business_date=c.business_date and status in ('ready','approved') and cardinality(issues)=0) then raise exception 'Начисление ещё не проверено';end if;
   if (row->>'settled_amount')::numeric>(select tips from public.payroll_accruals where id=(row->>'accrual_id')::uuid)-coalesce((select sum(x.settled_amount) from public.payroll_allocations x join public.payroll_payments y on y.id=x.payment_id where x.accrual_id=(row->>'accrual_id')::uuid and y.state='posted'),0) then raise exception 'Чаевые уже выданы';end if;
  end if;
  if row ? 'accrual_id' and not exists(select 1 from public.payroll_accruals where id=(row->>'accrual_id')::uuid and employee_id=emp.id and venue_id=v and (cash is null or business_date=c.business_date)) then raise exception 'Начисление недоступно';end if;
  if evidence.id is not null and (emp.id<>evidence.employee_id or v_month<>evidence.month) then raise exception 'Получатель исторической выплаты изменён';end if;
  if kind='salary' and evidence.id is null and exists(select 1 from public.payroll_legacy_payments where employee_id=emp.id and month=v_month and state='review') then raise exception 'Сначала внесите прежние выплаты этого месяца';end if;
  if kind='salary' and evidence.id is null and exists(select 1 from public.payroll_source_days where venue_id=v and business_date>=v_month and business_date<v_month+interval '1 month' and state<>'complete') then raise exception 'Дождитесь обновления данных Quick Resto';end if;
  if kind='salary' and evidence.id is null and not emp.opening_confirmed then raise exception 'Подтвердите начальный остаток сотрудника';end if;
  if kind='salary' and evidence.id is null and exists(select 1 from public.payroll_accruals where employee_id=emp.id and business_date>=v_month and business_date<v_month+interval '1 month' and cardinality(issues)>0) then raise exception 'Не хватает данных для расчёта сотрудника';end if;
  if kind='salary' and evidence.id is null and (row->>'amount')::numeric>private.payroll_month_balance(emp.id,v_month) then raise exception 'Сумма превышает остаток к выплате в этом месяце';end if;
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
 insert into public.payroll_payments(account_id,venue_id,request_key,transaction_id,cashbox_id,kind,amount,note,created_by,legacy_evidence_id,input_snapshot,occurred_at)
  values(a,v,(p_input->>'request_key')::uuid,tx,cash,kind,amount,coalesce(p_input->>'note',''),u,evidence.id,p_input,(p_input->>'date')::timestamptz) returning id into payment;
 if evidence.id is not null then update public.payroll_legacy_payments set state='posted',payment_id=payment where id=evidence.id;end if;
 for row in select * from jsonb_array_elements(p_input->'allocations') loop
  insert into public.payroll_allocations(account_id,venue_id,payment_id,employee_id,accrual_id,month,amount,settled_amount)
   values(a,v,payment,(row->>'employee_id')::uuid,(row->>'accrual_id')::uuid,(row->>'month')::date,(row->>'amount')::numeric,(row->>'settled_amount')::numeric);
 end loop;
 perform private.payroll_link_accruals(payment);
 if cash is not null then update public.payroll_cashbox set state='posted',rounding=settled-(p_input->>'amount')::numeric where id=cash;end if;
 insert into public.payroll_events(account_id,venue_id,entity_id,actor_id,action,details) values(a,v,payment,u,'payment',jsonb_build_object('amount',amount,'kind',kind,'rounding',settled-amount,'reason',p_input->>'reason'));
 return payment;
end $$;
revoke all on function private.payroll_post_payment_scoped(jsonb,uuid,uuid,uuid) from public,anon,authenticated;
create or replace function private.payroll_post_tip_batch_scoped(p_input jsonb,a uuid,v uuid,u uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d date:=(p_input->>'date')::date;total numeric:=0;closed numeric:=0;expected numeric;row jsonb;ids uuid[]:='{}';result uuid[]:='{}';
begin

 perform pg_advisory_xact_lock(hashtextextended(v::text,0));
 if not exists(select 1 from public.payroll_source_days where account_id=a and venue_id=v and business_date=d and state='complete') then raise exception 'Источники ещё не проверены';end if;
 if exists(select 1 from public.payroll_attendance where account_id=a and venue_id=v and business_date=d and private.payroll_blocks_salary(status,issue,ends_at)) then raise exception 'Сначала проверьте табель';end if;
 if exists(select 1 from public.payroll_source_days where account_id=a and venue_id=v and business_date=d and (jsonb_array_length(coalesce(source->'cross_boundary_ids','[]'))>0)) then raise exception 'Состав команды требует проверки';end if;
 if exists(select 1 from public.payroll_accruals where account_id=a and venue_id=v and business_date=d and (status not in ('ready','approved') or cardinality(issues)>0)) then raise exception 'Сначала проверьте все начисления дня';end if;
 if exists(select 1 from public.payroll_cashbox where account_id=a and venue_id=v and business_date=d and source_error is not null) then raise exception 'Источник инкассации изменился: требуется сверка';end if;
 if jsonb_typeof(p_input->'payments')<>'array' or jsonb_array_length(p_input->'payments')=0 then raise exception 'Нет инкассаций';end if;
 for row in select * from jsonb_array_elements(p_input->'payments') loop
  if row->>'kind'<>'tips' then raise exception 'Неверный тип операции';end if;
  if (row->>'cashbox_id')::uuid=any(ids) then raise exception 'Повторная инкассация';end if;
  ids:=array_append(ids,(row->>'cashbox_id')::uuid);
  total:=total+(row->>'amount')::numeric;
  closed:=closed+(select coalesce(sum((x->>'settled_amount')::numeric),0) from jsonb_array_elements(row->'allocations') x);
 end loop;
 if exists(select 1 from public.payroll_cashbox where account_id=a and venue_id=v and business_date=d and state in ('review','ready') and not id=any(ids)) then raise exception 'В дневной сверке пропущена инкассация';end if;
 if exists(select 1 from public.payroll_cashbox where id=any(ids) and (account_id<>a or venue_id<>v or business_date<>d)) then raise exception 'Инкассация другого дня';end if;
 select coalesce(sum(tips),0) into expected from public.payroll_accruals where account_id=a and venue_id=v and business_date=d;
 if expected<=0 or closed<>expected then raise exception 'Распределение не закрывает начисленные чаевые';end if;
 if exists(select 1 from public.payroll_cashbox where id=any(ids) and recognition='ambiguous') and length(trim(coalesce(p_input->>'reason','')))<3 then raise exception 'Уточните назначение неоднозначной инкассации и укажите причину';end if;
 if abs(total-expected)>(select tip_tolerance from public.payroll_settings where venue_id=v) and length(trim(coalesce(p_input->>'reason','')))<3 then raise exception 'Подтвердите дневное расхождение';end if;
 for row in select * from jsonb_array_elements(p_input->'payments') loop result:=array_append(result,private.payroll_post_payment_scoped(row,a,v,u));end loop;
 return to_jsonb(result);
end $$;
revoke all on function private.payroll_post_tip_batch_scoped(jsonb,uuid,uuid,uuid) from public,anon,authenticated;
create or replace function public.payroll_auto_tips(p_input jsonb)
returns uuid[] language plpgsql security definer set search_path='' as $$
declare a uuid:=(p_input->>'account_id')::uuid;v uuid:=(p_input->>'venue_id')::uuid;d date:=(p_input->>'date')::date;
 settings public.payroll_settings;row jsonb;cash public.payroll_cashbox;expected numeric;actual numeric;
begin
 perform pg_advisory_xact_lock(hashtextextended(v::text,0));
 select * into settings from public.payroll_settings where account_id=a and venue_id=v and enabled;
 if settings.venue_id is null or settings.tip_category_id is null then return '{}';end if;
 if exists(select 1 from public.payroll_cashbox where venue_id=v and business_date=d and state in ('posted','cancelled')) then return '{}';end if;
 select sum(tips) into expected from public.payroll_accruals where venue_id=v and business_date=d;
 select sum(amount) into actual from public.payroll_cashbox where venue_id=v and business_date=d and state in ('review','ready');
 if exists(select 1 from public.payroll_cashbox where venue_id=v and business_date=d and recognition='ambiguous') then return '{}';end if;
 if expected is null or actual is null or abs(expected-actual)>settings.tip_tolerance then return '{}';end if;
 if exists(select 1 from public.payroll_accruals where venue_id=v and business_date=d and cardinality(issues)>0) or exists(select 1 from public.payroll_attendance where venue_id=v and business_date=d and private.payroll_blocks_salary(status,issue,ends_at)) then return '{}';end if;
 for row in select * from jsonb_array_elements(p_input->'payments') loop
  select * into cash from public.payroll_cashbox where id=(row->>'cashbox_id')::uuid and venue_id=v and business_date=d;
  if cash.id is null or row->>'bank_account_id' is distinct from settings.cashbox_accounts->>cash.kkm_id::text or (row->>'category_id')::uuid is distinct from settings.tip_category_id or coalesce(row->>'reason','')<>'' or row->>'legacy_evidence_id' is not null then raise exception 'Автоматическая выдача не соответствует настройкам';end if;
 end loop;
 return array(select value::uuid from jsonb_array_elements_text(private.payroll_post_tip_batch_scoped(p_input,a,v,null)));
end $$;
revoke all on function public.payroll_auto_tips(jsonb) from public,anon,authenticated;
grant execute on function public.payroll_auto_tips(jsonb) to service_role;




-- Reclassify already imported POS facts without changing salary, tips, or payments.
-- A missing Sheerly schedule is not a missing Quick Resto fact.
update public.payroll_accruals accrual set
 issues=array(select issue from unnest(accrual.issues) issue where issue not in (
  'Фактический выход без опубликованной смены в Sheerly',
  'Несколько подходящих смен в графике',
  'План и факт отличаются более чем на 15 минут',
  'В графике есть выходы без отметки Quick Resto')),
 status=case when not exists(select 1 from unnest(accrual.issues) issue where issue not in (
  'Фактический выход без опубликованной смены в Sheerly',
  'Несколько подходящих смен в графике',
  'План и факт отличаются более чем на 15 минут',
  'В графике есть выходы без отметки Quick Resto')) then 'ready' else 'review' end
where status<>'approved' and exists(select 1 from unnest(accrual.issues) issue where issue in (
  'Фактический выход без опубликованной смены в Sheerly',
  'Несколько подходящих смен в графике',
  'План и факт отличаются более чем на 15 минут',
  'В графике есть выходы без отметки Quick Resto'));
