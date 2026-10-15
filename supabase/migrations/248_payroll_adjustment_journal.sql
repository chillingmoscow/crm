begin;
-- A single journal for salary adjustments, warnings and loyalty operations.
alter table public.payroll_adjustments
 drop constraint payroll_adjustments_kind_check,
 add constraint payroll_adjustments_kind_check check(kind in ('bonus','deduction','warning','knowledge','experience','food','correction','inventory')),
 add column medium text not null default 'money' check(medium in ('money','bonus','none')),
 add column managed boolean not null default false,
 add column deleted_at timestamptz,
 add column deleted_by uuid references public.profiles(id),
 add column delete_reason text,
 add column origin text not null default 'manual',
 add column rule_snapshot jsonb not null default '{}',
 add column external_state text not null default 'not_required' check(external_state in ('not_required','pending','done','review')),
 add column external_ref text,
 add column request_key uuid,
 add constraint payroll_adjustments_scope_unique unique(account_id,venue_id,id),
 add constraint payroll_adjustments_warning_medium check(kind<>'warning' or (medium='none' and amount=0));
create unique index payroll_adjustments_request on public.payroll_adjustments(account_id,request_key) where request_key is not null;
create index payroll_adjustments_employee_month on public.payroll_adjustments(venue_id,employee_id,business_date);

