begin;
alter table public.payroll_adjustments drop constraint payroll_adjustments_kind_check, add constraint payroll_adjustments_kind_check check(kind in ('bonus','deduction','warning','knowledge','experience','food','correction','inventory','allowance'));
alter table public.payroll_adjustments add constraint payroll_allowance_monthly_money check(kind<>'allowance' or (medium='money' and amount>0 and business_date=date_trunc('month',business_date)::date));
create or replace function public.payroll_journal_command(p_action text,p_input jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid:=public.get_active_account_id();v uuid:=public.get_active_venue_id();u uuid:=auth.uid();r public.payroll_adjustments;e public.payroll_employees;x uuid;d date;k text;m text;amt numeric;actor text;
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
create or replace function public.payroll_update_entry(p_input jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare a uuid;v uuid;u uuid;r public.payroll_adjustments;n numeric;why text;
begin
 select s.a,s.v,s.u into a,v,u from private.payroll_scope('payroll.review') s;
 perform pg_advisory_xact_lock(hashtextextended(v::text,0));
 select * into r from public.payroll_adjustments where id=(p_input->>'id')::uuid and account_id=a and venue_id=v for update;
 if r.id is null or not private.payroll_read(a,v,r.employee_id) then raise exception 'Запись недоступна';end if;
 if r.deleted_at is not null then raise exception 'Удалённую запись нельзя редактировать';end if;
 if r.kind not in ('bonus','deduction','warning','allowance') then raise exception 'Измените правило расчёта этой составляющей';end if;
 if exists(select 1 from public.payroll_periods where venue_id=v and month=date_trunc('month',r.business_date)::date and status<>'draft') then raise exception 'Период зафиксирован';end if;
 why:=trim(p_input->>'reason');n:=(p_input->>'amount')::numeric;
 if n is null or n<0 or n>1000000000 or n<>round(n,2) or coalesce(length(why),0) not between 3 and 4000 or (r.kind<>'warning' and n=0) then raise exception 'Укажите корректную сумму и основание';end if;
 n:=case when r.kind='warning' then 0 when r.kind='deduction' then -n else n end;
 -- A retried save of identical content is a no-op, not another audit event.
 if r.amount=n and r.reason=why then return r.id;end if;
 if (p_input->>'expected_amount')::numeric is distinct from r.amount or p_input->>'expected_reason' is distinct from r.reason then raise exception 'Запись уже изменена. Откройте её заново, чтобы сохранить актуальные данные';end if;
 if r.medium='bonus' and r.external_state='done' and n<>r.amount then raise exception 'Бонусная операция уже проведена. Сначала оформите обратную операцию';end if;
 if not r.managed then
  if r.source_ref is null or not exists(select 1 from public.payroll_accruals c, lateral jsonb_array_elements(c.components) part
   where c.employee_id=r.employee_id and c.venue_id=v and c.business_date=r.business_date and part->>'source'=r.source_ref) then raise exception 'Не удалось связать прежнюю запись с начислением';end if;
  -- Adopt the imported component before replacing it, so it is never counted twice.
  update public.payroll_accruals c set components=(select jsonb_agg(case when part->>'source'=r.source_ref then jsonb_set(part,'{source}',to_jsonb('payroll-entry:'||r.id)) else part end) from jsonb_array_elements(c.components) part)
  where c.employee_id=r.employee_id and c.venue_id=v and c.business_date=r.business_date and exists(select 1 from jsonb_array_elements(c.components) part where part->>'source'=r.source_ref);
 end if;
 update public.payroll_adjustments set managed=true,amount=n,reason=why where id=r.id;
 return r.id;
end $$;
revoke all on function public.payroll_journal_command(text,jsonb),public.payroll_update_entry(jsonb) from public,anon;
grant execute on function public.payroll_journal_command(text,jsonb),public.payroll_update_entry(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
