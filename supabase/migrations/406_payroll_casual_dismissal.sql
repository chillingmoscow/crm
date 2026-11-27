-- 406: увольнение разового сотрудника и его Telegram ID.
--
-- У разового нет учётной записи, поэтому Telegram ID лежит в его записи
-- зарплаты (payroll_employees.telegram_id) — его вписывают в форме «Разовый»
-- при включённом «Пригласить в чаты». Без ID бот не может исключить человека
-- из чатов.
--
-- «Уволить» разового — долговечное задание payroll_casual_dismissals (как
-- staff_terminations у штатных): запись зарплаты сразу перестаёт быть активной,
-- затем сервер удаляет сотрудника Quick Resto (и его привязки к складам) и
-- исключает человека из всех чатов организации. Шаги отмечаются в steps,
-- повтор проверяет только незавершённое. Прошлые смены, начисления и выплаты
-- не трогаются.
begin;

alter table public.payroll_employees
  add column telegram_id text
  constraint payroll_employees_telegram_id_format check (telegram_id ~ '^[0-9]{1,15}$');

create table public.payroll_casual_dismissals (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  venue_id uuid not null references public.venues(id),
  employee_id uuid not null,
  actor_id uuid not null references public.profiles(id),
  -- Снимок на момент увольнения: сотрудник Quick Resto и Telegram ID.
  quickresto_employee_id bigint,
  telegram_id text,
  state text not null default 'pending' check (state in ('pending', 'working', 'error', 'complete')),
  steps jsonb not null default '{}',
  error text,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  unique (account_id, id),
  foreign key (account_id, venue_id, employee_id) references public.payroll_employees(account_id, venue_id, id)
);
create index payroll_casual_dismissals_employee on public.payroll_casual_dismissals(account_id, venue_id, employee_id);
create index payroll_casual_dismissals_pending on public.payroll_casual_dismissals(available_at) where state <> 'complete';
create unique index payroll_casual_dismissals_one_open on public.payroll_casual_dismissals(employee_id) where state <> 'complete';
create index payroll_casual_dismissals_actor on public.payroll_casual_dismissals(actor_id);
alter table public.payroll_casual_dismissals enable row level security;
revoke all on public.payroll_casual_dismissals from public, anon, authenticated;
grant all on public.payroll_casual_dismissals to service_role;

-- Telegram ID разового: вписывают при заведении или позже, в том числе для
-- уволенного, у которого исключение из чатов ещё не подтверждено.
create or replace function public.payroll_casual_set_telegram_id(p_employee_id uuid, p_telegram_id text)
returns void language plpgsql security definer
set search_path = public, pg_catalog as $$
declare
  venue uuid := private.payroll_casual_scope();
  tg text := nullif(trim(coalesce(p_telegram_id, '')), '');
  updated uuid;
begin
  if tg is not null and tg !~ '^[0-9]{1,15}$' then
    raise exception 'Telegram ID — только цифры, до 15 знаков';
  end if;
  update public.payroll_employees set telegram_id = tg
   where id = p_employee_id and venue_id = venue and casual
  returning id into updated;
  if updated is null then raise exception 'Разовый сотрудник не найден'; end if;
end $$;
revoke all on function public.payroll_casual_set_telegram_id(uuid, text) from public, anon;
grant execute on function public.payroll_casual_set_telegram_id(uuid, text) to authenticated;

-- Начать увольнение (или повторить незавершённое). Telegram ID вписывают в
-- окне увольнения (p_telegram_id; пусто — оставить записанный). Человека не
-- было в чатах и ID нет — p_without_chats: шаг чатов считается выполненным,
-- иначе увольнение ждало бы ID вечно. Повтор подхватывает исправленный ID:
-- журнал чатов по старому ID сбрасывается, и человека проверяют во всех
-- чатах заново.
create or replace function public.payroll_casual_dismiss(p_employee_id uuid, p_telegram_id text default null, p_without_chats boolean default false)
returns uuid language plpgsql security definer
set search_path = public, pg_catalog as $$
declare
  venue uuid := private.payroll_casual_scope();
  actor uuid := (select auth.uid());
  e public.payroll_employees;
  job public.payroll_casual_dismissals;
  tg text := nullif(trim(coalesce(p_telegram_id, '')), '');
  qr bigint;
  no_chats boolean;
