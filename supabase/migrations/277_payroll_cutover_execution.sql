begin;
-- Cutover is explicit per venue. Installing this migration never enables a writer.
create table public.payroll_execution_policy (
 venue_id uuid primary key references public.venues(id), account_id uuid not null references public.accounts(id),
 salary_from date, bonus_from date, legacy_stopped boolean not null default false,
 version integer not null default 1, activated_at timestamptz, updated_at timestamptz not null default now(), updated_by uuid references public.profiles(id),
 check((salary_from is null and bonus_from is null) or legacy_stopped)
);
create table public.payroll_bonus_operations (
 id uuid primary key default gen_random_uuid(), account_id uuid not null,venue_id uuid not null,employee_id uuid not null,adjustment_id uuid not null,
 operation text not null check(operation in ('apply','reverse')), reverses_id uuid references public.payroll_bonus_operations(id),
 guest_id bigint not null check(guest_id>0),bonus_account_id bigint not null check(bonus_account_id>0),
 direction text not null check(direction in ('credit','debit')), amount numeric(15,2) not null check(amount>0),
 state text not null default 'pending' check(state in ('pending','reading','sending','done','review','cancelled','money')),
 policy_version integer not null,lease_token uuid, claimed_at timestamptz, before_balance numeric,after_balance numeric,provider_reference text, message text,
 created_at timestamptz not null default now(), finished_at timestamptz,
 unique(adjustment_id,operation),unique(reverses_id),
 foreign key(account_id,venue_id,adjustment_id) references public.payroll_adjustments(account_id,venue_id,id),
 foreign key(account_id,venue_id,employee_id) references public.payroll_employees(account_id,venue_id,id),
 check((operation='reverse')=(reverses_id is not null))
);
create index payroll_bonus_operations_claim on public.payroll_bonus_operations(state,created_at);
do $$ declare t text;begin
 foreach t in array array['payroll_execution_policy','payroll_bonus_operations'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('create policy payroll_execution_read on public.%I for select to authenticated using(account_id=public.get_active_account_id() and venue_id=public.get_active_venue_id() and public.has_permission(''payroll.configure''))',t);
 end loop;
end $$;
create function public.payroll_set_execution_policy(p_version integer,p_salary_from date,p_bonus_from date,p_legacy_stopped boolean) returns void
language plpgsql security definer set search_path='' as $$
declare a uuid;v uuid;u uuid;old_row public.payroll_execution_policy;today date;
begin
 select s.a,s.v,s.u into a,v,u from private.payroll_scope('payroll.configure') s;
 if not public.has_permission('payroll.review') then raise exception 'Нет доступа';end if;
 perform pg_advisory_xact_lock(hashtextextended('payroll-automation:'||v,0));
 select * into old_row from public.payroll_execution_policy where venue_id=v for update;
 if p_version is distinct from coalesce(old_row.version,0) then raise exception 'Режим изменился. Обновите страницу';end if;
 today:=(now() at time zone coalesce((select timezone from public.venues where id=v),'Europe/Moscow'))::date;
 if (p_salary_from is not null or p_bonus_from is not null) and p_legacy_stopped is distinct from true then raise exception 'Сначала остановите прежние обработчики и подтвердите сверку';end if;
 if (p_salary_from is not null and (p_salary_from<today or p_salary_from>today+31)) or (p_bonus_from is not null and (p_bonus_from<today or p_bonus_from>today+31)) then raise exception 'Начать можно с сегодняшней даты или позднее';end if;
 if (p_salary_from is not null or p_bonus_from is not null) and not exists(select 1 from public.payroll_automation_settings where venue_id=v and version>0) then raise exception 'Сначала сохраните правила';end if;
 if exists(select 1 from public.payroll_bonus_operations where venue_id=v and state in ('reading','sending')) then raise exception 'Дождитесь завершения бонусной операции';end if;
 insert into public.payroll_execution_policy(venue_id,account_id,salary_from,bonus_from,legacy_stopped,version,activated_at,updated_by)
 values(v,a,p_salary_from,p_bonus_from,coalesce(p_legacy_stopped,false),coalesce(old_row.version,0)+1,now(),u)
 on conflict(venue_id) do update set salary_from=excluded.salary_from,bonus_from=excluded.bonus_from,legacy_stopped=excluded.legacy_stopped,version=excluded.version,activated_at=excluded.activated_at,updated_at=now(),updated_by=u;
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details)
 values(a,v,u,'payroll.execution.updated','payroll_execution',v,jsonb_build_object('before',to_jsonb(old_row),'salary_from',p_salary_from,'bonus_from',p_bonus_from,'legacy_stopped',p_legacy_stopped));
