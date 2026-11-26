-- Перевод разового сотрудника в штат без второй записи в зарплате.
--
-- Раньше штатный сотрудник получал новую строку payroll_employees, а смены,
-- начисления и выплаты разового оставались на старой: в ведомости человек
-- раздваивался, остаток делился на две строки. Теперь к записи разового
-- привязывается учётная запись нового сотрудника, и она продолжает ту же
-- историю.
--
-- Прошлые смены остаются за записью зарплаты (payroll_employee_id): по ним
-- уже начислено, а переназначение на учётную запись перевело бы их в учёт по
-- отметкам Quick Resto. Будущие — переходят на учётную запись. Код Quick
-- Resto разовым выдал Sheerly: он остаётся тем же и становится кодом
-- сотрудника.

begin;

create or replace function public.payroll_casual_to_staff(p_employee_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  actor uuid := auth.uid();
  venue uuid := public.get_active_venue_id();
  employee public.payroll_employees;
  member public.user_venue_roles;
  moved integer := 0;
begin
  if actor is null or venue is null then raise exception 'Нет доступа к заведению'; end if;
  if not public.has_permission('people.edit_staff') or not public.has_permission('payroll.configure') then
    raise exception 'Нужны права на сотрудников и на настройку зарплаты';
  end if;

  select * into employee from public.payroll_employees
   where id = p_employee_id and venue_id = venue for update;
  if employee.id is null or not employee.casual then raise exception 'Разовый сотрудник не найден'; end if;
  if employee.local_user_id is not null then raise exception 'Сотрудник уже в штате'; end if;

  select * into member from public.user_venue_roles
   where user_id = p_user_id and venue_id = venue and status = 'active' and fired_at is null;
  if member.id is null then raise exception 'Сотрудник не работает в заведении'; end if;
  if exists(select 1 from public.payroll_employees where venue_id = venue and local_user_id = p_user_id) then
    raise exception 'У сотрудника уже есть расчёт зарплаты';
  end if;
  if exists(select 1 from public.payroll_source_days where venue_id = venue and state = 'loading') then
    raise exception 'Дождитесь обновления зарплаты';
  end if;

  update public.payroll_employees
     set local_user_id = p_user_id, casual = false, active = true
   where id = employee.id;

  -- Будущие смены — на учётную запись; начатые и прошлые не трогаем.
  update public.schedule_shifts
     set user_id = p_user_id, payroll_employee_id = null, payroll_model_id = null,
         version = version + 1, updated_at = now()
   where venue_id = venue and payroll_employee_id = employee.id and starts_at > now()
     and not exists(select 1 from public.schedule_runs r where r.shift_id = schedule_shifts.id);
  get diagnostics moved = row_count;

  -- Код кассы, выданный разовому, становится кодом сотрудника.
  if employee.quickresto_id is not null and employee.quickresto_pin is not null then
    update public.user_venue_roles set terminal_pin = coalesce(terminal_pin, employee.quickresto_pin)
     where id = member.id;
    insert into public.external_entity_links(account_id, provider, entity_type, external_id, local_table, local_id)
    values (employee.account_id, 'quickresto', 'staff', employee.quickresto_id::text, 'profiles', p_user_id)
    on conflict (account_id, provider, entity_type, external_id) do nothing;
  end if;

  insert into public.audit_logs(account_id, venue_id, user_id, action_code, entity_type, entity_id, details)
  values (employee.account_id, venue, actor, 'payroll.employee.converted_to_staff', 'payroll_employee', employee.id,
          jsonb_build_object('employee_name', employee.name, 'user_id', p_user_id, 'moved_shifts', moved));

  return jsonb_build_object('employee_id', employee.id, 'moved_shifts', moved);
end $$;

revoke all on function public.payroll_casual_to_staff(uuid, uuid) from public, anon;
grant execute on function public.payroll_casual_to_staff(uuid, uuid) to authenticated;

-- График: прошлые смены переведённого остаются за записью зарплаты, поэтому
-- она остаётся в справочнике разовых для подписи смен (staff_user_id), но в
-- выборе сотрудника на смену её нет — назначают уже штатного.
create or replace function public.schedule_payroll_options()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
 select case when public.has_permission('schedule.view_all') then jsonb_build_object(
  'employees', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'name', e.name, 'role_id', e.role_id, 'role_name', e.role_name, 'model_id', e.model_id,
      'staff_user_id', case when e.casual then null else e.local_user_id end)), '[]')
    from public.payroll_employees e
    where e.venue_id = public.get_active_venue_id()
      and (e.casual or exists(select 1 from public.schedule_shifts s
                               where s.venue_id = e.venue_id and s.payroll_employee_id = e.id))),
  'models', case when public.has_permission('payroll.configure') then (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'name', m.name, 'role_name', m.role_name, 'role_id', m.role_id, 'is_role_default', m.is_role_default)), '[]')
    from public.payroll_models m
    where m.venue_id = public.get_active_venue_id() and not m.archived and m.monthly_amount = 0) else '[]'::jsonb end,
  'same_department_rate_from', case when public.has_permission('payroll.configure') then (
    select s.same_department_rate_from from public.payroll_settings s
    where s.venue_id = public.get_active_venue_id()) end
 ) else '{"employees":[],"models":[]}'::jsonb end;
$$;

revoke all on function public.schedule_payroll_options() from public, anon;
grant execute on function public.schedule_payroll_options() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.payroll_casual_to_staff(uuid, uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.payroll_casual_to_staff(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.schedule_payroll_options()', 'execute') then
    raise exception 'Права на функции перевода разового не выставились';
  end if;
end $$;

commit;
