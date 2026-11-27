-- Имя разового для заведения в Quick Resto сохраняется, пока у него нет
-- живого кода кассы (quickresto_pin), а не только пока нет связи с Quick
-- Resto (quickresto_id).
--
-- Разовый, перенесённый из Quick Resto до кодов Sheerly, связан со старым,
-- часто уже удалённым сотрудником кассы, а PIN от Sheerly у него нет. Обе
-- функции пропускали сохранение имени из-за этой связи, и заведение падало с
-- «Укажите имя и фамилию». Код заведения (casual-quickresto.ts) такую мёртвую
-- связь не переиспользует и заводит нового сотрудника кассы — ему нужно имя.
-- Тексты функций — из 336 с одной заменой условия.

begin;

create or replace function public.payroll_casual_create(p_first_name text, p_last_name text, p_role_id uuid)
returns uuid language plpgsql security definer
set search_path = public, pg_catalog as $$
declare
  venue uuid := private.payroll_casual_scope();
  first_name text := trim(coalesce(p_first_name, ''));
  last_name text := trim(coalesce(p_last_name, ''));
  full_name text;
  model uuid;
  created uuid;
begin
  if first_name = '' or last_name = '' or length(first_name) > 80 or length(last_name) > 80 then
    raise exception 'Укажите имя и фамилию';
  end if;
  full_name := first_name || ' ' || last_name;
  if not exists(select 1 from public.roles where id = p_role_id and venue_id = venue) then
    raise exception 'Должность из другого заведения';
  end if;
  model := private.payroll_casual_role_model(venue, p_role_id);
  perform pg_advisory_xact_lock(hashtextextended(venue::text, 0));
  select id into created from public.payroll_employees
   where venue_id = venue and casual and lower(name) = lower(full_name);
  if created is not null then
    -- A worker with a code is already in the staff list. One without a code
    -- (created in the schedule or after a failed attempt) is reused, so the
    -- shifts and payroll history stay with the same person.
    if exists(select 1 from public.payroll_employees where id = created and quickresto_pin is not null) then
      raise exception 'Этот разовый сотрудник уже есть в списке';
    end if;
    update public.payroll_employees e
       set role_id = p_role_id, role_name = r.name, model_id = model, active = true,
           quickresto_provisioning = case
             when coalesce(e.quickresto_provisioning #>> '{steps,employee,state}', 'prepared') = 'prepared'
              and e.quickresto_pin is null
             then e.quickresto_provisioning || jsonb_build_object('first_name', first_name, 'last_name', last_name)
             else e.quickresto_provisioning end
      from public.roles r
     where e.id = created and r.id = p_role_id;
    return created;
  end if;
  insert into public.payroll_employees(account_id, venue_id, name, role_id, role_name, model_id, casual,
                                       opening_confirmed, quickresto_provisioning)
  select v.account_id, venue, full_name, p_role_id, r.name, model, true, true,
         jsonb_build_object('first_name', first_name, 'last_name', last_name)
    from public.venues v join public.roles r on r.id = p_role_id
   where v.id = venue
  returning id into created;
  return created;
end $$;
revoke all on function public.payroll_casual_create(text, text, uuid) from public, anon;
grant execute on function public.payroll_casual_create(text, text, uuid) to authenticated;

create or replace function public.payroll_casual_request_quickresto(p_employee_id uuid, p_first_name text, p_last_name text)
returns void language plpgsql security definer
set search_path = public, pg_catalog as $$
declare
  venue uuid := private.payroll_casual_scope();
  employee public.payroll_employees;
  first_name text := trim(coalesce(p_first_name, ''));
  last_name text := trim(coalesce(p_last_name, ''));
begin
  select * into employee from public.payroll_employees
   where id = p_employee_id and venue_id = venue and casual for update;
  if employee.id is null then raise exception 'Разовый сотрудник не найден'; end if;
  if employee.quickresto_id is not null and employee.quickresto_pin is not null then
    raise exception 'Сотрудник уже заведён в Quick Resto';
  end if;
  if employee.role_id is null then raise exception 'У разового не указана должность'; end if;
  perform private.payroll_casual_role_model(venue, employee.role_id);
  if coalesce(employee.quickresto_provisioning #>> '{steps,employee,state}', 'prepared') = 'prepared'
     and employee.quickresto_pin is null then
    if first_name = '' or last_name = '' or length(first_name) > 80 or length(last_name) > 80 then
      raise exception 'Укажите имя и фамилию';
    end if;
    if exists(select 1 from public.payroll_employees
               where venue_id = venue and casual and id <> employee.id
                 and lower(name) = lower(first_name || ' ' || last_name)) then
      raise exception 'Этот разовый сотрудник уже есть в списке';
    end if;
    update public.payroll_employees
       set name = first_name || ' ' || last_name,
           quickresto_provisioning = quickresto_provisioning
             || jsonb_build_object('first_name', first_name, 'last_name', last_name)
     where id = employee.id;
  end if;
end $$;
revoke all on function public.payroll_casual_request_quickresto(uuid, text, text) from public, anon;
grant execute on function public.payroll_casual_request_quickresto(uuid, text, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.payroll_casual_create(text, text, uuid)', 'execute')
     or has_function_privilege('anon', 'public.payroll_casual_request_quickresto(uuid, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.payroll_casual_request_quickresto(uuid, text, text)', 'execute') then
    raise exception 'Права на функции разового не выставились';
  end if;
end $$;

commit;