end $$;
revoke all on function public.payroll_set_execution_policy(integer,date,date,boolean) from public,anon;
grant execute on function public.payroll_set_execution_policy(integer,date,date,boolean) to authenticated;

-- Policy participates in fingerprints. Changing a cutover date invalidates old previews.
alter function public.payroll_automation_snapshot(uuid) rename to payroll_automation_source_snapshot;
revoke all on function public.payroll_automation_source_snapshot(uuid) from public,anon,authenticated;
create function public.payroll_automation_snapshot(p_venue uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select public.payroll_automation_source_snapshot(p_venue)||jsonb_build_object('execution',(select to_jsonb(p) from public.payroll_execution_policy p where p.venue_id=p_venue));
$$;
revoke all on function public.payroll_automation_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.payroll_automation_snapshot(uuid) to service_role;

alter function public.payroll_commit_automation_run(uuid,date,jsonb,jsonb,text,uuid,uuid) rename to payroll_commit_automation_source_run;
revoke all on function public.payroll_commit_automation_source_run(uuid,date,jsonb,jsonb,text,uuid,uuid) from public,anon,authenticated,service_role;
create function public.payroll_commit_automation_run(p_venue uuid,p_date date,p_snapshot jsonb,p_plan jsonb,p_mode text,p_actor uuid default null,p_preview uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare run uuid;policy public.payroll_execution_policy;d jsonb;e public.payroll_employees;effect text;
begin
 perform pg_advisory_xact_lock(hashtextextended('payroll-automation:'||p_venue,0));
 select * into policy from public.payroll_execution_policy where venue_id=p_venue;
 if p_mode='native' and (policy.salary_from is null or p_date<policy.salary_from or not policy.legacy_stopped) then raise exception 'Включён режим сравнения. Прежняя автоматика ещё не передана Sheerly';end if;
 -- Tasks are deferred, gifts remain in Notion/n8n. Neither may reach salary here.
 if p_mode='native' and exists(select 1 from jsonb_array_elements(p_plan->'decisions') r where r->>'rule' in ('task','holiday','tenure')) then raise exception 'Задачи и подарки пока не перенесены';end if;
 run:=public.payroll_commit_automation_source_run(p_venue,p_date,p_snapshot,p_plan,p_mode,p_actor,p_preview);
 if p_mode='native' then
  for d in select value from jsonb_array_elements(p_plan->'decisions') loop
   if d->>'rule'<>'medical_reminder' or d->>'kind'<>'notification' or exists(select 1 from jsonb_array_elements(p_plan->'blockers') b where b->>'employeeId'=d->>'employeeId') then continue;end if;
   effect:=d->>'key';
   if exists(select 1 from public.payroll_automation_effects where event_key=effect) then continue;end if;
   select * into e from public.payroll_employees where id=(d->>'employeeId')::uuid and venue_id=p_venue;
   insert into public.notifications(user_id,venue_id,type,category,title,body,link,entity_type,entity_id,payload)
   select distinct recipient,p_venue,'staff.medical_reminder','staff','Медицинская книжка · '||e.name,d->>'reason',case when recipient=e.local_user_id then '/profile' else '/people/automations' end,'payroll_automation_person',e.id,jsonb_build_object('event_key',effect)
   from (select e.local_user_id recipient union select p.user_id from public.user_venue_roles p join public.role_permissions rp on rp.role_id=p.role_id join public.permissions perm on perm.id=rp.permission_id where p.venue_id=p_venue and p.status='active' and p.fired_at is null and rp.granted and perm.code='payroll.configure') recipients
   where recipient is not null and exists(select 1 from public.user_venue_roles m where m.user_id=recipient and m.venue_id=p_venue and m.status='active' and m.fired_at is null);
   insert into public.payroll_automation_effects(event_key,account_id,venue_id,employee_id,decision,state,created_by) values(effect,e.account_id,p_venue,e.id,d,'applied',p_actor);
  end loop;
 end if;
 return run;
end $$;
revoke all on function public.payroll_commit_automation_run(uuid,date,jsonb,jsonb,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.payroll_commit_automation_run(uuid,date,jsonb,jsonb,text,uuid,uuid) to service_role;

-- Comparison + optional native commit and lease completion are one transaction.
create or replace function public.payroll_commit_scheduled_automation(p_job uuid,p_lease uuid,p_snapshot jsonb,p_plan jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare job public.payroll_automation_jobs;result uuid;live jsonb;policy public.payroll_execution_policy;
begin
 select * into job from public.payroll_automation_jobs where id=p_job for update;
 if job.id is null or p_lease is distinct from job.lease_token then raise exception 'Запуск уже передан другому обработчику';end if;
 if job.state='done' then return job.run_id;end if;
 if job.state<>'running' then raise exception 'Запуск недоступен';end if;
 perform pg_advisory_xact_lock(hashtextextended('payroll-automation:'||job.venue_id,0));
 live:=public.payroll_automation_snapshot(job.venue_id);
 if md5(live::text) is distinct from job.fingerprint or p_snapshot is distinct from live then
  update public.payroll_automation_jobs set state='superseded',finished_at=now() where id=job.id;return null;
 end if;
 result:=public.payroll_commit_automation_run(job.venue_id,job.business_date,p_snapshot,p_plan,'comparison');
 select * into policy from public.payroll_execution_policy where venue_id=job.venue_id;
 if policy.legacy_stopped and job.business_date>=policy.salary_from then
  result:=public.payroll_commit_automation_run(job.venue_id,job.business_date,p_snapshot,p_plan,'native',null,result);
 end if;
 update public.payroll_automation_jobs set state='done',run_id=result,finished_at=now(),last_error=null where id=job.id;
 return result;
end $$;

-- Only future, newly created native/manual entries belong to this writer.
-- Existing imported bonus rows cannot be accidentally replayed at cutover.
create function public.payroll_prepare_bonus_operations() returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 update public.payroll_bonus_operations o set state='review',message='Режим работы изменён. Подтвердите обработку этой прежней операции отдельно.' from public.payroll_execution_policy p where p.venue_id=o.venue_id and o.policy_version<>p.version and o.state='pending';
 insert into public.payroll_bonus_operations(account_id,venue_id,employee_id,adjustment_id,operation,guest_id,bonus_account_id,direction,amount,policy_version)
 select r.account_id,r.venue_id,r.employee_id,r.id,'apply',e.quickresto_guest_id,e.quickresto_bonus_account_id,case when r.amount>0 then 'credit' else 'debit' end,abs(r.amount),p.version
 from public.payroll_adjustments r join public.payroll_employees e on e.id=r.employee_id and e.venue_id=r.venue_id and e.account_id=r.account_id
 join public.payroll_execution_policy p on p.venue_id=r.venue_id and p.account_id=r.account_id
 where p.legacy_stopped and p.bonus_from is not null and r.business_date>=p.bonus_from and r.created_at>=p.activated_at
 and r.origin in ('lateness','manual') and r.medium='bonus' and r.kind in ('deduction','bonus') and r.approved and r.deleted_at is null
 and r.external_state in ('review','pending') and e.quickresto_guest_id>0 and e.quickresto_bonus_account_id>0
 on conflict(adjustment_id,operation) do nothing;
 get diagnostics n=row_count;return n;
end $$;

create function public.payroll_claim_bonus_operation() returns jsonb language plpgsql security definer set search_path='' as $$
declare op public.payroll_bonus_operations;token uuid:=gen_random_uuid();
begin
 -- A process may have died after a POST. Such work must never be retried automatically.
 update public.payroll_bonus_operations set state='review',message='Ответ Quick Resto не подтверждён. Нужна сверка операции без повторного списания.' where state='sending' and claimed_at<now()-interval '3 minutes';
 select o.* into op from public.payroll_bonus_operations o join public.payroll_execution_policy p on p.venue_id=o.venue_id
 where p.legacy_stopped and p.bonus_from is not null and o.policy_version=p.version and (o.state='pending' or (o.state='reading' and o.claimed_at<now()-interval '3 minutes'))
 and not exists(select 1 from public.payroll_bonus_operations b where b.account_id=o.account_id and b.bonus_account_id=o.bonus_account_id and b.id<>o.id and b.state in ('reading','sending','review'))
 order by o.created_at,o.id for update of o skip locked limit 1;
 if op.id is null then return null;end if;
 -- Serialize across processes/venues sharing the same QR loyalty account.
 if not pg_try_advisory_xact_lock(hashtextextended('payroll-bonus:'||op.account_id||':'||op.bonus_account_id,0)) then return null;end if;
 if exists(select 1 from public.payroll_bonus_operations b where b.account_id=op.account_id and b.bonus_account_id=op.bonus_account_id and b.id<>op.id and b.state in ('reading','sending','review')) then return null;end if;
 update public.payroll_bonus_operations set state='reading',lease_token=token,claimed_at=now() where id=op.id;
 return to_jsonb(op)||jsonb_build_object('lease_token',token);
end $$;

create function public.payroll_begin_bonus_send(p_id uuid,p_lease uuid,p_balance numeric) returns boolean language plpgsql security definer set search_path='' as $$
declare op public.payroll_bonus_operations;r public.payroll_adjustments;e public.payroll_employees;
begin
 select * into op from public.payroll_bonus_operations where id=p_id for update;
 if op.state is distinct from 'reading' or op.lease_token is distinct from p_lease then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(op.venue_id::text,0));
 select * into r from public.payroll_adjustments where id=op.adjustment_id for update;
 select * into e from public.payroll_employees where id=op.employee_id;
 if not exists(select 1 from public.payroll_execution_policy p where p.venue_id=op.venue_id and p.legacy_stopped and p.bonus_from is not null and p.version=op.policy_version)
 or r.deleted_at is not null or r.medium<>'bonus' or abs(r.amount)<>op.amount
 or e.quickresto_guest_id is distinct from op.guest_id or e.quickresto_bonus_account_id is distinct from op.bonus_account_id then
  update public.payroll_bonus_operations set state='review',message='Запись или счёт изменились. Нужна проверка.' where id=op.id;return false;
 end if;
 if p_balance is null or p_balance<0 or p_balance>1e12 then raise exception 'Не подтверждён бонусный баланс';end if;
 if op.direction='debit' and p_balance<op.amount then
  if op.operation='apply' and r.origin='lateness' then
   update public.payroll_bonus_operations set state='money',before_balance=p_balance,message='Бонусов недостаточно — весь штраф удержан деньгами',finished_at=now() where id=op.id;
   update public.payroll_adjustments set medium='money',external_state='not_required',bonus_balance_snapshot=p_balance,bonus_checked_at=now() where id=r.id;
  else
   update public.payroll_bonus_operations set state='review',before_balance=p_balance,message='Недостаточно бонусов для операции. Нужна проверка.' where id=op.id;
  end if;return false;
 end if;
 update public.payroll_bonus_operations set state='sending',before_balance=p_balance,claimed_at=now() where id=op.id;
 return true;
end $$;

create function public.payroll_finish_bonus_operation(p_id uuid,p_lease uuid,p_after numeric,p_reference text,p_confirmed boolean) returns void language plpgsql security definer set search_path='' as $$
declare op public.payroll_bonus_operations;
begin
 select * into op from public.payroll_bonus_operations where id=p_id for update;
 if op.id is null or op.lease_token is distinct from p_lease then raise exception 'Бонусная операция недоступна';end if;
 if op.state='done' then return;end if;
 if op.state not in ('reading','sending') then return;end if;
 if p_confirmed and op.state='sending' and p_after is not null and p_after=op.before_balance+(case when op.direction='credit' then op.amount else -op.amount end) then
  update public.payroll_bonus_operations set state='done',after_balance=p_after,provider_reference=left(p_reference,200),finished_at=now(),message=null where id=op.id;
  if op.operation='apply' then
   update public.payroll_adjustments set external_state='done',external_ref='sheerly-bonus:'||op.id,bonus_balance_snapshot=op.before_balance,bonus_checked_at=now() where id=op.adjustment_id;
  else
   update public.payroll_adjustments set external_state='not_required',deleted_at=now(),delete_reason='Отменено после обратной бонусной операции' where id=op.adjustment_id;
  end if;
 else
  update public.payroll_bonus_operations set state='review',after_balance=p_after,finished_at=now(),message='Результат не подтверждён. Проверьте историю Quick Resto; автоматического повтора не будет.' where id=op.id;
 end if;
end $$;

create function public.payroll_reverse_bonus(p_adjustment uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid;v uuid;u uuid;op public.payroll_bonus_operations;result uuid;
begin
 select s.a,s.v,s.u into a,v,u from private.payroll_scope('payroll.review') s;
 perform pg_advisory_xact_lock(hashtextextended(v::text,0));
 select * into op from public.payroll_bonus_operations where adjustment_id=p_adjustment and account_id=a and venue_id=v and operation='apply' and state='done';
 if op.id is null then raise exception 'Подтверждённая бонусная операция Sheerly не найдена';end if;
 if not exists(select 1 from public.payroll_execution_policy where venue_id=v and legacy_stopped and bonus_from is not null) then raise exception 'Сейчас включён режим сравнения';end if;
 insert into public.payroll_bonus_operations(account_id,venue_id,employee_id,adjustment_id,operation,reverses_id,guest_id,bonus_account_id,direction,amount,policy_version)
 values(a,v,op.employee_id,op.adjustment_id,'reverse',op.id,op.guest_id,op.bonus_account_id,case when op.direction='debit' then 'credit' else 'debit' end,op.amount,(select version from public.payroll_execution_policy where venue_id=v))
 on conflict(adjustment_id,operation) do update set adjustment_id=excluded.adjustment_id returning id into result;
 return result;
end $$;
revoke all on function public.payroll_reverse_bonus(uuid) from public,anon;
grant execute on function public.payroll_reverse_bonus(uuid) to authenticated;

-- Unknown sends are reconciled against provider history by a reviewer, never retried blindly.
create function public.payroll_review_bonus_operation(p_id uuid,p_executed boolean,p_evidence text) returns void
language plpgsql security definer set search_path='' as $$
declare a uuid;v uuid;u uuid;op public.payroll_bonus_operations;
begin
 select s.a,s.v,s.u into a,v,u from private.payroll_scope('payroll.review') s;
 perform pg_advisory_xact_lock(hashtextextended(v::text,0));
 select * into op from public.payroll_bonus_operations where id=p_id and account_id=a and venue_id=v for update;
 if op.id is null or op.state<>'review' then raise exception 'Операция уже проверена или недоступна';end if;
 if p_executed is null or length(trim(coalesce(p_evidence,''))) not between 3 and 1000 then raise exception 'Укажите подтверждение из истории Quick Resto';end if;
 if p_executed then
  update public.payroll_bonus_operations set state='done',provider_reference=trim(p_evidence),message='Подтверждено по истории Quick Resto',finished_at=now() where id=op.id;
  if op.operation='apply' then
   update public.payroll_adjustments set external_state='done',external_ref='sheerly-bonus:'||op.id where id=op.adjustment_id;
  else
   update public.payroll_adjustments set external_state='not_required',deleted_at=now(),deleted_by=u,delete_reason='Отменено после подтверждения обратной бонусной операции' where id=op.adjustment_id;
  end if;
 else
  -- Explicitly reviewed absence authorizes a new attempt. It is not a timeout retry.
  update public.payroll_bonus_operations set state='pending',policy_version=(select version from public.payroll_execution_policy where venue_id=v),lease_token=null,claimed_at=null,before_balance=null,after_balance=null,provider_reference=trim(p_evidence),message='Отсутствие операции проверено. Разрешена новая попытка',finished_at=null where id=op.id;
 end if;
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details)
 values(a,v,u,'payroll.bonus_operation.reviewed','payroll_bonus_operation',op.id,jsonb_build_object('employee_name',(select name from public.payroll_employees where id=op.employee_id),'executed',p_executed,'evidence',trim(p_evidence)));
end $$;
revoke all on function public.payroll_review_bonus_operation(uuid,boolean,text) from public,anon;
grant execute on function public.payroll_review_bonus_operation(uuid,boolean,text) to authenticated;

-- Edits cannot race a sent/ambiguous provider request. Confirmed reversals alone
-- may mark an entry deleted, and only after the corresponding queue row is done.
create function private.payroll_guard_bonus_operation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.amount,new.medium,new.deleted_at,new.employee_id,new.business_date) is distinct from (old.amount,old.medium,old.deleted_at,old.employee_id,old.business_date)
 and exists(select 1 from public.payroll_bonus_operations where adjustment_id=old.id and state in ('reading','sending','review')) then raise exception 'Бонусная операция обрабатывается или требует сверки. Сначала проверьте её результат';end if;
 return new;
end $$;
revoke all on function private.payroll_guard_bonus_operation() from public,anon,authenticated;
create trigger payroll_guard_bonus_operation before update on public.payroll_adjustments for each row execute function private.payroll_guard_bonus_operation();

create function private.payroll_bonus_operation_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' or new.state is distinct from old.state then
  insert into public.payroll_adjustment_history(account_id,venue_id,employee_id,adjustment_id,actor_id,actor_name,action,details)
  values(new.account_id,new.venue_id,new.employee_id,new.adjustment_id,auth.uid(),coalesce((select nullif(trim(concat_ws(' ',first_name,last_name)),'') from public.profiles where id=auth.uid()),'Система'),'bonus_operation',jsonb_build_object('state',new.state,'operation',new.operation,'message',new.message,'reference',new.provider_reference));
  insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details) values(new.account_id,new.venue_id,auth.uid(),'payroll.bonus_operation.updated','payroll_bonus_operation',new.id,jsonb_build_object('employee_name',(select name from public.payroll_employees where id=new.employee_id),'adjustment_id',new.adjustment_id,'operation',new.operation,'direction',new.direction,'amount',new.amount,'state',new.state,'message',new.message));
 end if;return new;
end $$;
revoke all on function private.payroll_bonus_operation_audit() from public,anon,authenticated;
create trigger payroll_bonus_operation_audit after insert or update on public.payroll_bonus_operations for each row execute function private.payroll_bonus_operation_audit();
do $$ declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('payroll_prepare_bonus_operations','payroll_claim_bonus_operation','payroll_begin_bonus_send','payroll_finish_bonus_operation') loop
  execute format('revoke all on function %s from public,anon,authenticated',f);execute format('grant execute on function %s to service_role',f);
 end loop;
end $$;
-- A corrected/deleted warning must also reconcile its derived monthly fine.
-- Explicitly cancelled fines stay cancelled; only automatic cancellation is reversible.
create function private.payroll_reconcile_warning_thresholds(p_venue uuid,p_employee uuid,p_month date,p_create boolean,p_date date) returns void
language plpgsql security definer set search_path='' as $$
declare n integer;s public.payroll_discipline_settings;step jsonb;r public.payroll_adjustments;threshold integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_venue::text,0));
 select * into s from public.payroll_discipline_settings where venue_id=p_venue;
 select count(*) into n from public.payroll_adjustments where venue_id=p_venue and employee_id=p_employee and kind='warning' and deleted_at is null and business_date>=p_month and business_date<p_month+interval '1 month';
 for r in select * from public.payroll_adjustments where venue_id=p_venue and employee_id=p_employee and origin='warning_threshold' and business_date>=p_month and business_date<p_month+interval '1 month' for update loop
  threshold:=nullif(split_part(r.automation_key,':warnings:',2),'')::integer;
  if threshold is null then continue;end if;
  if n<threshold and r.deleted_at is null then
   update public.payroll_adjustments set deleted_at=now(),deleted_by=null,delete_reason='Количество предупреждений уменьшилось' where id=r.id;
  elsif n>=threshold and r.deleted_at is not null and r.deleted_by is null and r.delete_reason='Количество предупреждений уменьшилось' then
   update public.payroll_adjustments set deleted_at=null,delete_reason=null where id=r.id;
  end if;
 end loop;
 if not p_create or not coalesce(s.enabled,false) then return;end if;
 for step in select value from jsonb_array_elements(s.warning_steps) loop
  if n=(step->>'count')::integer then
   insert into public.payroll_adjustments(account_id,venue_id,employee_id,business_date,kind,amount,reason,approved,managed,origin,automation_key,source_ref,rule_snapshot)
   values(s.account_id,p_venue,p_employee,p_date,'deduction',-(step->>'amount')::numeric,'Накоплено предупреждений: '||n,true,true,'warning_threshold',p_employee||':'||p_month||':warnings:'||n,'threshold',step)
   on conflict(venue_id,automation_key) where automation_key is not null do nothing;
  end if;
 end loop;