begin
  if tg is not null and tg !~ '^[0-9]{1,15}$' then
    raise exception 'Telegram ID — только цифры, до 15 знаков';
  end if;
  select * into e from public.payroll_employees where id = p_employee_id and venue_id = venue for update;
  if not found or not e.casual then raise exception 'Разовый сотрудник не найден'; end if;
  if tg is not null and tg is distinct from e.telegram_id then
    update public.payroll_employees set telegram_id = tg where id = e.id;
  end if;
  tg := coalesce(tg, nullif(trim(coalesce(e.telegram_id, '')), ''));
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

-- Только для сервера (действие и cron): берёт задание в работу на 5 минут.
create or replace function public.payroll_casual_claim_dismissal(p_id uuid default null)
returns jsonb language plpgsql security definer
set search_path = public, pg_catalog as $$
declare j public.payroll_casual_dismissals;
begin
  select * into j from public.payroll_casual_dismissals
   where (p_id is null or id = p_id) and state <> 'complete'
     and (lease_until is null or lease_until < now())
     and (p_id is not null or (available_at <= now() and attempts < 5))
   order by created_at for update skip locked limit 1;
  if not found then return null; end if;
  -- Запись снова активна (вернули в зарплате): удалять нельзя, нужна проверка.
  if exists(select 1 from public.payroll_employees where id = j.employee_id and active) then
    update public.payroll_casual_dismissals
       set state = 'error', error = 'Сотрудник снова активен: требуется проверка', attempts = 5, lease_until = null
     where id = j.id;
    return null;
  end if;
  update public.payroll_casual_dismissals
     set state = 'working', attempts = attempts + 1, lease_until = now() + interval '5 minutes'
   where id = j.id returning * into j;
  return to_jsonb(j) || jsonb_build_object('name', (select name from public.payroll_employees where id = j.employee_id));
end $$;
revoke all on function public.payroll_casual_claim_dismissal(uuid) from public, anon, authenticated;
grant execute on function public.payroll_casual_claim_dismissal(uuid) to service_role;

-- Заведение разового: уволенного с тем же именем не переиспользуем — его
-- сотрудник Quick Resto удалён, а история остаётся отдельной записью.
-- Тело — из 397, изменён только поиск существующей записи.
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
  select id into created from public.payroll_employees x
   where venue_id = venue and casual and lower(name) = lower(full_name)
     and not exists(select 1 from public.payroll_casual_dismissals d where d.employee_id = x.id);
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

-- Справочник графика: уволенный разовый остаётся только ради подписи прошлых
-- смен (dismissed), в выбор на новые смены его не ставят. Тело — из 396.
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
      'staff_user_id', case when e.casual then null else e.local_user_id end,
      'dismissed', exists(select 1 from public.payroll_casual_dismissals d where d.employee_id = e.id))), '[]')
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
  if has_function_privilege('anon', 'public.payroll_casual_dismiss(uuid, text, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.payroll_casual_dismiss(uuid, text, boolean)', 'execute')
     or has_function_privilege('anon', 'public.payroll_casual_set_telegram_id(uuid, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.payroll_casual_set_telegram_id(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.payroll_casual_claim_dismissal(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.payroll_casual_claim_dismissal(uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.payroll_casual_claim_dismissal(uuid)', 'execute')
     or has_function_privilege('anon', 'public.payroll_casual_create(text, text, uuid)', 'execute')
     or has_function_privilege('anon', 'public.schedule_payroll_options()', 'execute') then
    raise exception '406: права на функции увольнения разового не выставились';
  end if;
  if has_table_privilege('authenticated', 'public.payroll_casual_dismissals', 'select')
     or has_table_privilege('anon', 'public.payroll_casual_dismissals', 'select') then
    raise exception '406: таблица заданий увольнения открыта пользователям';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
