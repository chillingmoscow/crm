begin;
create table public.payroll_attendance_rules (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null, venue_id uuid not null, employee_id uuid not null,
 valid_from date not null, source text not null check(source in ('quickresto','schedule')),
 reason text not null check(length(trim(reason))>=3),
 created_by uuid references public.profiles(id), created_at timestamptz not null default now(),
 foreign key(account_id,venue_id,employee_id) references public.payroll_employees(account_id,venue_id,id)
);
create index payroll_attendance_rule_date on public.payroll_attendance_rules(employee_id,valid_from desc,created_at desc,id desc);
alter table public.payroll_attendance_rules enable row level security;
grant select on public.payroll_attendance_rules to authenticated;
create policy payroll_attendance_rule_read on public.payroll_attendance_rules for select to authenticated
 using(private.payroll_read(account_id,venue_id,employee_id));

create function private.payroll_attendance_source(p_employee uuid,p_date date) returns text language sql stable security definer set search_path='' as $$
 select coalesce((select source from public.payroll_attendance_rules where employee_id=p_employee and valid_from<=p_date order by valid_from desc,created_at desc,id desc limit 1),'quickresto');
$$;
revoke all on function private.payroll_attendance_source(uuid,date) from public,anon,authenticated;

create function public.payroll_set_attendance_source(p_employee_id uuid,p_source text,p_valid_from date,p_reason text,p_expected_rule_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid;v uuid;u uuid;e public.payroll_employees;latest uuid;x uuid;
begin
 select s.a,s.v,s.u into a,v,u from private.payroll_scope('payroll.configure') s;
 perform pg_advisory_xact_lock(hashtextextended(v::text,0));
 select * into e from public.payroll_employees where id=p_employee_id and account_id=a and venue_id=v for update;
 if e.id is null then raise exception 'Сотрудник недоступен';end if;
 if e.casual then raise exception 'Разовый выход уже учитывается по графику';end if;
 if p_source is null or p_source not in ('quickresto','schedule') or p_valid_from is null or length(trim(coalesce(p_reason,'')))<3 then raise exception 'Укажите источник, дату и причину';end if;
 if p_source='schedule' and e.local_user_id is null then raise exception 'Сначала свяжите сотрудника с графиком';end if;
 if p_valid_from<(select starts_on from public.payroll_settings where account_id=a and venue_id=v) then raise exception 'Дата раньше начала учёта';end if;
 if exists(select 1 from public.payroll_source_days where venue_id=v and state='loading') then raise exception 'Дождитесь завершения расчёта';end if;
 select id into latest from public.payroll_attendance_rules where employee_id=e.id order by valid_from desc,created_at desc,id desc limit 1;
 if latest is distinct from p_expected_rule_id then raise exception 'Условия изменились. Обновите данные';end if;
 insert into public.payroll_attendance_rules(account_id,venue_id,employee_id,source,valid_from,reason,created_by)
 values(a,v,e.id,p_source,p_valid_from,trim(p_reason),u) returning id into x;
 return x;
end $$;
revoke all on function public.payroll_set_attendance_source(uuid,text,date,text,uuid) from public,anon;
grant execute on function public.payroll_set_attendance_source(uuid,text,date,text,uuid) to authenticated;

create function private.payroll_attendance_rule_audit() returns trigger language plpgsql security definer set search_path='' as $$
declare employee_name text;previous jsonb;
begin
 select name into employee_name from public.payroll_employees where id=new.employee_id;
 select to_jsonb(r) into previous from public.payroll_attendance_rules r where employee_id=new.employee_id and id<>new.id order by valid_from desc,created_at desc,id desc limit 1;
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details)
 values(new.account_id,new.venue_id,new.created_by,'payroll.attendance_source.changed','payroll_attendance_rule',new.id,
 jsonb_build_object('employee_id',new.employee_id,'employee_name',employee_name,'source',new.source,'valid_from',new.valid_from,'reason',new.reason,'before',previous,'after',to_jsonb(new)));
 return new;
end $$;
revoke all on function private.payroll_attendance_rule_audit() from public,anon,authenticated;
create trigger payroll_attendance_rule_audit after insert on public.payroll_attendance_rules for each row execute function private.payroll_attendance_rule_audit();
create policy payroll_attendance_audit_access on public.audit_logs as restrictive for select to authenticated
 using(entity_type<>'payroll_attendance_rule' or (venue_id=public.get_active_venue_id() and public.has_permission('payroll.configure')));

create or replace function private.payroll_schedule_fact_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='deviation' and new.issue='Отметка удалена в Quick Resto' then
  if new.external_id<0 then new.status:='ignored';new.issue:='Смена изменена в графике';
  elsif private.payroll_attendance_source(new.employee_id,new.business_date)='schedule' then new.status:='ignored';new.issue:='Выход учитывается по опубликованному графику';end if;
 end if;
 if new.external_id<0 and new.status='confirmed' then
  if not exists(select 1 from public.schedule_shifts s join public.payroll_employees e on e.id=new.employee_id and e.account_id=new.account_id and e.venue_id=s.venue_id
   join public.sales_settings cfg on cfg.account_id=e.account_id and cfg.venue_id=e.venue_id
   where s.id=new.shift_id and s.venue_id=new.venue_id and s.payroll_fact_id=new.external_id
    and ((s.payroll_employee_id=e.id and e.casual) or (s.payroll_employee_id is null and s.user_id=e.local_user_id and private.payroll_attendance_source(e.id,new.business_date)='schedule'))
    and s.published and s.ends_at<=now() and s.starts_at=new.starts_at and s.ends_at=new.ends_at
    and ((s.starts_at at time zone cfg.timezone)-make_interval(hours=>cfg.day_start_hour))::date=new.business_date)
  then raise exception 'Запись графика изменилась. Повторите расчёт';end if;
 end if;
 return new;
end $$;

-- Planned attendance is not an observable late or missing QR clock-in.
do $$
declare definition text;
begin
 select pg_get_functiondef('private.payroll_generate_discipline()'::regprocedure) into definition;
 if position('where p.venue_id=new.venue_id and p.published' in definition)=0 then raise exception 'Unexpected discipline contract';end if;
 definition:=replace(definition,'where p.venue_id=new.venue_id and p.published','where private.payroll_attendance_source(e.id,new.business_date)<>''schedule'' and p.venue_id=new.venue_id and p.published');
 execute definition;
end $$;
notify pgrst,'reload schema';
commit;