end $$;
revoke all on function private.payroll_reconcile_warning_thresholds(uuid,uuid,date,boolean,date) from public,anon,authenticated;
create or replace function private.payroll_warning_thresholds() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' and new.origin='glide' then return new;end if;
 if tg_op='UPDATE' and old.kind='warning' then
  perform private.payroll_reconcile_warning_thresholds(old.venue_id,old.employee_id,date_trunc('month',old.business_date)::date,false,old.business_date);
 end if;
 if new.kind='warning' then
  perform private.payroll_reconcile_warning_thresholds(new.venue_id,new.employee_id,date_trunc('month',new.business_date)::date,new.deleted_at is null,new.business_date);
 end if;
 return new;
end $$;
drop trigger payroll_warning_thresholds on public.payroll_adjustments;
create trigger payroll_warning_thresholds after insert or update of kind,deleted_at,employee_id,business_date on public.payroll_adjustments for each row execute function private.payroll_warning_thresholds();
create policy payroll_execution_audit_access on public.audit_logs as restrictive for select to authenticated using(entity_type not in ('payroll_execution','payroll_bonus_operation') or (account_id=public.get_active_account_id() and venue_id=public.get_active_venue_id() and public.has_permission('payroll.configure')));
notify pgrst,'reload schema';
commit;
