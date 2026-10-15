BEGIN;

insert into public.permissions(code,description,module) values
 ('payroll.view','Просмотр зарплаты команды','payroll'),
 ('payroll.configure','Настройка оплаты труда','payroll'),
 ('payroll.sync','Загрузка табеля и инкассаций','payroll'),
 ('payroll.review','Проверка табеля и начислений','payroll'),
 ('payroll.approve','Утверждение ведомостей','payroll'),
 ('payroll.pay','Учёт зарплатных выплат','payroll') on conflict(code) do nothing;
insert into public.role_permissions(role_id,permission_id,granted)
select r.id,p.id,true from public.roles r cross join public.permissions p where r.code='owner' and p.module='payroll'
on conflict(role_id,permission_id) do nothing;

create table public.payroll_settings (
 venue_id uuid primary key references public.venues(id),account_id uuid not null references public.accounts(id),
 starts_on date not null check(extract(day from starts_on)=1), quickresto_venue_id bigint not null check(quickresto_venue_id>0),
 tip_comments text[] not null default '{чаевые}',tip_tolerance numeric(15,2) not null default 100 check(tip_tolerance=100),
 cashbox_accounts jsonb not null default '{}',salary_category_id uuid references public.finance_categories(id),tip_category_id uuid references public.finance_categories(id),
 enabled boolean not null default false,updated_at timestamptz not null default now(),
 check(jsonb_typeof(cashbox_accounts)='object'),unique(account_id,venue_id)
);
create table public.payroll_models (
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.accounts(id),venue_id uuid not null references public.venues(id),
 name text not null,role_name text not null,monthly_amount numeric(15,2) not null default 0 check(monthly_amount>=0),quickresto_role_id bigint,basis text not null check(basis in ('turnover','hookah','bar','none')),
 tips boolean not null default false,experience boolean not null default false,
 knowledge_amount numeric(15,2) not null default 0 check(knowledge_amount>=0),food_amount numeric(15,2) not null default 0 check(food_amount>=0),
 cleaner_bonus numeric(15,2) not null default 0 check(cleaner_bonus>=0),archived boolean not null default false,
 unique(account_id,venue_id,id),unique(venue_id,name)
);
create table public.payroll_employees (
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.accounts(id),venue_id uuid not null references public.venues(id),
 quickresto_id bigint,name text not null,local_user_id uuid references public.profiles(id),role_name text not null,
 model_id uuid,hired_on date,experience_offset_months integer not null default 0 check(experience_offset_months>=0),active boolean not null default true,
 opening_balance numeric(15,2) not null default 0,opening_confirmed boolean not null default false,
 unique(account_id,venue_id,id),unique(venue_id,quickresto_id),
 foreign key(account_id,venue_id,model_id) references public.payroll_models(account_id,venue_id,id)
);
create unique index payroll_employee_user on public.payroll_employees(venue_id,local_user_id) where local_user_id is not null;
create table public.payroll_rule_versions (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,model_id uuid not null,
 employee_id uuid,valid_from date not null,rates jsonb not null,experience_steps jsonb not null default '{}',
 created_by uuid references public.profiles(id),created_at timestamptz not null default now(),
 foreign key(account_id,venue_id,model_id) references public.payroll_models(account_id,venue_id,id),
 foreign key(account_id,venue_id,employee_id) references public.payroll_employees(account_id,venue_id,id),
 check(jsonb_typeof(rates)='object' and jsonb_typeof(experience_steps)='object')
);
create unique index payroll_model_version on public.payroll_rule_versions(model_id,valid_from) where employee_id is null;
create unique index payroll_personal_version on public.payroll_rule_versions(employee_id,valid_from) where employee_id is not null;
create table public.payroll_periods (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,month date not null check(extract(day from month)=1),
 status text not null default 'draft' check(status in ('draft','checked','closed')),version integer not null default 1,
 checked_by uuid references public.profiles(id),checked_at timestamptz,closed_by uuid references public.profiles(id),closed_at timestamptz,
 unique(venue_id,month),unique(account_id,venue_id,id),foreign key(account_id,venue_id) references public.payroll_settings(account_id,venue_id)
);
create table public.payroll_source_days (
 venue_id uuid not null,account_id uuid not null,business_date date not null,
 state text not null default 'pending' check(state in ('pending','loading','complete','error')),
 source jsonb not null default '{}',error text,synced_at timestamptz,primary key(venue_id,business_date),
 foreign key(account_id,venue_id) references public.payroll_settings(account_id,venue_id)
);
create table public.payroll_attendance (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,business_date date not null,
 external_id bigint not null,employee_id uuid,starts_at timestamptz not null,ends_at timestamptz,
 shift_id uuid references public.schedule_shifts(id),role_name text not null default '',
 status text not null check(status in ('confirmed','missing','deviation','unplanned','open','unlinked','ignored')),
 issue text,reviewed_by uuid references public.profiles(id),review_reason text,version integer not null default 1,
 unique(account_id,venue_id,external_id),unique(account_id,venue_id,id),
 foreign key(account_id,venue_id,employee_id) references public.payroll_employees(account_id,venue_id,id),
 check(ends_at is null or ends_at>=starts_at)
);
create index payroll_attendance_day on public.payroll_attendance(venue_id,business_date);
create table public.payroll_accruals (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,employee_id uuid not null,business_date date not null,
 period_id uuid not null,rule_version_id uuid references public.payroll_rule_versions(id),
 components jsonb not null default '[]',salary numeric(15,2) not null default 0,tips numeric(15,2) not null default 0,
 status text not null default 'review' check(status in ('review','ready','approved')),issues text[] not null default '{}',
 calculation_snapshot jsonb not null default '{}',updated_at timestamptz not null default now(),
 unique(employee_id,business_date),unique(account_id,venue_id,id),
 foreign key(account_id,venue_id,employee_id) references public.payroll_employees(account_id,venue_id,id),
 foreign key(account_id,venue_id,period_id) references public.payroll_periods(account_id,venue_id,id)
);
create table public.payroll_adjustments (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,employee_id uuid not null,business_date date not null,
 kind text not null check(kind in ('bonus','deduction','knowledge','inventory','experience','food','correction')),
 amount numeric(15,2) not null check(abs(amount)<=1000000000),reason text not null check(length(trim(reason))>=3),source_ref text,
 approved boolean not null default false,created_by uuid references public.profiles(id),approved_by uuid references public.profiles(id),created_at timestamptz not null default now(),
 foreign key(account_id,venue_id,employee_id) references public.payroll_employees(account_id,venue_id,id)
);
create table public.payroll_cashbox (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,business_date date not null,
 external_id bigint not null,amount numeric(15,2) not null check(amount>0),occurred_at timestamptz not null,comment text not null default '',kkm_id bigint not null,
 state text not null default 'review' check(state in ('review','ready','posted','ignored','cancelled')),rounding numeric(15,2) not null default 0,
 unique(account_id,venue_id,external_id),unique(account_id,venue_id,id),foreign key(account_id,venue_id) references public.payroll_settings(account_id,venue_id)
);
create table public.payroll_payments (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,request_key uuid not null,
 transaction_id uuid references public.transactions(id),cashbox_id uuid,
 kind text not null check(kind in ('salary','advance','tips')),amount numeric(15,2) not null check(amount>0),
 occurred_at timestamptz not null, state text not null default 'posted' check(state in ('posted','cancelled')),note text not null default '',created_by uuid references public.profiles(id),created_at timestamptz not null default now(),
 unique(account_id,request_key),unique(transaction_id),unique(cashbox_id),unique(account_id,venue_id,id),
 foreign key(account_id,venue_id,cashbox_id) references public.payroll_cashbox(account_id,venue_id,id)
);
create table public.payroll_allocations (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,payment_id uuid not null,employee_id uuid not null,
 accrual_id uuid,month date not null,amount numeric(15,2) not null check(amount>=0),settled_amount numeric(15,2) not null check(settled_amount>=0),
 foreign key(account_id,venue_id,payment_id) references public.payroll_payments(account_id,venue_id,id),
 foreign key(account_id,venue_id,employee_id) references public.payroll_employees(account_id,venue_id,id),
 foreign key(account_id,venue_id,accrual_id) references public.payroll_accruals(account_id,venue_id,id),
 unique(payment_id,employee_id,month)
);
create table public.payroll_events (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,employee_id uuid,entity_id uuid,action text not null,
 actor_id uuid references public.profiles(id),details jsonb not null default '{}',created_at timestamptz not null default now(),
 foreign key(account_id,venue_id,employee_id) references public.payroll_employees(account_id,venue_id,id)
);

