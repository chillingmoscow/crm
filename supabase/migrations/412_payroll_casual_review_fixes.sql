-- 412: доработки разовых по итоговому ревью.
--
-- 1. Telegram ID разового — в служебной таблице payroll_casual_contacts (RLS
--    без политик, только сервер). В payroll_employees колонку читал любой с
--    правом на зарплату, хотя в интерфейсе ID виден только с правом на
--    контакты сотрудников. Колонка payroll_employees.telegram_id остаётся до
--    следующей миграции (expand/contract: код прода до выкатки ещё читает её).
-- 2. Повтор заведения вернувшегося разового с тем же именем не упирается в
--    уволенную запись (payroll_casual_request_quickresto).
-- 3. Перевод в штат отказывает уволенному (или увольняемому) разовому и
--    переносит журнал приглашений в чаты на учётную запись — чтобы увольнение
--    штатного отозвало и ссылки, выданные ему ещё разовым.
-- 4. Увольнение отказывает, пока заведение в Quick Resto не подтверждено.
-- 5. Индекс под FK venue_id у payroll_casual_dismissals.
begin;

create table public.payroll_casual_contacts (
  employee_id uuid primary key,
  account_id uuid not null references public.accounts(id),
  venue_id uuid not null references public.venues(id),
  telegram_id text constraint payroll_casual_contacts_telegram_id_format check (telegram_id ~ '^[0-9]{1,15}$'),
  updated_at timestamptz not null default now(),
  unique (account_id, employee_id),
  foreign key (account_id, venue_id, employee_id) references public.payroll_employees(account_id, venue_id, id) on delete cascade
);
create index payroll_casual_contacts_venue on public.payroll_casual_contacts(venue_id);
create index payroll_casual_contacts_employee_fk on public.payroll_casual_contacts(account_id, venue_id, employee_id);
create index payroll_casual_contacts_telegram on public.payroll_casual_contacts(account_id, telegram_id) where telegram_id is not null;
alter table public.payroll_casual_contacts enable row level security;
revoke all on public.payroll_casual_contacts from public, anon, authenticated;
grant all on public.payroll_casual_contacts to service_role;

insert into public.payroll_casual_contacts(employee_id, account_id, venue_id, telegram_id)
select id, account_id, venue_id, telegram_id from public.payroll_employees where telegram_id is not null
on conflict (employee_id) do nothing;

create index payroll_casual_dismissals_venue on public.payroll_casual_dismissals(venue_id);

-- Проверка «ID уже у другого сотрудника» — по новой таблице. Тело — из 408.
create or replace function private.payroll_casual_telegram_taken(p_account uuid, p_employee uuid, p_telegram_id text)
returns boolean language plpgsql volatile security definer
set search_path = public, pg_catalog as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('casual_telegram:' || p_account::text || ':' || p_telegram_id, 0));
  return exists(select 1 from public.payroll_casual_contacts c
                  join public.payroll_employees x on x.id = c.employee_id
                 where c.account_id = p_account and c.employee_id <> p_employee and c.telegram_id = p_telegram_id
                   and (x.active or exists(select 1 from public.payroll_casual_dismissals d
                                            where d.employee_id = x.id and d.state <> 'complete')))
      or exists(select 1 from public.profiles p
                 where regexp_replace(coalesce(p.telegram_id, ''), '[^0-9]', '', 'g') = p_telegram_id
                   and exists(select 1 from public.user_venue_roles u
                                join public.venues v on v.id = u.venue_id
                               where u.user_id = p.id and v.account_id = p_account));
