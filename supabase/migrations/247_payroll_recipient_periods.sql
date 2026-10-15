-- Per-recipient earning months remain independent of the cash payment date.
begin;
create or replace function public.payroll_record_payments(p_input jsonb) returns uuid[]
language plpgsql security definer set search_path='' as $$
declare a uuid;v uuid;u uuid;prev private.payroll_payment_batches;row jsonb;emp public.payroll_employees;
 category uuid;payment uuid;result uuid[]:='{}';child_key uuid;child jsonb;
begin
 select s.a,s.v,s.u into a,v,u from private.payroll_scope('payroll.pay') s;
 if not public.has_permission('finance.create_transaction') then raise exception 'Нет доступа к финансовым операциям';end if;
 perform pg_advisory_xact_lock(hashtextextended(v::text,0));
 select * into prev from private.payroll_payment_batches where request_key=(p_input->>'request_key')::uuid;
 if prev.request_key is not null then
  if prev.account_id<>a or prev.venue_id<>v or prev.input_snapshot is distinct from p_input then raise exception 'Ключ уже использован для другой выплаты';end if;
  return prev.result;
 end if;
 if jsonb_typeof(p_input->'recipients') is distinct from 'array' or jsonb_array_length(p_input->'recipients') not between 1 and 500 then raise exception 'Выберите сотрудников';end if;
 if length(coalesce(p_input->>'note',''))>2000 then raise exception 'Слишком длинный комментарий';end if;
 if exists(select 1 from jsonb_array_elements(p_input->'recipients') x group by x->>'employee_id' having count(*)>1) then raise exception 'Сотрудник указан дважды';end if;
 for row in select * from jsonb_array_elements(p_input->'recipients') loop
  select * into emp from public.payroll_employees where id=(row->>'employee_id')::uuid and account_id=a and venue_id=v;
  if emp.id is null then raise exception 'Сотрудник недоступен';end if;
  if emp.role_id is null then raise exception 'У сотрудника % не указана должность',emp.name;end if;
  select c.id into category from public.finance_categories c join public.roles r on r.id=c.payroll_role_id
   where r.id=emp.role_id and r.venue_id=v and r.archived_at is null and c.account_id=a and c.archived_at is null and c.type='expense';
  if category is null then raise exception 'Проверьте статью ФОТ для должности сотрудника %',emp.name;end if;
  child_key:=md5((p_input->>'request_key')||emp.id::text)::uuid;
  child:=jsonb_build_object('request_key',child_key,'kind','salary','bank_account_id',p_input->>'bank_account_id','category_id',category,
   'date',p_input->>'date','amount',(row->>'amount')::numeric,'note',coalesce(nullif(p_input->>'note',''),'Выплата: '||emp.name),
   'allocations',jsonb_build_array(jsonb_build_object('employee_id',emp.id,'month',coalesce(row->>'month',p_input->>'month'),'amount',(row->>'amount')::numeric,'settled_amount',(row->>'amount')::numeric)));
  payment:=private.payroll_post_payment_scoped(child,a,v,u);result:=array_append(result,payment);
 end loop;
 insert into private.payroll_payment_batches values(a,v,(p_input->>'request_key')::uuid,p_input,result);
 return result;
end $$;
revoke all on function public.payroll_record_payments(jsonb) from public,anon;
grant execute on function public.payroll_record_payments(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