create or replace function private.payroll_read(a uuid,v uuid,e uuid default null)
returns boolean language plpgsql stable security definer set search_path='' set row_security=off as $$
begin
 if a is distinct from public.get_active_account_id() or v is distinct from public.get_active_venue_id() then return false;end if;
 if public.has_permission('payroll.view') then return true;end if;
 if e is null then return false;end if;
 return exists(select 1 from public.payroll_employees employee join public.user_venue_roles membership on membership.user_id=employee.local_user_id and membership.venue_id=employee.venue_id where employee.id=e and employee.account_id=a and employee.venue_id=v and employee.local_user_id=auth.uid() and membership.status='active' and membership.fired_at is null);
end $$;
revoke all on function private.payroll_read(uuid,uuid,uuid) from public;
grant usage on schema private to authenticated,service_role;
grant execute on function private.payroll_read(uuid,uuid,uuid) to authenticated,service_role;

do $$declare t text;begin
 foreach t in array array['payroll_settings','payroll_models','payroll_employees','payroll_rule_versions','payroll_periods','payroll_source_days','payroll_attendance','payroll_accruals','payroll_adjustments','payroll_cashbox','payroll_payments','payroll_allocations','payroll_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
 foreach t in array array['payroll_employees','payroll_attendance','payroll_accruals','payroll_adjustments','payroll_allocations','payroll_events'] loop
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy payroll_read on public.%I for select to authenticated using(private.payroll_read(account_id,venue_id,%s))',t,case when t='payroll_employees' then 'id' else 'employee_id' end);
 end loop;
 foreach t in array array['payroll_settings','payroll_models','payroll_rule_versions','payroll_periods','payroll_cashbox','payroll_payments'] loop
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy payroll_read on public.%I for select to authenticated using(private.payroll_read(account_id,venue_id))',t);
 end loop;
end $$;
-- Private provider snapshots are service-only. Browsers receive summaries from an authorized action.

create or replace function private.payroll_scope(p_permission text)
returns table(a uuid,v uuid,u uuid) language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.has_permission(p_permission) then raise exception 'Нет доступа к зарплате';end if;
 return query select public.get_active_account_id(),public.get_active_venue_id(),auth.uid();
end $$;
revoke all on function private.payroll_scope(text) from public;

create table public.payroll_employee_models (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,employee_id uuid not null,model_id uuid not null,valid_from date not null,
 created_by uuid references public.profiles(id),created_at timestamptz not null default now(),unique(employee_id,valid_from),
 foreign key(account_id,venue_id,employee_id) references public.payroll_employees(account_id,venue_id,id),foreign key(account_id,venue_id,model_id) references public.payroll_models(account_id,venue_id,id)
);
alter table public.payroll_employee_models enable row level security;revoke all on public.payroll_employee_models from anon,authenticated;grant select on public.payroll_employee_models to authenticated;grant all on public.payroll_employee_models to service_role;
create policy payroll_employee_models_read on public.payroll_employee_models for select to authenticated using(private.payroll_read(account_id,venue_id,employee_id));
insert into public.payroll_employee_models(account_id,venue_id,employee_id,model_id,valid_from) select e.account_id,e.venue_id,e.id,e.model_id,s.starts_on from public.payroll_employees e join public.payroll_settings s on s.venue_id=e.venue_id where e.model_id is not null;


create table public.payroll_schedule_reviews (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,shift_id uuid not null unique references public.schedule_shifts(id),employee_id uuid,business_date date not null,
 snapshot jsonb not null,reason text not null check(length(trim(reason))>=3),reviewed_by uuid not null references public.profiles(id),reviewed_at timestamptz not null default now(),
 foreign key(account_id,venue_id) references public.payroll_settings(account_id,venue_id),foreign key(account_id,venue_id,employee_id) references public.payroll_employees(account_id,venue_id,id)
);
create index payroll_schedule_reviews_day on public.payroll_schedule_reviews(venue_id,business_date);
create index payroll_schedule_reviews_employee on public.payroll_schedule_reviews(account_id,venue_id,employee_id);
alter table public.payroll_schedule_reviews enable row level security;
revoke all on public.payroll_schedule_reviews from anon,authenticated;
grant select on public.payroll_schedule_reviews to authenticated;grant all on public.payroll_schedule_reviews to service_role;
create policy payroll_schedule_reviews_read on public.payroll_schedule_reviews for select to authenticated using(private.payroll_read(account_id,venue_id,employee_id));

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
  if p_input->>'status'='checked' then
   if exists(select 1 from generate_series(p.month::timestamp,p.month+interval '1 month'-interval '1 day',interval '1 day') day where not exists(select 1 from public.payroll_source_days d where d.venue_id=v and d.business_date=day::date and d.state='complete')) then raise exception 'Дождитесь загрузки всех дней';end if;
   if (current_timestamp at time zone (select timezone from public.venues where id=v))::date<p.month+interval '1 month' then raise exception 'Расчётный месяц ещё не завершён';end if;
   if p.status<>'draft' then raise exception 'Ведомость уже проверена';end if;
   if exists(select 1 from public.payroll_cashbox where venue_id=v and business_date>=p.month and business_date<p.month+interval '1 month' and source_error is not null) then raise exception 'Изменилась проведённая инкассация: требуется сверка';end if;
   if exists(select 1 from public.payroll_attendance where venue_id=v and business_date>=p.month and business_date<p.month+interval '1 month' and status not in ('confirmed','ignored')) or exists(select 1 from public.payroll_source_days where venue_id=v and business_date>=p.month and business_date<p.month+interval '1 month' and (jsonb_array_length(coalesce(source->'missing_shifts','[]'))>0 or jsonb_array_length(coalesce(source->'cross_boundary_ids','[]'))>0)) then raise exception 'Сначала проверьте табель';end if;
   if exists(select 1 from public.payroll_accruals where period_id=p.id and (status<>'ready' or cardinality(issues)>0)) then raise exception 'Сначала проверьте начисления';end if;
   if exists(select 1 from public.payroll_accruals c where c.period_id=p.id and c.calculation_snapshot->>'financial_day_id' is not null and not exists(select 1 from public.sales_days day where day.id=(c.calculation_snapshot->>'financial_day_id')::uuid and day.account_id=a and day.venue_id=v and day.business_date=c.business_date and day.status='complete' and day.version=(c.calculation_snapshot->>'financial_day_version')::integer)) then raise exception 'Продажи изменились. Обновите расчёт перед проверкой ведомости';end if;
   if not exists(select 1 from public.payroll_accruals where period_id=p.id) then raise exception 'Ведомость пуста';end if;
   if exists(select 1 from public.payroll_employees e where e.venue_id=v and not e.opening_confirmed and exists(select 1 from public.payroll_accruals c where c.period_id=p.id and c.employee_id=e.id)) then raise exception 'Подтвердите начальные остатки';end if;
   if exists(select 1 from public.payroll_adjustments d where d.venue_id=v and date_trunc('month',d.business_date)::date=p.month and not d.approved) then raise exception 'Есть неподтверждённые корректировки';end if;
   update public.payroll_accruals set status='approved' where period_id=p.id;
   update public.payroll_periods set status='checked',checked_at=now(),checked_by=u,version=version+1 where id=p.id;
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





create or replace function private.payroll_transaction_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare p public.payroll_payments;
begin
 select * into p from public.payroll_payments where transaction_id=old.id;
 if p.id is null then if tg_op='DELETE' then return old;else return new;end if;end if;
 if tg_op='DELETE' then raise exception 'Связанную выплату можно только отменить';end if;
 if (to_jsonb(old)-array['deleted_at','deleted_by','updated_at','updated_by'])<>(to_jsonb(new)-array['deleted_at','deleted_by','updated_at','updated_by']) then raise exception 'Отмените выплату и создайте новую, чтобы изменить её реквизиты';end if;
 if old.deleted_at is not null and new.deleted_at is null then raise exception 'Отменённую выплату нельзя восстановить напрямую. Проведите новую выплату';end if;
 if old.deleted_at is distinct from new.deleted_at then
  if auth.uid() is not null and not public.has_permission('payroll.pay') then raise exception 'Нет доступа к отмене выплаты';end if;
  update public.payroll_payments set state=case when new.deleted_at is null then 'posted' else 'cancelled' end where id=p.id;
  if p.cashbox_id is not null then update public.payroll_cashbox set state=case when new.deleted_at is null then 'posted' else 'cancelled' end where id=p.cashbox_id;end if;
  insert into public.payroll_events(account_id,venue_id,entity_id,actor_id,action) values(p.account_id,p.venue_id,p.id,auth.uid(),case when new.deleted_at is null then 'payment_restored' else 'payment_cancelled' end);
 end if;
 return new;
end $$;
revoke all on function private.payroll_transaction_guard() from public;
create trigger payroll_linked_transaction before update or delete on public.transactions for each row execute function private.payroll_transaction_guard();


alter table public.payroll_settings add column benefits_mode text not null default 'review' check(benefits_mode in ('disabled','active','review'));
create or replace function public.payroll_claim_day()
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.payroll_source_days;token uuid:=gen_random_uuid();
begin
 select d.* into r from public.payroll_source_days d join public.payroll_settings s on s.venue_id=d.venue_id join public.sales_settings qr on qr.venue_id=d.venue_id and qr.account_id=d.account_id
 where s.enabled and (qr.provider_retry_at is null or qr.provider_retry_at<=now()) and (d.state='pending' or (d.state='loading' and d.synced_at<now()-interval '5 minutes'))
 order by d.business_date desc,d.venue_id for update of d skip locked limit 1;
 if r.venue_id is null then return null;end if;
 if not pg_try_advisory_xact_lock(hashtextextended(r.venue_id::text,0)) then return null;end if;
 update public.payroll_source_days set state='loading',lease_token=token,synced_at=now() where venue_id=r.venue_id and business_date=r.business_date;
 return jsonb_build_object('account_id',r.account_id,'venue_id',r.venue_id,'date',r.business_date,'lease_token',token);
end $$;
revoke all on function public.payroll_claim_day() from public,anon,authenticated;
grant execute on function public.payroll_claim_day() to service_role;

ALTER TABLE public.payroll_cashbox ADD COLUMN recognition text not null default 'exact' check(recognition in ('exact','ambiguous')),ADD COLUMN source_error text;

create or replace function public.payroll_commit_day(p_input jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare a uuid:=(p_input->>'account_id')::uuid;v uuid:=(p_input->>'venue_id')::uuid;d date:=(p_input->>'date')::date;
 p public.payroll_periods;row jsonb;old public.payroll_attendance;
begin
 perform pg_advisory_xact_lock(hashtextextended(v::text,0));
 if not exists(select 1 from public.payroll_source_days where venue_id=v and business_date=d and state='loading' and lease_token=(p_input->>'lease_token')::uuid) then raise exception 'Задание уже передано другому обработчику';end if;
 if not exists(select 1 from public.payroll_settings where venue_id=v and account_id=a and starts_on<=d) then raise exception 'Недоступный период синхронизации';end if;
 insert into public.payroll_periods(account_id,venue_id,month) values(a,v,date_trunc('month',d)::date) on conflict(venue_id,month) do nothing;
 select * into p from public.payroll_periods where venue_id=v and month=date_trunc('month',d)::date for update;
 if p.status<>'draft' then
  update public.payroll_source_days set state='complete',error='Период проверен: начисления сохранены без изменений',synced_at=now() where venue_id=v and business_date=d;
  return;
 end if;
 update public.payroll_attendance t set status='deviation',issue='Отметка удалена в Quick Resto',reviewed_by=null,review_reason=null,version=version+1 where t.venue_id=v and t.business_date=d and not exists(select 1 from jsonb_array_elements(p_input->'attendance') z where (z->>'external_id')::bigint=t.external_id);
 for row in select * from jsonb_array_elements(p_input->'attendance') loop
  if (row->>'employee_id') is not null and not exists(select 1 from public.payroll_employees where id=(row->>'employee_id')::uuid and account_id=a and venue_id=v) then raise exception 'Сотрудник другого заведения';end if;
  if (row->>'shift_id') is not null and not exists(select 1 from public.schedule_shifts where id=(row->>'shift_id')::uuid and venue_id=v) then raise exception 'Смена другого заведения';end if;
  select * into old from public.payroll_attendance where account_id=a and venue_id=v and external_id=(row->>'external_id')::bigint;
  if old.id is not null and old.business_date<>d then raise exception 'Персональная смена уже отнесена к другому дню';end if;
  insert into public.payroll_attendance(account_id,venue_id,business_date,external_id,employee_id,starts_at,ends_at,shift_id,role_name,status,issue)
   values(a,v,d,(row->>'external_id')::bigint,(row->>'employee_id')::uuid,(row->>'starts_at')::timestamptz,(row->>'ends_at')::timestamptz,(row->>'shift_id')::uuid,row->>'role_name',row->>'status',row->>'issue')
   on conflict(account_id,venue_id,external_id) do update set employee_id=excluded.employee_id,starts_at=excluded.starts_at,ends_at=excluded.ends_at,shift_id=excluded.shift_id,role_name=excluded.role_name,
   status=case when payroll_attendance.reviewed_by is not null and payroll_attendance.starts_at=excluded.starts_at and payroll_attendance.ends_at is not distinct from excluded.ends_at and payroll_attendance.employee_id is not distinct from excluded.employee_id then payroll_attendance.status else excluded.status end,
   issue=excluded.issue,reviewed_by=case when payroll_attendance.starts_at=excluded.starts_at and payroll_attendance.ends_at is not distinct from excluded.ends_at and payroll_attendance.employee_id is not distinct from excluded.employee_id then payroll_attendance.reviewed_by else null end,
   review_reason=case when payroll_attendance.starts_at=excluded.starts_at and payroll_attendance.ends_at is not distinct from excluded.ends_at and payroll_attendance.employee_id is not distinct from excluded.employee_id then payroll_attendance.review_reason else null end,
   version=payroll_attendance.version+case when payroll_attendance.starts_at is distinct from excluded.starts_at or payroll_attendance.ends_at is distinct from excluded.ends_at or payroll_attendance.status is distinct from excluded.status then 1 else 0 end;
 end loop;
 for row in select * from jsonb_array_elements(p_input->'accruals') loop
  if row->'calculation_snapshot'->>'financial_day_id' is not null and not exists(select 1 from public.sales_days day where day.id=(row->'calculation_snapshot'->>'financial_day_id')::uuid and day.account_id=a and day.venue_id=v and day.business_date=d and day.version=(row->'calculation_snapshot'->>'financial_day_version')::integer) then raise exception 'Продажи изменились. Повторите пересчёт зарплаты';end if;
  if not exists(select 1 from public.payroll_employees where id=(row->>'employee_id')::uuid and account_id=a and venue_id=v) then raise exception 'Получатель другого заведения';end if;
  if (row->>'rule_version_id') is not null and not exists(select 1 from public.payroll_rule_versions where id=(row->>'rule_version_id')::uuid and account_id=a and venue_id=v) then raise exception 'Правило другого заведения';end if;
  insert into public.payroll_accruals(account_id,venue_id,employee_id,business_date,period_id,rule_version_id,components,salary,tips,status,issues,calculation_snapshot)
   values(a,v,(row->>'employee_id')::uuid,d,p.id,(row->>'rule_version_id')::uuid,row->'components',(row->>'salary')::numeric,(row->>'tips')::numeric,row->>'status',array(select jsonb_array_elements_text(row->'issues')),row->'calculation_snapshot')
   on conflict(employee_id,business_date) do update set rule_version_id=excluded.rule_version_id,components=excluded.components,salary=excluded.salary,tips=excluded.tips,status=excluded.status,issues=excluded.issues,calculation_snapshot=excluded.calculation_snapshot,updated_at=now()
   where payroll_accruals.status<>'approved' and not exists(select 1 from public.payroll_allocations x join public.payroll_payments y on y.id=x.payment_id where x.accrual_id=payroll_accruals.id and y.state='posted');
 end loop;
 update public.payroll_accruals c set status='review',issues=array_append(c.issues,'Источник изменился после выдачи чаевых: требуется отдельная сверка') where c.venue_id=v and c.business_date=d and exists(select 1 from public.payroll_allocations x join public.payroll_payments y on y.id=x.payment_id where x.accrual_id=c.id and y.state='posted') and exists(select 1 from jsonb_array_elements(p_input->'accruals') z where (z->>'employee_id')::uuid=c.employee_id and ((z->>'salary')::numeric<>c.salary or (z->>'tips')::numeric<>c.tips));
 -- A provider correction may remove a day participation. Never retain a phantom accrual.
 delete from public.payroll_accruals c where c.venue_id=v and c.business_date=d and c.status<>'approved'
 and not exists(select 1 from jsonb_array_elements(p_input->'accruals') entry where (entry->>'employee_id')::uuid=c.employee_id)
 and not exists(select 1 from public.payroll_allocations x where x.accrual_id=c.id);
 update public.payroll_cashbox saved set source_error='Операция изменена или удалена в Quick Resto. Требуется отдельная сверка.' where saved.venue_id=v and saved.business_date=d and saved.state in ('posted','cancelled') and not exists(select 1 from jsonb_array_elements(p_input->'cashbox') incoming where (incoming->>'external_id')::bigint=saved.external_id and (incoming->>'amount')::numeric=saved.amount and incoming->>'comment'=saved.comment and (incoming->>'occurred_at')::timestamptz=saved.occurred_at and (incoming->>'kkm_id')::bigint=saved.kkm_id);
 update public.payroll_cashbox c set state='ignored' where c.venue_id=v and c.business_date=d and c.state in ('ready','review') and not exists(select 1 from jsonb_array_elements(p_input->'cashbox') z where (z->>'external_id')::bigint=c.external_id);
 for row in select * from jsonb_array_elements(p_input->'cashbox') loop
  if exists(select 1 from public.payroll_cashbox saved where saved.account_id=a and saved.venue_id=v and saved.external_id=(row->>'external_id')::bigint and saved.business_date<>d) then raise exception 'Инкассация уже отнесена к другому заведению или дню';end if;
  insert into public.payroll_cashbox(account_id,venue_id,business_date,external_id,amount,occurred_at,comment,kkm_id,recognition)
   values(a,v,d,(row->>'external_id')::bigint,(row->>'amount')::numeric,(row->>'occurred_at')::timestamptz,row->>'comment',(row->>'kkm_id')::bigint,coalesce(row->>'recognition','exact'))
   on conflict(account_id,venue_id,external_id) do update set amount=excluded.amount,comment=excluded.comment,occurred_at=excluded.occurred_at,recognition=excluded.recognition,source_error=null,state=case when payroll_cashbox.state='ignored' then 'review' else payroll_cashbox.state end where payroll_cashbox.state not in ('posted','cancelled');
 end loop;
 update public.payroll_source_days set state='complete',source=p_input->'source',error=null,synced_at=now() where venue_id=v and business_date=d;
end $$;
revoke all on function public.payroll_commit_day(jsonb) from public,anon,authenticated;
grant execute on function public.payroll_commit_day(jsonb) to service_role;


create or replace function public.payroll_post_tip_batch(p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;v uuid;u uuid;
begin
 select s.a,s.v,s.u into a,v,u from private.payroll_scope('payroll.pay') s;
 if not public.has_permission('finance.create_transaction') then raise exception 'Нет доступа к финансовым операциям';end if;
 return private.payroll_post_tip_batch_scoped(p_input,a,v,u);
end $$;
revoke all on function public.payroll_post_tip_batch(jsonb) from public,anon;
grant execute on function public.payroll_post_tip_batch(jsonb) to authenticated;

create or replace function public.payroll_cancel_payment(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare a uuid;v uuid;u uuid;p public.payroll_payments;
begin
 select s.a,s.v,s.u into a,v,u from private.payroll_scope('payroll.pay') s;
 if not public.has_permission('finance.delete_transaction') then raise exception 'Нет доступа к отмене финансовой операции';end if;
 select * into p from public.payroll_payments where id=p_id and account_id=a and venue_id=v for update;
 if p.id is null then raise exception 'Выплата не найдена';end if;
 update public.transactions set deleted_at=now(),deleted_by=u where id=p.transaction_id and account_id=a and deleted_at is null;
end $$;
revoke all on function public.payroll_cancel_payment(uuid) from public,anon;
grant execute on function public.payroll_cancel_payment(uuid) to authenticated;


alter table public.payroll_source_days add column lease_token uuid;
create table public.payroll_qualifications (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,employee_id uuid not null,
 valid_from date not null,valid_until date,knowledge boolean not null default false,experience boolean not null default false,
 reason text not null check(length(trim(reason))>=3),created_by uuid references public.profiles(id),created_at timestamptz not null default now(),
 check(valid_until is null or valid_until>=valid_from),foreign key(account_id,venue_id,employee_id) references public.payroll_employees(account_id,venue_id,id)
);
alter table public.payroll_qualifications enable row level security;
revoke all on public.payroll_qualifications from anon,authenticated;
grant select on public.payroll_qualifications to authenticated;
grant all on public.payroll_qualifications to service_role;
create policy payroll_qualifications_read on public.payroll_qualifications for select to authenticated using(private.payroll_read(account_id,venue_id,employee_id));
create or replace function private.payroll_valid_rates(rates jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare counts record;day record;val numeric;
begin
 if rates is null or jsonb_typeof(rates)<>'object' then return false;end if;
 for counts in select * from jsonb_each(rates) loop
  if counts.key !~ '^[1-9][0-9]?$' or jsonb_typeof(counts.value)<>'object' then return false;end if;
  for day in select * from jsonb_each(counts.value) loop
   if day.key !~ '^[1-7]$' or jsonb_typeof(day.value)<>'object' or not (day.value ? 'base' and day.value ? 'percent') then return false;end if;
   if day.value->>'base' is not null then val:=(day.value->>'base')::numeric;if val<0 or val>1000000 or val<>round(val,2) then return false;end if;end if;
   if day.value->>'percent' is not null then val:=(day.value->>'percent')::numeric;if val<0 or val>100 then return false;end if;end if;
  end loop;
 end loop;return true;
exception when others then return false;
end $$;


alter table public.payroll_rule_versions add column monthly_amount numeric(14,2), add column tenure_requires_exam boolean not null default true;
ALTER TABLE public.payroll_rule_versions ADD COLUMN config jsonb NOT NULL DEFAULT '{}', ADD CHECK(jsonb_typeof(config)='object'), ADD CHECK(monthly_amount IS NULL OR monthly_amount>=0);

update public.payroll_rule_versions set monthly_amount=m.monthly_amount from public.payroll_models m where m.id=payroll_rule_versions.model_id;
insert into public.payroll_rule_versions(account_id,venue_id,model_id,valid_from,rates,experience_steps,monthly_amount)
select m.account_id,m.venue_id,m.id,s.starts_on,'{}','{}',m.monthly_amount from public.payroll_models m join public.payroll_settings s on s.venue_id=m.venue_id where m.monthly_amount>0 and not exists(select 1 from public.payroll_rule_versions r where r.model_id=m.id);


create table public.payroll_legacy_payments (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,employee_id uuid not null,
 month date not null check(date_trunc('month',month)::date=month),occurred_at timestamptz not null,amount numeric(14,2) not null check(amount>0),
 kind text not null check(kind in ('salary','advance')),source_ref text not null,source_bank text not null default '',
 state text not null default 'review' check(state in ('review','posted','ignored')),payment_id uuid references public.payroll_payments(id),
 unique(account_id,source_ref),foreign key(account_id,venue_id,employee_id) references public.payroll_employees(account_id,venue_id,id)
);
alter table public.payroll_legacy_payments enable row level security;
revoke all on public.payroll_legacy_payments from anon,authenticated;grant select on public.payroll_legacy_payments to authenticated;grant all on public.payroll_legacy_payments to service_role;
create policy payroll_legacy_read on public.payroll_legacy_payments for select to authenticated using(private.payroll_read(account_id,venue_id,employee_id));
alter table public.payroll_payments add column input_snapshot jsonb not null default '{}';
alter table public.payroll_payments add column legacy_evidence_id uuid unique references public.payroll_legacy_payments(id);


alter table public.payroll_allocations add column opening_amount numeric(15,2) not null default 0 check(opening_amount>=0 and opening_amount<=settled_amount);
create table public.payroll_payment_accruals (
 payment_id uuid not null,accrual_id uuid not null,account_id uuid not null,venue_id uuid not null,employee_id uuid not null,
 amount numeric(15,2) not null check(amount>0),primary key(payment_id,accrual_id),
 foreign key(account_id,venue_id,payment_id) references public.payroll_payments(account_id,venue_id,id),foreign key(account_id,venue_id,accrual_id) references public.payroll_accruals(account_id,venue_id,id),foreign key(account_id,venue_id,employee_id) references public.payroll_employees(account_id,venue_id,id)
);
alter table public.payroll_payment_accruals enable row level security;revoke all on public.payroll_payment_accruals from anon,authenticated;grant select on public.payroll_payment_accruals to authenticated;grant all on public.payroll_payment_accruals to service_role;
create policy payroll_payment_accruals_read on public.payroll_payment_accruals for select to authenticated using(private.payroll_read(account_id,venue_id,employee_id));
create or replace function private.payroll_link_accruals(pay_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare pay public.payroll_payments;allocation public.payroll_allocations;accrual public.payroll_accruals;leftover numeric;available numeric;opening_left numeric;portion numeric;
begin
 select * into pay from public.payroll_payments where id=pay_id;
 if pay.id is null or pay.state<>'posted' or pay.kind='tips' then return;end if;
 for allocation in select * from public.payroll_allocations where payment_id=pay.id loop
  leftover:=allocation.settled_amount-allocation.opening_amount-coalesce((select sum(l.amount) from public.payroll_payment_accruals l where l.payment_id=pay.id and l.employee_id=allocation.employee_id),0);
  opening_left:=greatest(0,(select case when opening_confirmed then opening_balance else 0 end from public.payroll_employees where id=allocation.employee_id)-coalesce((select sum(x.opening_amount) from public.payroll_allocations x join public.payroll_payments other on other.id=x.payment_id where x.employee_id=allocation.employee_id and other.kind<>'tips' and other.state='posted'),0));
  portion:=least(leftover,opening_left);if portion>0 then update public.payroll_allocations set opening_amount=opening_amount+portion where id=allocation.id;leftover:=leftover-portion;end if;
  for accrual in select * from public.payroll_accruals where employee_id=allocation.employee_id and venue_id=pay.venue_id and status='approved' and salary>0 and business_date<allocation.month+interval '1 month' order by business_date,id loop
   exit when leftover<=0;
   available:=accrual.salary-coalesce((select sum(l.amount) from public.payroll_payment_accruals l join public.payroll_payments other on other.id=l.payment_id where l.accrual_id=accrual.id and other.state='posted'),0);
   portion:=least(leftover,available);if portion<=0 then continue;end if;
   insert into public.payroll_payment_accruals(payment_id,accrual_id,account_id,venue_id,employee_id,amount) values(pay.id,accrual.id,pay.account_id,pay.venue_id,allocation.employee_id,portion) on conflict(payment_id,accrual_id) do update set amount=payroll_payment_accruals.amount+excluded.amount;
   leftover:=leftover-portion;
  end loop;
 end loop;
end $$;
revoke all on function private.payroll_link_accruals(uuid) from public,anon,authenticated;

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
  if kind='salary' and evidence.id is null and not emp.opening_confirmed then raise exception 'Подтвердите начальный остаток сотрудника';end if;
  if kind='salary' and evidence.id is null and not exists(select 1 from public.payroll_periods where venue_id=v and payroll_periods.month=v_month and status in ('checked','closed')) then raise exception 'Сначала проверьте ведомость';end if;
  if kind='salary' and evidence.id is null and (row->>'amount')::numeric>emp.opening_balance+coalesce((select sum(accrued.salary) from public.payroll_accruals accrued where accrued.employee_id=emp.id and accrued.status='approved' and accrued.business_date<v_month+interval '1 month'),0)-coalesce((select sum(x.settled_amount) from public.payroll_allocations x join public.payroll_payments y on y.id=x.payment_id where x.employee_id=emp.id and x.month<=v_month and y.kind<>'tips' and y.state='posted'),0) then raise exception 'Сумма превышает остаток к выплате';end if;
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
 if exists(select 1 from public.payroll_attendance where account_id=a and venue_id=v and business_date=d and status not in ('confirmed','ignored')) then raise exception 'Сначала проверьте табель';end if;
 if exists(select 1 from public.payroll_source_days where account_id=a and venue_id=v and business_date=d and (jsonb_array_length(coalesce(source->'missing_shifts','[]'))>0 or jsonb_array_length(coalesce(source->'cross_boundary_ids','[]'))>0)) then raise exception 'Состав команды требует проверки';end if;
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
 if exists(select 1 from public.payroll_accruals where venue_id=v and business_date=d and cardinality(issues)>0) or exists(select 1 from public.payroll_attendance where venue_id=v and business_date=d and status not in ('confirmed','ignored')) then return '{}';end if;
 for row in select * from jsonb_array_elements(p_input->'payments') loop
  select * into cash from public.payroll_cashbox where id=(row->>'cashbox_id')::uuid and venue_id=v and business_date=d;
  if cash.id is null or row->>'bank_account_id' is distinct from settings.cashbox_accounts->>cash.kkm_id::text or (row->>'category_id')::uuid is distinct from settings.tip_category_id or coalesce(row->>'reason','')<>'' or row->>'legacy_evidence_id' is not null then raise exception 'Автоматическая выдача не соответствует настройкам';end if;
 end loop;
 return array(select value::uuid from jsonb_array_elements_text(private.payroll_post_tip_batch_scoped(p_input,a,v,null)));
end $$;
revoke all on function public.payroll_auto_tips(jsonb) from public,anon,authenticated;
grant execute on function public.payroll_auto_tips(jsonb) to service_role;



create or replace function public.payroll_post_payment(p_input jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid;v uuid;u uuid;
begin
 select s.a,s.v,s.u into a,v,u from private.payroll_scope('payroll.pay') s;
 if not public.has_permission('finance.create_transaction') then raise exception 'Нет доступа к финансовым операциям';end if;
 if p_input->>'kind'='tips' then raise exception 'Используйте общую дневную сверку чаевых';end if;
 return private.payroll_post_payment_scoped(p_input,a,v,u);
end $$;
revoke all on function public.payroll_post_payment(jsonb) from public,anon;
grant execute on function public.payroll_post_payment(jsonb) to authenticated;

ALTER TABLE public.payroll_settings ADD FOREIGN KEY(account_id,venue_id) REFERENCES public.venues(account_id,id);
ALTER TABLE public.payroll_models ADD FOREIGN KEY(account_id,venue_id) REFERENCES public.venues(account_id,id);
ALTER TABLE public.payroll_employees ADD FOREIGN KEY(account_id,venue_id) REFERENCES public.venues(account_id,id);
ALTER TABLE public.payroll_rule_versions ADD UNIQUE(account_id,venue_id,id);
ALTER TABLE public.payroll_accruals ADD FOREIGN KEY(account_id,venue_id,rule_version_id) REFERENCES public.payroll_rule_versions(account_id,venue_id,id);
DO $$ BEGIN
 IF NOT EXISTS(select 1 from pg_constraint where conrelid='public.transactions'::regclass and contype in ('u','p') and conkey=array[(select attnum from pg_attribute where attrelid='public.transactions'::regclass and attname='account_id'),(select attnum from pg_attribute where attrelid='public.transactions'::regclass and attname='id')]::smallint[]) THEN
  ALTER TABLE public.transactions ADD CONSTRAINT transactions_account_id_id_unique_payroll UNIQUE(account_id,id);
 END IF;
END $$;
ALTER TABLE public.payroll_payments ADD FOREIGN KEY(account_id,transaction_id) REFERENCES public.transactions(account_id,id);
ALTER TABLE public.payroll_legacy_payments ADD UNIQUE(account_id,venue_id,id);
ALTER TABLE public.payroll_payments ADD FOREIGN KEY(account_id,venue_id,legacy_evidence_id) REFERENCES public.payroll_legacy_payments(account_id,venue_id,id);
DO $$
DECLARE fk record;columns_sql text;
BEGIN
 FOR fk IN SELECT c.conrelid,c.conname,c.conkey FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname LIKE 'payroll_%' AND c.contype='f' AND array_length(c.conkey,1)>1 LOOP
  SELECT string_agg(quote_ident(a.attname),',' ORDER BY k.position) INTO columns_sql FROM unnest(fk.conkey) WITH ORDINALITY k(attnum,position) JOIN pg_attribute a ON a.attrelid=fk.conrelid AND a.attnum=k.attnum;
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %s (%s)',left(fk.conname,52)||'_lookup',fk.conrelid::regclass,columns_sql);
 END LOOP;
END $$;
CREATE INDEX payroll_attendance_venue_day ON public.payroll_attendance(venue_id,business_date);
CREATE INDEX payroll_accruals_venue_day ON public.payroll_accruals(venue_id,business_date);
CREATE INDEX payroll_adjustments_venue_day ON public.payroll_adjustments(venue_id,business_date);
CREATE INDEX payroll_sources_queue ON public.payroll_source_days(state,business_date);

NOTIFY pgrst, 'reload schema';
COMMIT;