end $$;
revoke all on function private.payroll_casual_telegram_taken(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.payroll_casual_set_telegram_id(p_employee_id uuid, p_telegram_id text)
returns void language plpgsql security definer
set search_path = public, pg_catalog as $$
declare
  venue uuid := private.payroll_casual_scope();
  tg text := nullif(trim(coalesce(p_telegram_id, '')), '');
  e public.payroll_employees;
begin
  if tg is not null and tg !~ '^[0-9]{1,15}$' then
    raise exception 'Telegram ID — только цифры, до 15 знаков';
  end if;
  select * into e from public.payroll_employees where id = p_employee_id and venue_id = venue and casual;
  if not found then raise exception 'Разовый сотрудник не найден'; end if;
  if tg is not null and private.payroll_casual_telegram_taken(e.account_id, e.id, tg) then
    raise exception 'Этот Telegram ID уже указан у другого сотрудника';
  end if;
  insert into public.payroll_casual_contacts(employee_id, account_id, venue_id, telegram_id)
  values (e.id, e.account_id, e.venue_id, tg)
  on conflict (employee_id) do update set telegram_id = excluded.telegram_id, updated_at = now();
end $$;
revoke all on function public.payroll_casual_set_telegram_id(uuid, text) from public, anon;
grant execute on function public.payroll_casual_set_telegram_id(uuid, text) to authenticated;

-- Увольнение: Telegram ID из payroll_casual_contacts; отказ при незавершённом
-- заведении в Quick Resto. Остальное — из 406.
create or replace function public.payroll_casual_dismiss(p_employee_id uuid, p_telegram_id text default null, p_without_chats boolean default false)
returns uuid language plpgsql security definer
set search_path = public, pg_catalog as $$
declare
  venue uuid := private.payroll_casual_scope();
  actor uuid := (select auth.uid());
  e public.payroll_employees;
  job public.payroll_casual_dismissals;
  tg text := nullif(trim(coalesce(p_telegram_id, '')), '');
  stored text;
  qr bigint;
  no_chats boolean;
begin
  -- Увольняет, как и штатных, тот, кто ведёт сотрудников (scope выше — право приглашать).
  if not public.has_permission('people.edit_staff') then
    raise exception 'Нет права увольнять сотрудников';
  end if;
  if tg is not null and tg !~ '^[0-9]{1,15}$' then
    raise exception 'Telegram ID — только цифры, до 15 знаков';
  end if;
  select * into e from public.payroll_employees where id = p_employee_id and venue_id = venue for update;
  if not found or not e.casual then raise exception 'Разовый сотрудник не найден'; end if;
  if tg is not null and private.payroll_casual_telegram_taken(e.account_id, e.id, tg) then
    raise exception 'Этот Telegram ID уже указан у другого сотрудника';
  end if;
  select c.telegram_id into stored from public.payroll_casual_contacts c where c.employee_id = e.id;
  if tg is not null and tg is distinct from stored then
    insert into public.payroll_casual_contacts(employee_id, account_id, venue_id, telegram_id)
    values (e.id, e.account_id, e.venue_id, tg)
    on conflict (employee_id) do update set telegram_id = excluded.telegram_id, updated_at = now();
  end if;
  tg := coalesce(tg, stored);
  no_chats := tg is null and coalesce(p_without_chats, false);

  select * into job from public.payroll_casual_dismissals
   where employee_id = e.id and state <> 'complete' for update;
  if found then
    if tg is distinct from job.telegram_id then
      if job.lease_until > now() - interval '1 minute' then
        raise exception 'Увольнение сейчас обрабатывается, повторите через минуту';
      end if;
      delete from public.staff_telegram_actions
       where account_id = e.account_id and kind = 'remove' and event_key = 'casual-dismissal:' || job.id;
      update public.payroll_casual_dismissals
         set telegram_id = tg, lease_until = null,
             state = case when state = 'working' then 'pending' else state end,
             steps = steps - 'telegram' - 'telegram_not_member' - 'telegram_skipped' - 'telegram_report' - 'telegram_report_skipped'
       where id = job.id;
      insert into public.audit_logs(account_id, venue_id, user_id, action_code, entity_type, entity_id, details)
      values (e.account_id, venue, actor, 'payroll.casual.telegram_id_changed', 'payroll_employee', e.id,
              jsonb_build_object('employee_name', e.name, 'dismissal_id', job.id, 'before', job.telegram_id, 'after', tg));
    elsif no_chats and not coalesce((job.steps ->> 'telegram')::boolean, false) then
      if job.lease_until > now() - interval '1 minute' then
        raise exception 'Увольнение сейчас обрабатывается, повторите через минуту';
      end if;
      update public.payroll_casual_dismissals
         set steps = steps || '{"telegram": true, "telegram_not_member": true}', lease_until = null,
             state = case when state = 'working' then 'pending' else state end
       where id = job.id;
      insert into public.audit_logs(account_id, venue_id, user_id, action_code, entity_type, entity_id, details)
      values (e.account_id, venue, actor, 'payroll.casual.chats_skipped', 'payroll_employee', e.id,
              jsonb_build_object('employee_name', e.name, 'dismissal_id', job.id));
    end if;
    return job.id;
  end if;

  if not e.active then raise exception 'Сотрудник уже не работает'; end if;
  -- Заведение в Quick Resto начато (PIN выбран), но не подтверждено: сотрудник
  -- кассы мог создаться, а мы о нём не знаем — удалять было бы нечего, и он
  -- остался бы в кассе. Сначала довести заведение.
  if e.quickresto_id is null
     and coalesce(e.quickresto_provisioning #>> '{steps,employee,state}', '') = 'prepared'
     and e.quickresto_provisioning #>> '{steps,employee,pin}' is not null then
    raise exception 'Заведение в Quick Resto не завершено — повторите «Добавить → Разовый» с тем же именем, затем увольте';
  end if;
  if e.quickresto_lease_until > now() then
    raise exception 'Идёт заведение сотрудника в Quick Resto. Повторите через минуту';
  end if;
  if exists(select 1 from public.schedule_shifts s
             where s.venue_id = venue and s.payroll_employee_id = e.id and s.starts_at > now()) then
    raise exception 'У сотрудника есть смены в графике впереди — сначала снимите их';
  end if;
  -- Сотрудник Quick Resto: связанный или созданный незавершённым заведением.
  qr := coalesce(e.quickresto_id,
                 case when e.quickresto_provisioning #>> '{steps,employee,id}' ~ '^[0-9]{1,18}$'
                      then (e.quickresto_provisioning #>> '{steps,employee,id}')::bigint end);
  if qr is not null and (
       exists(select 1 from public.payroll_employees x
               where x.account_id = e.account_id and x.id <> e.id and x.quickresto_id = qr)
    or exists(select 1 from public.external_entity_links l
               where l.account_id = e.account_id and l.provider = 'quickresto'
                 and l.entity_type = 'staff' and l.external_id = qr::text)) then
    raise exception 'Сотрудник Quick Resto связан с другой записью. Удаление остановлено';
  end if;

  insert into public.payroll_casual_dismissals(account_id, venue_id, employee_id, actor_id, quickresto_employee_id, telegram_id, steps)
  values (e.account_id, venue, e.id, actor, qr, tg,
          case when no_chats then '{"telegram": true, "telegram_not_member": true}'::jsonb else '{}'::jsonb end)
  returning * into job;
  update public.payroll_employees set active = false where id = e.id;
  insert into public.audit_logs(account_id, venue_id, user_id, action_code, entity_type, entity_id, details)
  values (e.account_id, venue, actor, 'payroll.casual.fired', 'payroll_employee', e.id,
          jsonb_build_object('employee_name', e.name, 'dismissal_id', job.id, 'telegram_id', tg,
                             'quickresto_employee_id', qr, 'without_chats', no_chats));
  return job.id;
end $$;
revoke all on function public.payroll_casual_dismiss(uuid, text, boolean) from public, anon;
grant execute on function public.payroll_casual_dismiss(uuid, text, boolean) to authenticated;

-- Повтор заведения: проверка дубля имени не видит уволенных; уволенному
-- разовому заведение не начинаем. Остальное — из 397.
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
  if exists(select 1 from public.payroll_casual_dismissals d where d.employee_id = employee.id) then
    raise exception 'Сотрудник уволен';
  end if;
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
    if exists(select 1 from public.payroll_employees x
               where x.venue_id = venue and x.casual and x.id <> employee.id
                 and lower(x.name) = lower(first_name || ' ' || last_name)
                 and not exists(select 1 from public.payroll_casual_dismissals d where d.employee_id = x.id)) then
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

-- Перевод в штат: не для уволенного разового; журнал приглашений — на
-- учётную запись. Остальное — из 396.
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
  if not employee.active or exists(select 1 from public.payroll_casual_dismissals d where d.employee_id = employee.id) then
    raise exception 'Сотрудник уволен — перевести в штат нельзя';
  end if;

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

  -- Ссылки в чаты, выданные ещё разовому, — теперь ссылки сотрудника: их
  -- отзовёт его увольнение. Невыполненные приглашения разового не нужны —
  -- приглашения штатного ставит перевод.
  update public.staff_telegram_actions set user_id = p_user_id
   where account_id = employee.account_id and user_id = employee.id and kind = 'invite';
  delete from public.candidate_jobs
   where account_id = employee.account_id and kind = 'chat_invites'
     and payload ->> 'user_id' = employee.id::text and state in ('pending', 'error');

  insert into public.audit_logs(account_id, venue_id, user_id, action_code, entity_type, entity_id, details)
  values (employee.account_id, venue, actor, 'payroll.employee.converted_to_staff', 'payroll_employee', employee.id,
          jsonb_build_object('employee_name', employee.name, 'user_id', p_user_id, 'moved_shifts', moved));

  return jsonb_build_object('employee_id', employee.id, 'moved_shifts', moved);
end $$;
revoke all on function public.payroll_casual_to_staff(uuid, uuid) from public, anon;
grant execute on function public.payroll_casual_to_staff(uuid, uuid) to authenticated;

do $$
begin
  if has_table_privilege('authenticated', 'public.payroll_casual_contacts', 'select')
     or has_table_privilege('anon', 'public.payroll_casual_contacts', 'select') then
    raise exception '412: Telegram ID разовых открыт пользователям';
  end if;
  if has_function_privilege('anon', 'public.payroll_casual_dismiss(uuid, text, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.payroll_casual_dismiss(uuid, text, boolean)', 'execute')
     or has_function_privilege('anon', 'public.payroll_casual_set_telegram_id(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.payroll_casual_request_quickresto(uuid, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.payroll_casual_request_quickresto(uuid, text, text)', 'execute')
     or has_function_privilege('anon', 'public.payroll_casual_to_staff(uuid, uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.payroll_casual_to_staff(uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'private.payroll_casual_telegram_taken(uuid, uuid, text)', 'execute') then
    raise exception '412: права на функции разовых не сошлись';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
