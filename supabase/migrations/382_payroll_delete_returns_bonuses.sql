-- Удаление штрафа или премии, уже проведённых бонусами Quick Resto, больше не
-- упирается в «Сначала оформите обратную бонусную операцию», которую нигде в
-- интерфейсе нельзя было оформить. Удаление ставит в очередь обратную операцию
-- (возврат списанных бонусов или списание начисленных), а запись помечается
-- удалённой только после того, как Quick Resto подтвердит обратную операцию.
-- Причину и автора удаления запоминает сама операция до этого момента.
begin;

alter table public.payroll_bonus_operations
  add column if not exists requested_by uuid,
  add column if not exists request_reason text check (request_reason is null or length(request_reason) between 3 and 1000);

create or replace function public.payroll_journal_command(p_action text,p_input jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid:=public.get_active_account_id();v uuid:=public.get_active_venue_id();u uuid:=auth.uid();r public.payroll_adjustments;e public.payroll_employees;x uuid;d date;k text;m text;amt numeric;actor text;op public.payroll_bonus_operations;rev public.payroll_bonus_operations;
begin
 if u is null or a is null or v is null then raise exception 'Войдите в аккаунт и выберите заведение';end if;
 perform pg_advisory_xact_lock(hashtextextended(v::text,0));
 if p_action='create' then
  if not public.has_permission('payroll.review') then raise exception 'Нет доступа';end if;
  select * into e from public.payroll_employees where id=(p_input->>'employee_id')::uuid and account_id=a and venue_id=v;
  if e.id is null then raise exception 'Сотрудник не найден';end if;
  d:=(p_input->>'date')::date;k:=p_input->>'kind';m:=case when k='warning' then 'none' else p_input->>'medium' end;amt:=coalesce((p_input->>'amount')::numeric,0);
  if p_input->>'request_key' is null or d is null or k not in ('bonus','deduction','warning','allowance') or m not in ('money','bonus','none') or (k<>'warning' and (m='none' or amt<=0 or amt>1000000000)) or length(trim(coalesce(p_input->>'reason','')))<3 then raise exception 'Проверьте дату, сумму и основание';end if;
  if k='allowance' and (m<>'money' or d<>date_trunc('month',d)::date) then raise exception 'Надбавка задаётся деньгами за полный месяц';end if;
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
  if r.medium='bonus' then
   select * into rev from public.payroll_bonus_operations where adjustment_id=r.id and operation='reverse' for update;
   -- Повторное нажатие, пока возврат в очереди, ничего не меняет.
   if rev.state in ('pending','reading','sending') then return r.id;end if;
   if rev.state='review' then raise exception 'Возврат бонусов требует сверки с историей Quick Resto';end if;
   select * into op from public.payroll_bonus_operations where adjustment_id=r.id and operation='apply' for update;
   if op.state in ('reading','sending') then raise exception 'Бонусы сейчас отправляются в Quick Resto. Попробуйте удалить запись через минуту';end if;
   if op.state='review' then raise exception 'Бонусная операция требует сверки с историей Quick Resto. Удалить запись можно после сверки';end if;
   if op.state='done' then
    if not exists(select 1 from public.payroll_execution_policy where venue_id=v and legacy_stopped and bonus_from is not null) then
     raise exception 'Вернуть бонусы сейчас нельзя: Quick Resto работает в режиме сравнения';
    end if;
    -- Запись остаётся в расчёте, пока Quick Resto не подтвердит обратную операцию:
    -- её проводит фоновая обработка, она же помечает запись удалённой.
    if rev.id is null then
     insert into public.payroll_bonus_operations(account_id,venue_id,employee_id,adjustment_id,operation,reverses_id,guest_id,bonus_account_id,direction,amount,policy_version,requested_by,request_reason)
     values(a,v,op.employee_id,r.id,'reverse',op.id,op.guest_id,op.bonus_account_id,case when op.direction='debit' then 'credit' else 'debit' end,op.amount,
      (select version from public.payroll_execution_policy where venue_id=v),u,trim(p_input->>'reason'));
    else
     update public.payroll_bonus_operations set state='pending',policy_version=(select version from public.payroll_execution_policy where venue_id=v),
      lease_token=null,claimed_at=null,before_balance=null,after_balance=null,message=null,finished_at=null,requested_by=u,request_reason=trim(p_input->>'reason')
     where id=rev.id;
    end if;
    return r.id;
   end if;
   if r.external_state='done' then
    raise exception 'Бонусы по этой записи проведены до перехода на Sheerly. Верните их в Quick Resto вручную';
   end if;
   -- Ещё не отправленная операция просто отменяется вместе с записью.
   if op.state='pending' then
    update public.payroll_bonus_operations set state='cancelled',message='Запись удалена до отправки в Quick Resto',finished_at=now() where id=op.id;
   end if;
  end if;
  if not r.managed then
   if r.source_ref is null then raise exception 'Не удалось связать прежнюю запись с расчётом';end if;
   -- Adopt the stable component identity before reversing an imported entry.
   -- The overlay removes this component; no worker or external source is needed.
   update public.payroll_accruals c set components=(select jsonb_agg(case when part->>'source'=r.source_ref then jsonb_set(part,'{source}',to_jsonb('payroll-entry:'||r.id)) else part end) from jsonb_array_elements(c.components) part)
   where c.employee_id=r.employee_id and c.venue_id=v and c.business_date=r.business_date and exists(select 1 from jsonb_array_elements(c.components) part where part->>'source'=r.source_ref);
  end if;
  update public.payroll_adjustments set managed=true,deleted_at=now(),deleted_by=u,delete_reason=trim(p_input->>'reason'),
   external_state=case when r.medium='bonus' then 'not_required' else r.external_state end where id=r.id;return r.id;
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

-- Подтверждённый возврат удаляет запись от имени того, кто удалял, с его причиной.
create or replace function public.payroll_finish_bonus_operation(p_id uuid,p_lease uuid,p_after numeric,p_reference text,p_confirmed boolean) returns void language plpgsql security definer set search_path='' as $$
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
   update public.payroll_adjustments set external_state='not_required',deleted_at=now(),deleted_by=op.requested_by,delete_reason=coalesce(op.request_reason,'Отменено после обратной бонусной операции') where id=op.adjustment_id;
  end if;
 else
  update public.payroll_bonus_operations set state='review',after_balance=p_after,finished_at=now(),message='Результат не подтверждён. Проверьте историю Quick Resto; автоматического повтора не будет.' where id=op.id;
 end if;
end $$;

-- Ручная сверка возврата — то же самое.
create or replace function public.payroll_review_bonus_operation(p_id uuid,p_executed boolean,p_evidence text) returns void
language plpgsql security definer set search_path='' as $$
declare a uuid;v uuid;u uuid;op public.payroll_bonus_operations;r public.payroll_adjustments;e public.payroll_employees;
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
   update public.payroll_adjustments set external_state='not_required',deleted_at=now(),deleted_by=coalesce(op.requested_by,u),delete_reason=coalesce(op.request_reason,'Отменено после подтверждения обратной бонусной операции') where id=op.adjustment_id;
  end if;
 else
  -- Explicitly reviewed absence authorizes a new attempt. It is not a timeout retry.
  select * into r from public.payroll_adjustments where id=op.adjustment_id;
  select * into e from public.payroll_employees where id=r.employee_id;
  if r.deleted_at is not null or r.medium<>'bonus' then
   update public.payroll_bonus_operations set state='cancelled',message='Подтверждено отсутствие операции; запись отменена',finished_at=now() where id=op.id;
  elsif op.operation='apply' and (e.quickresto_guest_id is null or e.quickresto_bonus_account_id is null) then
   raise exception 'Сначала укажите бонусный счёт сотрудника';
  else
  update public.payroll_bonus_operations set employee_id=r.employee_id,
   amount=case when op.operation='apply' then abs(r.amount) else op.amount end,
   direction=case when op.operation='apply' then case when r.amount>0 then 'credit' else 'debit' end else op.direction end,
   guest_id=case when op.operation='apply' then e.quickresto_guest_id else op.guest_id end,
   bonus_account_id=case when op.operation='apply' then e.quickresto_bonus_account_id else op.bonus_account_id end,
   state='pending',policy_version=(select version from public.payroll_execution_policy where venue_id=v),lease_token=null,claimed_at=null,before_balance=null,after_balance=null,provider_reference=trim(p_evidence),message='Отсутствие операции проверено. Разрешена новая попытка',finished_at=null where id=op.id;
  end if;
 end if;
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details)
 values(a,v,u,'payroll.bonus_operation.reviewed','payroll_bonus_operation',op.id,jsonb_build_object('employee_name',(select name from public.payroll_employees where id=op.employee_id),'executed',p_executed,'evidence',trim(p_evidence)));
end $$;

-- Причина удаления видна в истории записи с момента, когда возврат поставлен в очередь.
create or replace function private.payroll_bonus_operation_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' or new.state is distinct from old.state then
  insert into public.payroll_adjustment_history(account_id,venue_id,employee_id,adjustment_id,actor_id,actor_name,action,details)
  values(new.account_id,new.venue_id,new.employee_id,new.adjustment_id,auth.uid(),coalesce((select nullif(trim(concat_ws(' ',first_name,last_name)),'') from public.profiles where id=auth.uid()),'Система'),'bonus_operation',jsonb_build_object('state',new.state,'operation',new.operation,'message',new.message,'reference',new.provider_reference,'delete_reason',case when new.operation='reverse' and new.state='pending' then new.request_reason end));
  insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details) values(new.account_id,new.venue_id,auth.uid(),'payroll.bonus_operation.updated','payroll_bonus_operation',new.id,jsonb_build_object('employee_name',(select name from public.payroll_employees where id=new.employee_id),'adjustment_id',new.adjustment_id,'operation',new.operation,'direction',new.direction,'amount',new.amount,'state',new.state,'message',new.message));
 end if;return new;
end $$;

notify pgrst,'reload schema';
commit;
