begin;
-- A dated exclusion does not erase earlier paid or imported history.
alter table public.payroll_attendance_rules drop constraint payroll_attendance_rules_source_check,
 add constraint payroll_attendance_rules_source_check check(source in ('quickresto','schedule','excluded'));
create or replace function public.payroll_set_attendance_source(p_employee_id uuid,p_source text,p_valid_from date,p_reason text,p_expected_rule_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid;v uuid;u uuid;e public.payroll_employees;latest uuid;x uuid;
begin
 select s.a,s.v,s.u into a,v,u from private.payroll_scope('payroll.configure') s;
 perform pg_advisory_xact_lock(hashtextextended(v::text,0));
 select * into e from public.payroll_employees where id=p_employee_id and account_id=a and venue_id=v for update;
 if e.id is null then raise exception 'Сотрудник недоступен';end if;
 if e.casual then raise exception 'Разовый выход уже учитывается по графику';end if;
 if p_source is null or p_source not in ('quickresto','schedule','excluded') or p_valid_from is null or length(trim(coalesce(p_reason,'')))<3 then raise exception 'Укажите источник, дату и причину';end if;
 if p_source='schedule' and e.local_user_id is null then raise exception 'Сначала свяжите сотрудника с графиком';end if;
 if p_valid_from<(select starts_on from public.payroll_settings where account_id=a and venue_id=v) then raise exception 'Дата раньше начала учёта';end if;
 if exists(select 1 from public.payroll_source_days where venue_id=v and state='loading') then raise exception 'Дождитесь завершения расчёта';end if;
 select id into latest from public.payroll_attendance_rules where employee_id=e.id order by valid_from desc,created_at desc,id desc limit 1;
 if latest is distinct from p_expected_rule_id then raise exception 'Условия изменились. Обновите данные';end if;
 insert into public.payroll_attendance_rules(account_id,venue_id,employee_id,source,valid_from,reason,created_by)
 values(a,v,e.id,p_source,p_valid_from,trim(p_reason),u) returning id into x;
 return x;
end $$;

-- Defensive DB handling also protects reviewed attendance from an older client.
do $$ declare definition text;begin
 select pg_get_functiondef('private.payroll_schedule_fact_guard()'::regprocedure) into definition;
 if position('begin' in definition)=0 then raise exception 'Unexpected attendance guard';end if;
 definition:=replace(definition,'begin','begin
 if private.payroll_attendance_source(new.employee_id,new.business_date)=''excluded'' then
  new.status:=''ignored'';new.issue:=''Не участвует в зарплатном учёте'';return new;
 end if;');
 execute definition;
 select pg_get_functiondef('private.payroll_generate_discipline()'::regprocedure) into definition;
 if position('private.payroll_attendance_source(e.id,new.business_date)<>''schedule''' in definition)=0 then raise exception 'Unexpected discipline guard';end if;
 execute replace(definition,'private.payroll_attendance_source(e.id,new.business_date)<>''schedule''','private.payroll_attendance_source(e.id,new.business_date)=''quickresto''');
end $$;
notify pgrst,'reload schema';
commit;