create table public.payroll_adjustment_comments (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,employee_id uuid not null,adjustment_id uuid not null,
 author_id uuid not null references public.profiles(id),body text not null check(length(trim(body)) between 1 and 4000),created_at timestamptz not null default now(),
 request_key uuid not null,unique(author_id,request_key),
 foreign key(account_id,venue_id,adjustment_id) references public.payroll_adjustments(account_id,venue_id,id)
);
create table public.payroll_adjustment_photos (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,employee_id uuid not null,adjustment_id uuid not null,
 storage_path text not null unique,name text not null,uploaded_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 foreign key(account_id,venue_id,adjustment_id) references public.payroll_adjustments(account_id,venue_id,id)
);
create table public.payroll_adjustment_history (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,venue_id uuid not null,employee_id uuid not null,adjustment_id uuid not null,
 actor_id uuid references public.profiles(id),actor_name text not null,action text not null,details jsonb not null default '{}',created_at timestamptz not null default now(),
 foreign key(account_id,venue_id,adjustment_id) references public.payroll_adjustments(account_id,venue_id,id)
);
do $$declare t text;begin
 foreach t in array array['payroll_adjustment_comments','payroll_adjustment_photos','payroll_adjustment_history'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 execute format('create policy payroll_read on public.%I for select to authenticated using(private.payroll_read(account_id,venue_id,employee_id))',t);
 end loop;
end $$;
create index payroll_adjustment_comments_parent on public.payroll_adjustment_comments(adjustment_id,created_at);
create index payroll_adjustment_history_parent on public.payroll_adjustment_history(adjustment_id,created_at);

-- Always overlay the current managed money entries on a worker result. This
-- prevents a worker holding an older snapshot from losing a newly added fine.
create function private.payroll_overlay_adjustments() returns trigger language plpgsql security definer set search_path='' as $$
declare base_components jsonb; live_components jsonb; old_total numeric;live_total numeric;
begin
 if new.status='approved' then return new;end if;
 select coalesce(jsonb_agg(c),'[]'),coalesce(sum((c->>'amount')::numeric) filter(where c->>'source' like 'payroll-entry:%'),0)
 into base_components,old_total from jsonb_array_elements(new.components) c;
 select coalesce(jsonb_agg(c),'[]') into base_components from jsonb_array_elements(base_components) c where coalesce(c->>'source','') not like 'payroll-entry:%';
 select coalesce(jsonb_agg(jsonb_build_object('kind',d.kind,'label',d.reason,'amount',d.amount,'basis',case when d.origin='manual' then 'Ручная запись' else 'Автоматическое правило' end,'source','payroll-entry:'||d.id)), '[]'),coalesce(sum(d.amount),0)
 into live_components,live_total from public.payroll_adjustments d where d.employee_id=new.employee_id and d.venue_id=new.venue_id and d.business_date=new.business_date and d.managed and d.medium='money' and d.deleted_at is null and d.approved;
 new.components:=base_components||live_components;
 new.salary:=new.salary-old_total+live_total;
 return new;
end $$;
revoke all on function private.payroll_overlay_adjustments() from public;
create trigger payroll_live_adjustments before insert or update on public.payroll_accruals for each row execute function private.payroll_overlay_adjustments();

create function private.payroll_adjustment_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare p uuid; actor text;
begin
 if not new.managed then return new;end if;
 select coalesce(nullif(trim(concat_ws(' ',first_name,last_name)),''),'Сотрудник') into actor from public.profiles where id=auth.uid();
 insert into public.payroll_adjustment_history(account_id,venue_id,employee_id,adjustment_id,actor_id,actor_name,action,details)
 values(new.account_id,new.venue_id,new.employee_id,new.id,auth.uid(),coalesce(actor,'Система'),case when tg_op='INSERT' then 'created' when old.deleted_at is null and new.deleted_at is not null then 'deleted' else 'updated' end,
 jsonb_build_object('reason',new.reason,'amount',new.amount,'medium',new.medium,'previous_medium',case when tg_op='UPDATE' then old.medium else null end,'bonus_balance',new.bonus_balance_snapshot,'delete_reason',new.delete_reason));
 if new.medium='money' then
  insert into public.payroll_periods(account_id,venue_id,month) values(new.account_id,new.venue_id,date_trunc('month',new.business_date)::date) on conflict(venue_id,month) do nothing;
  select id into p from public.payroll_periods where venue_id=new.venue_id and month=date_trunc('month',new.business_date)::date;
  insert into public.payroll_accruals(account_id,venue_id,employee_id,business_date,period_id,components,salary,tips,status,issues,calculation_snapshot)
  values(new.account_id,new.venue_id,new.employee_id,new.business_date,p,'[]',0,0,'ready','{}','{"kind":"adjustment"}')
  on conflict(employee_id,business_date) do update set updated_at=now();
 end if;
 return new;
end $$;
revoke all on function private.payroll_adjustment_changed() from public;
create trigger payroll_adjustment_changed after insert or update on public.payroll_adjustments for each row execute function private.payroll_adjustment_changed();

create function public.payroll_journal_command(p_action text,p_input jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid:=public.get_active_account_id();v uuid:=public.get_active_venue_id();u uuid:=auth.uid();r public.payroll_adjustments;e public.payroll_employees;x uuid;d date;k text;m text;amt numeric;actor text;
begin
 if u is null or a is null or v is null then raise exception 'Войдите в аккаунт и выберите заведение';end if;
 perform pg_advisory_xact_lock(hashtextextended(v::text,0));
 if p_action='create' then
  if not public.has_permission('payroll.review') then raise exception 'Нет доступа';end if;
  select * into e from public.payroll_employees where id=(p_input->>'employee_id')::uuid and account_id=a and venue_id=v;
  if e.id is null then raise exception 'Сотрудник не найден';end if;
  d:=(p_input->>'date')::date;k:=p_input->>'kind';m:=case when k='warning' then 'none' else p_input->>'medium' end;amt:=coalesce((p_input->>'amount')::numeric,0);
  if p_input->>'request_key' is null or d is null or k not in ('bonus','deduction','warning') or m not in ('money','bonus','none') or (k<>'warning' and (m='none' or amt<=0 or amt>1000000000)) or length(trim(coalesce(p_input->>'reason','')))<3 then raise exception 'Проверьте дату, сумму и основание';end if;
  if not exists(select 1 from public.payroll_settings where venue_id=v and account_id=a and starts_on<=d) then raise exception 'Дата раньше начала учёта';end if;
  if exists(select 1 from public.payroll_periods where venue_id=v and month=date_trunc('month',d)::date and status<>'draft') then raise exception 'Период зафиксирован. Укажите дату в открытом месяце';end if;
  select * into r from public.payroll_adjustments where account_id=a and request_key=(p_input->>'request_key')::uuid;
  if r.id is not null then
   if r.employee_id<>e.id or r.business_date<>d or r.kind<>k or r.medium<>m or abs(r.amount)<>(case when k='warning' then 0 else round(amt,2) end) or r.reason<>trim(p_input->>'reason') then raise exception 'Повторный запрос содержит другие данные';end if;return r.id;
  end if;
  x:=coalesce((p_input->>'id')::uuid,gen_random_uuid());
  insert into public.payroll_adjustments(id,account_id,venue_id,employee_id,business_date,kind,medium,amount,reason,source_ref,approved,created_by,approved_by,managed,request_key,external_state)
  values(x,a,v,e.id,d,k,m,case when k='warning' then 0 when k='deduction' then -round(amt,2) else round(amt,2) end,trim(p_input->>'reason'),'payroll-entry:'||x,true,u,u,true,(p_input->>'request_key')::uuid,case when m='bonus' then 'pending' else 'not_required' end);
  return x;
 end if;
 select * into r from public.payroll_adjustments where id=(p_input->>'id')::uuid and account_id=a and venue_id=v for update;
 if r.id is null or not private.payroll_read(a,v,r.employee_id) then raise exception 'Запись недоступна';end if;
 select coalesce(nullif(trim(concat_ws(' ',first_name,last_name)),''),'Сотрудник') into actor from public.profiles where id=u;
 if p_action='delete' then
  if not public.has_permission('payroll.review') then raise exception 'Нет доступа к удалению этой записи';end if;
  if r.deleted_at is not null then return r.id;end if;
  if length(trim(coalesce(p_input->>'reason','')))<3 then raise exception 'Укажите причину удаления';end if;
  if exists(select 1 from public.payroll_periods where venue_id=v and month=date_trunc('month',r.business_date)::date and status<>'draft') then raise exception 'Период зафиксирован';end if;
  if r.medium='bonus' and r.external_state='done' then raise exception 'Сначала оформите обратную бонусную операцию';end if;
  if not r.managed then
   if r.source_ref is null then raise exception 'Не удалось связать прежнюю запись с расчётом';end if;
   -- Adopt the stable component identity before reversing an imported entry.
   -- The overlay removes this component; no worker or external source is needed.
   update public.payroll_accruals c set components=(select jsonb_agg(case when part->>'source'=r.source_ref then jsonb_set(part,'{source}',to_jsonb('payroll-entry:'||r.id)) else part end) from jsonb_array_elements(c.components) part)
   where c.employee_id=r.employee_id and c.venue_id=v and c.business_date=r.business_date and exists(select 1 from jsonb_array_elements(c.components) part where part->>'source'=r.source_ref);
  end if;
  update public.payroll_adjustments set managed=true,deleted_at=now(),deleted_by=u,delete_reason=trim(p_input->>'reason') where id=r.id;return r.id;
 elsif p_action='comment' then
  if r.deleted_at is not null then raise exception 'Запись удалена';end if;
  if length(trim(coalesce(p_input->>'body',''))) not between 1 and 4000 then raise exception 'Введите комментарий до 4000 символов';end if;
  insert into public.payroll_adjustment_comments(account_id,venue_id,employee_id,adjustment_id,author_id,body,request_key)
  values(a,v,r.employee_id,r.id,u,trim(p_input->>'body'),(p_input->>'request_key')::uuid) on conflict(author_id,request_key) do nothing returning id into x;
  if x is null then return r.id;end if;
  insert into public.payroll_adjustment_history(account_id,venue_id,employee_id,adjustment_id,actor_id,actor_name,action,details) values(a,v,r.employee_id,r.id,u,actor,'commented',jsonb_build_object('comment_id',x));
  insert into public.notifications(user_id,venue_id,type,category,title,body,link,actor_user_id,entity_type,entity_id,payload)
  select distinct recipient,v,'staff.payroll_comment','staff',actor||': комментарий к '||case r.kind when 'warning' then 'предупреждению' when 'bonus' then 'премии' when 'deduction' then 'штрафу' else 'записи' end,left(p_input->>'body',180),'/payroll-concept?entry='||r.id||'&month='||to_char(r.business_date,'YYYY-MM'),u,'payroll_adjustment',r.id,jsonb_build_object('preview',left(p_input->>'body',180),'preview_kind','comment_text')
  from (
   select r.created_by recipient union select local_user_id from public.payroll_employees where id=r.employee_id union select author_id from public.payroll_adjustment_comments where adjustment_id=r.id
  ) recipients where recipient is not null and recipient<>u
  and exists(select 1 from public.user_venue_roles membership where membership.user_id=recipient and membership.venue_id=v and membership.status='active' and membership.fired_at is null)
  and (recipient=(select local_user_id from public.payroll_employees where id=r.employee_id) or exists(select 1 from public.user_venue_roles mr join public.role_permissions rp on rp.role_id=mr.role_id join public.permissions perm on perm.id=rp.permission_id where mr.user_id=recipient and mr.venue_id=v and rp.granted and perm.code='payroll.view'));
  return x;
 elsif p_action='photo' then
  if not public.has_permission('payroll.review') or r.deleted_at is not null then raise exception 'Нет доступа';end if;
  if p_input->>'path' not like a::text||'/'||v::text||'/'||r.id::text||'/%' then raise exception 'Фотография другого заведения';end if;
  if not exists(select 1 from storage.objects where bucket_id='payroll-photos' and name=p_input->>'path') then raise exception 'Фотография не загружена';end if;
  insert into public.payroll_adjustment_photos(account_id,venue_id,employee_id,adjustment_id,storage_path,name,uploaded_by) values(a,v,r.employee_id,r.id,p_input->>'path',left(p_input->>'name',120),u) returning id into x;
  insert into public.payroll_adjustment_history(account_id,venue_id,employee_id,adjustment_id,actor_id,actor_name,action) values(a,v,r.employee_id,r.id,u,actor,'photo_added');return x;
 end if;
 raise exception 'Неизвестное действие';
end $$;
revoke all on function public.payroll_journal_command(text,jsonb) from public,anon;
grant execute on function public.payroll_journal_command(text,jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('payroll-photos','payroll-photos',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy payroll_photo_read on storage.objects for select to authenticated using(bucket_id='payroll-photos' and exists(select 1 from public.payroll_adjustment_photos p where p.storage_path=name and private.payroll_read(p.account_id,p.venue_id,p.employee_id)));
create policy payroll_photo_upload on storage.objects for insert to authenticated with check(bucket_id='payroll-photos' and public.has_permission('payroll.review') and exists(select 1 from public.payroll_adjustments d where d.account_id::text=(storage.foldername(name))[1] and d.venue_id::text=(storage.foldername(name))[2] and d.id::text=(storage.foldername(name))[3] and d.deleted_at is null and private.payroll_read(d.account_id,d.venue_id,d.employee_id)));

-- Rules are owned by Sheerly. The legacy integration can read these through
-- authenticated REST with payroll.configure; there is no public settings feed.
create table public.payroll_discipline_settings (
 venue_id uuid primary key references public.venues(id),account_id uuid not null references public.accounts(id),
 enabled boolean not null default true,valid_from date not null default current_date,
 warning_steps jsonb not null default '[{"count":5,"amount":500},{"count":10,"amount":2500},{"count":15,"amount":7500},{"count":20,"amount":15000}]',
 late_enabled boolean not null default true,late_grace integer not null default 5 check(late_grace between 0 and 120),
 late_step integer not null default 5 check(late_step between 1 and 120),late_amount numeric not null default 400 check(late_amount between 0 and 1000000),late_max numeric not null default 5000 check(late_max between 0 and 1000000),
 late_bonus boolean not null default true,
 missing_enabled boolean not null default true,missing_amount numeric not null default 3000 check(missing_amount between 0 and 1000000),
 unclosed_enabled boolean not null default true,unclosed_amount numeric not null default 300 check(unclosed_amount between 0 and 1000000),
 bonus_mode text not null default 'parallel' check(bonus_mode='parallel'),
 version integer not null default 1,updated_at timestamptz not null default now(),updated_by uuid references public.profiles(id)
);
alter table public.payroll_discipline_settings enable row level security;
revoke all on public.payroll_discipline_settings from public,anon,authenticated;
grant select on public.payroll_discipline_settings to authenticated;
grant all on public.payroll_discipline_settings to service_role;
create policy payroll_discipline_read on public.payroll_discipline_settings for select to authenticated using(private.payroll_read(account_id,venue_id));
insert into public.payroll_discipline_settings(account_id,venue_id,valid_from) select account_id,venue_id,(now() at time zone coalesce((select timezone from public.venues where id=venue_id),'Europe/Moscow'))::date from public.payroll_settings;
alter table public.payroll_adjustments add column automation_key text;
create unique index payroll_adjustment_automation on public.payroll_adjustments(venue_id,automation_key) where automation_key is not null;

create function public.payroll_save_discipline(p_input jsonb) returns void language plpgsql security definer set search_path='' as $$
declare a uuid:=public.get_active_account_id();v uuid:=public.get_active_venue_id();old public.payroll_discipline_settings;step jsonb;prev integer:=0;
begin
 if auth.uid() is null or a is null or v is null or not public.has_permission('payroll.configure') then raise exception 'Нет доступа';end if;
 select * into old from public.payroll_discipline_settings where account_id=a and venue_id=v for update;
 if old.version<>(p_input->>'version')::integer or old.version is null then raise exception 'Настройки изменились. Обновите страницу';end if;
 if jsonb_typeof(p_input->'warning_steps')<>'array' or jsonb_array_length(p_input->'warning_steps')>20 then raise exception 'Проверьте шкалу предупреждений';end if;
 for step in select * from jsonb_array_elements(p_input->'warning_steps') loop
 if (step->>'count')::integer<=prev or (step->>'count')::integer>1000 or (step->>'amount')::numeric<=0 or (step->>'amount')::numeric>1000000 then raise exception 'Пороги должны возрастать, суммы — быть положительными';end if;prev:=(step->>'count')::integer;
 end loop;
 update public.payroll_discipline_settings set enabled=(p_input->>'enabled')::boolean,warning_steps=p_input->'warning_steps',late_enabled=(p_input->>'late_enabled')::boolean,late_grace=(p_input->>'late_grace')::integer,late_step=(p_input->>'late_step')::integer,late_amount=(p_input->>'late_amount')::numeric,late_max=(p_input->>'late_max')::numeric,late_bonus=(p_input->>'late_bonus')::boolean,missing_enabled=(p_input->>'missing_enabled')::boolean,missing_amount=(p_input->>'missing_amount')::numeric,unclosed_enabled=(p_input->>'unclosed_enabled')::boolean,unclosed_amount=(p_input->>'unclosed_amount')::numeric,version=version+1,updated_at=now(),updated_by=auth.uid() where venue_id=v;
 insert into public.payroll_events(account_id,venue_id,entity_id,action,actor_id,details) values(a,v,v,'discipline_settings',auth.uid(),jsonb_build_object('before',to_jsonb(old),'after',p_input));
end $$;
revoke all on function public.payroll_save_discipline(jsonb) from public,anon;
grant execute on function public.payroll_save_discipline(jsonb) to authenticated;

create function private.payroll_warning_thresholds() returns trigger language plpgsql security definer set search_path='' as $$
declare s public.payroll_discipline_settings;n integer;step jsonb;m date:=date_trunc('month',new.business_date)::date;
begin
 if new.kind<>'warning' or new.deleted_at is not null then return new;end if;
 select * into s from public.payroll_discipline_settings where venue_id=new.venue_id and account_id=new.account_id;
 if not s.enabled then return new;end if;
 -- Same employee/venue lock serializes simultaneous manual and automatic warnings.
 perform pg_advisory_xact_lock(hashtextextended(new.venue_id::text,0));
 select count(*) into n from public.payroll_adjustments where venue_id=new.venue_id and employee_id=new.employee_id and kind='warning' and deleted_at is null and business_date>=m and business_date<m+interval '1 month';
 for step in select * from jsonb_array_elements(s.warning_steps) loop
  if n=(step->>'count')::integer then
   insert into public.payroll_adjustments(account_id,venue_id,employee_id,business_date,kind,amount,reason,approved,managed,origin,automation_key,source_ref)
   values(new.account_id,new.venue_id,new.employee_id,new.business_date,'deduction',-(step->>'amount')::numeric,'Накоплено предупреждений: '||n,true,true,'warning_threshold',new.employee_id||':'||m||':warnings:'||n,'threshold') on conflict(venue_id,automation_key) where automation_key is not null do nothing;
  end if;
 end loop;
 return new;
end $$;
revoke all on function private.payroll_warning_thresholds() from public;
create trigger payroll_warning_thresholds after insert on public.payroll_adjustments for each row execute function private.payroll_warning_thresholds();

-- Source-day completion is the only automatic entry point. Missing provider
-- data never becomes absence; unpublished or unlinked plans are not evidence.
create function private.payroll_generate_discipline() returns trigger language plpgsql security definer set search_path='' as $$
declare s public.payroll_discipline_settings;r record;entry_kind text;entry_medium text;entry_amount numeric;entry_reason text;entry_key text;late_minutes integer;previous integer;
begin
 if new.state<>'complete' then return new;end if;
 select * into s from public.payroll_discipline_settings where venue_id=new.venue_id and account_id=new.account_id;
 if not s.enabled or s.venue_id is null or new.business_date<s.valid_from or new.business_date>=(now() at time zone (select timezone from public.venues where id=new.venue_id))::date then return new;end if;
 if exists(select 1 from public.payroll_periods where venue_id=new.venue_id and month=date_trunc('month',new.business_date)::date and status<>'draft') then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended(new.venue_id::text,0));
 for r in
 select e.id employee_id,p.id shift_id,p.starts_at,p.ends_at,actual.starts_at actual_start,actual.ends_at actual_end,actual.id attendance_id,actual.status,
 (select count(*) from public.schedule_shifts other where other.venue_id=p.venue_id and other.user_id=p.user_id and other.published and other.starts_at<actual.ends_at and other.ends_at>actual.starts_at) matches
 from public.schedule_shifts p join public.payroll_employees e on e.local_user_id=p.user_id and e.venue_id=p.venue_id and e.active
 left join lateral(select t.* from public.payroll_attendance t where t.venue_id=p.venue_id and t.employee_id=e.id and t.business_date=new.business_date and t.shift_id=p.id and t.status<>'ignored' order by t.starts_at limit 1) actual on true
 where p.venue_id=new.venue_id and p.published and p.user_id is not null and p.ends_at<now() and ((p.starts_at at time zone (select timezone from public.venues where id=p.venue_id))-make_interval(hours=>(select day_start_hour from public.sales_settings where venue_id=p.venue_id)))::date=new.business_date
 loop
  entry_kind:=null;entry_medium:='money';entry_amount:=0;entry_key:=r.shift_id||':attendance';
  if r.attendance_id is null and s.missing_enabled and not exists(select 1 from public.payroll_attendance t where t.venue_id=new.venue_id and t.employee_id=r.employee_id and t.business_date=new.business_date) then
   select count(*) into previous from public.payroll_adjustments where venue_id=new.venue_id and employee_id=r.employee_id and origin='missing_clockin' and deleted_at is null and business_date>=date_trunc('month',new.business_date)::date and business_date<date_trunc('month',new.business_date)::date+interval '1 month';
   entry_kind:=case when previous=0 then 'warning' else 'deduction' end;entry_medium:=case when previous=0 then 'none' else 'money' end;entry_amount:=case when previous=0 then 0 else -s.missing_amount end;entry_reason:='Нет отметки о смене Quick Resto';
   insert into public.payroll_adjustments(account_id,venue_id,employee_id,business_date,kind,medium,amount,reason,approved,managed,origin,automation_key)
   values(new.account_id,new.venue_id,r.employee_id,new.business_date,entry_kind,entry_medium,entry_amount,entry_reason,true,true,'missing_clockin',entry_key) on conflict(venue_id,automation_key) where automation_key is not null do nothing;
  elsif r.actual_end is not null and r.matches=1 and s.late_enabled and r.status not in ('unlinked','open','missing') then
   late_minutes:=round(extract(epoch from (r.actual_start-r.starts_at))/60);
   if late_minutes>0 then
    entry_kind:=case when late_minutes<=s.late_grace then 'warning' else 'deduction' end;
    entry_medium:=case when entry_kind='warning' then 'none' when s.late_bonus then 'bonus' else 'money' end;
    entry_amount:=case when entry_kind='warning' then 0 else -least(ceil(late_minutes::numeric/s.late_step)*s.late_amount,s.late_max) end;
    insert into public.payroll_adjustments(account_id,venue_id,employee_id,business_date,kind,medium,amount,reason,approved,managed,origin,automation_key,external_state)
    values(new.account_id,new.venue_id,r.employee_id,new.business_date,entry_kind,entry_medium,entry_amount,'Опоздание на '||late_minutes||' мин.',true,true,'lateness',r.shift_id||':lateness',case when entry_medium='bonus' then 'review' else 'not_required' end) on conflict(venue_id,automation_key) where automation_key is not null do nothing;
   end if;
  end if;
  if r.attendance_id is not null and s.unclosed_enabled and (r.actual_end is null or r.actual_end-r.actual_start>interval '24 hours') and r.actual_start<now()-interval '24 hours' then
   insert into public.payroll_adjustments(account_id,venue_id,employee_id,business_date,kind,amount,reason,approved,managed,origin,automation_key)
   values(new.account_id,new.venue_id,r.employee_id,new.business_date,'deduction',-s.unclosed_amount,'Не закрыта персональная смена',true,true,'unclosed_shift',r.attendance_id||':unclosed') on conflict(venue_id,automation_key) where automation_key is not null do nothing;
  end if;
 end loop;
 return new;
end $$;
revoke all on function private.payroll_generate_discipline() from public;
create trigger payroll_generate_discipline after update of state on public.payroll_source_days for each row execute function private.payroll_generate_discipline();

create function private.payroll_entry_source() returns trigger language plpgsql set search_path='' as $$
begin
 if new.managed then
  new.source_ref:='payroll-entry:'||new.id;
  if new.origin<>'manual' and new.rule_snapshot='{}'::jsonb then
   select to_jsonb(s) into new.rule_snapshot from public.payroll_discipline_settings s where s.venue_id=new.venue_id;
   new.rule_snapshot:=coalesce(new.rule_snapshot,'{}');
  end if;
 end if;return new;end $$;
revoke all on function private.payroll_entry_source() from public;
create trigger payroll_entry_source before insert or update on public.payroll_adjustments for each row execute function private.payroll_entry_source();

alter table public.payroll_employees add column quickresto_guest_id bigint,add column quickresto_bonus_account_id bigint;
alter table public.payroll_adjustments add column bonus_balance_snapshot numeric,add column bonus_checked_at timestamptz;
create function public.payroll_resolve_bonus(p_id uuid,p_balance numeric,p_guest bigint,p_account bigint) returns void language plpgsql security definer set search_path='' as $$
declare r public.payroll_adjustments;e public.payroll_employees;
begin
 select * into r from public.payroll_adjustments where id=p_id;
 if r.id is null then return;end if;
 perform pg_advisory_xact_lock(hashtextextended(r.venue_id::text,0));
 select * into r from public.payroll_adjustments where id=p_id for update;
 if r.id is null or r.origin<>'lateness' or r.medium<>'bonus' or r.external_state<>'review' or r.deleted_at is not null then return;end if;
 if p_balance is null then raise exception 'Баланс не подтверждён';end if;
 select * into e from public.payroll_employees where id=r.employee_id;
 if e.quickresto_guest_id is distinct from p_guest or e.quickresto_bonus_account_id is distinct from p_account then raise exception 'Бонусный счёт изменился';end if;
 -- Full bonus amount or full money amount. No partial splitting and no provider write.
 update public.payroll_adjustments set medium=case when p_balance>=abs(amount) then 'bonus' else 'money' end,
 external_state=case when p_balance>=abs(amount) then 'pending' else 'not_required' end,
 bonus_balance_snapshot=p_balance,bonus_checked_at=now() where id=r.id;
end $$;
revoke all on function public.payroll_resolve_bonus(uuid,numeric,bigint,bigint) from public,anon,authenticated;
grant execute on function public.payroll_resolve_bonus(uuid,numeric,bigint,bigint) to service_role;

commit;
