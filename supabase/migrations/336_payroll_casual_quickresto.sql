begin;

-- A casual worker can get a personal Quick Resto employee (name, role, PIN and
-- warehouse access only). Without it the worker clocks in under a staff
-- member's code and the attendance goes to the wrong person.
alter table public.payroll_employees
  add column quickresto_pin text check (quickresto_pin ~ '^[0-9]{4}$'),
  add column quickresto_provisioning jsonb not null default '{}'::jsonb,
  add column quickresto_lease_until timestamptz;

comment on column public.payroll_employees.quickresto_pin is
  'PIN кассы разового сотрудника, выданный Sheerly при заведении в Quick Resto.';
comment on column public.payroll_employees.quickresto_provisioning is
  'Журнал идемпотентного заведения разового в Quick Resto: имя, фамилия и шаги (employee, store_N).';

-- The pay model of a casual worker is the role default with shift pay only,
-- and the role must be linked to a Quick Resto role.
create or replace function private.payroll_casual_role_model(p_venue uuid, p_role uuid)
returns uuid language plpgsql stable security definer
set search_path = public, pg_catalog as $$
declare
  model public.payroll_models;
begin
  select * into model from public.payroll_models m
   where m.venue_id = p_venue and m.role_id = p_role and m.is_role_default and not m.archived;
  if model.id is null or model.monthly_amount <> 0 then
    raise exception 'Для этой должности не настроена оплата за смену';
  end if;
  if model.quickresto_role_id is null and not exists(
    select 1 from public.external_entity_links l
     where l.account_id = model.account_id and l.provider = 'quickresto'
       and l.entity_type = 'role' and l.local_id = p_role) then
    raise exception 'Свяжите должность с должностью Quick Resto';
  end if;
  return model.id;
end $$;
revoke all on function private.payroll_casual_role_model(uuid, uuid) from public, anon, authenticated;

create or replace function private.payroll_casual_scope()
returns uuid language plpgsql stable security definer
set search_path = public, pg_catalog as $$
declare
  venue uuid := public.get_active_venue_id();
  actor uuid := (select auth.uid());
begin
  if actor is null or venue is null or not exists(
    select 1 from public.user_venue_roles
     where user_id = actor and venue_id = venue and status = 'active') then
    raise exception 'Нет доступа к заведению';
  end if;
  if not public.has_permission('people.invite_staff') then
    raise exception 'Недостаточно прав для добавления сотрудников';
  end if;
  return venue;
end $$;
revoke all on function private.payroll_casual_scope() from public, anon, authenticated;

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
              and e.quickresto_id is null
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

-- A casual worker created earlier (in the schedule) gets the same Quick Resto
-- employee. The name is fixed once the Quick Resto write has started.
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
     and employee.quickresto_id is null then
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

-- One provisioning run per worker at a time (server only).
create or replace function public.payroll_casual_claim_quickresto(p_employee_id uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_catalog as $$
declare
  employee public.payroll_employees;
begin
  update public.payroll_employees
     set quickresto_lease_until = now() + interval '4 minutes'
   where id = p_employee_id and casual
     and (quickresto_lease_until is null or quickresto_lease_until < now())
  returning * into employee;
  if employee.id is null then return null; end if;
  return jsonb_build_object(
    'id', employee.id, 'account_id', employee.account_id, 'venue_id', employee.venue_id,
    'name', employee.name, 'role_id', employee.role_id, 'model_id', employee.model_id,
    'quickresto_id', employee.quickresto_id, 'quickresto_pin', employee.quickresto_pin,
    'provisioning', employee.quickresto_provisioning);
end $$;
revoke all on function public.payroll_casual_claim_quickresto(uuid) from public, anon, authenticated;
grant execute on function public.payroll_casual_claim_quickresto(uuid) to service_role;

-- Lateness for a casual worker with a Quick Resto code is taken from the mark,
-- as for staff. A casual worker without a mark is credited by the schedule and
-- gets no "missing mark" warning or fine.
do $$
declare
  definition text := pg_get_functiondef('private.payroll_generate_discipline()'::regprocedure);
  join_from text := 'join public.payroll_employees e on e.local_user_id=p.user_id and e.venue_id=p.venue_id and e.active';
  join_to text := 'join public.payroll_employees e on e.venue_id=p.venue_id and e.active and (e.local_user_id=p.user_id or (e.casual and e.quickresto_id is not null and p.payroll_employee_id=e.id))';
  match_from text := 'other.venue_id=p.venue_id and other.user_id=p.user_id and other.published';
  match_to text := 'other.venue_id=p.venue_id and (other.user_id=p.user_id or other.payroll_employee_id=p.payroll_employee_id) and other.published';
  person_from text := 'and p.published and p.user_id is not null and p.ends_at<now()';
  person_to text := 'and p.published and (p.user_id is not null or p.payroll_employee_id is not null) and p.ends_at<now()';
  select_from text := 'select e.id employee_id,p.id shift_id';
  select_to text := 'select e.id employee_id,e.casual casual,p.id shift_id';
  missing_from text := 'if r.attendance_id is null and s.missing_enabled and not exists';
  missing_to text := 'if r.attendance_id is null and s.missing_enabled and not r.casual and not exists';
begin
  if strpos(definition, join_from) = 0 or strpos(definition, match_from) = 0
     or strpos(definition, person_from) = 0 or strpos(definition, select_from) = 0
     or strpos(definition, missing_from) = 0 then
    raise exception 'Unexpected discipline contract: inspect payroll_generate_discipline before migrating';
  end if;
  definition := replace(definition, join_from, join_to);
  definition := replace(definition, match_from, match_to);
  definition := replace(definition, person_from, person_to);
  definition := replace(definition, select_from, select_to);
  definition := replace(definition, missing_from, missing_to);
  execute definition;
end $$;

notify pgrst, 'reload schema';
commit;
