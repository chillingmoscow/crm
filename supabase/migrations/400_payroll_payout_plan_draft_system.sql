-- 400: черновик плана выплат формирует сервер в начале периода (Павел, 27.11:
-- «чтобы приходило уведомление, что сформирован новый план»).
--
-- * private.payroll_payout_plan_save_core — тело сохранения плана (последнее —
--   399) без проверки пользователя;
-- * public.payroll_payout_plan_save — как раньше: пользователь с правами + ядро;
-- * public.payroll_payout_plan_draft_system — то же от сервера (cron), без
--   автора, только service_role. Создаёт черновик, лишь если плана на этот
--   период ещё не было ни в каком состоянии: отменённый план не возрождается,
--   утверждённый и черновик не пересобираются. Возвращает id нового плана или
--   null.

create or replace function private.payroll_payout_plan_save_core(p_input jsonb, a uuid, v uuid, u uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  plan public.payroll_payout_plans;
  v_schedule text := p_input->>'schedule';
  v_month date := (p_input->>'month')::date;
  v_no smallint := coalesce((p_input->>'payout_no')::smallint, 1);
  v_from date := (p_input->>'window_from')::date;
  v_to date := (p_input->>'window_to')::date;
  item jsonb; emp public.payroll_employees; amount numeric; pay date;
begin
  if a is null or v is null then raise exception 'Выберите заведение'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v::text, 0));
  if coalesce(v_schedule, '') not in ('main', 'cleaner', 'transfer') then raise exception 'Некорректный график выплат'; end if;
  if v_month is null or date_trunc('month', v_month)::date <> v_month then raise exception 'Некорректный месяц плана'; end if;
  if v_no not in (1, 2) then raise exception 'Некорректный номер выплаты'; end if;
  if v_from is null or v_to is null or v_to < v_from then raise exception 'Некорректное окно выплаты'; end if;
  if v_month < (select starts_on from public.payroll_settings where account_id = a and venue_id = v) then
    raise exception 'Месяц раньше начала учёта';
  end if;
  if jsonb_typeof(p_input->'rows') is distinct from 'array' or jsonb_array_length(p_input->'rows') > 500 then
    raise exception 'Некорректные строки плана';
  end if;
  if exists (select 1 from jsonb_array_elements(p_input->'rows') x group by x->>'employee_id' having count(*) > 1) then
    raise exception 'Сотрудник указан дважды';
  end if;

  select * into plan from public.payroll_payout_plans
   where account_id = a and venue_id = v and schedule = v_schedule and month = v_month and payout_no = v_no and state <> 'cancelled'
   for update;
  if plan.state = 'approved' then raise exception 'План уже утверждён'; end if;
  if plan.id is null then
    insert into public.payroll_payout_plans(account_id, venue_id, schedule, month, payout_no, window_from, window_to, created_by)
    values (a, v, v_schedule, v_month, v_no, v_from, v_to, u) returning * into plan;
  else
    delete from public.payroll_payout_rows where plan_id = plan.id;
    update public.payroll_payout_plans set window_from = v_from, window_to = v_to, version = version + 1
     where id = plan.id returning * into plan;
  end if;

  for item in select * from jsonb_array_elements(p_input->'rows') loop
    select * into emp from public.payroll_employees
     where id = (item->>'employee_id')::uuid and account_id = a and venue_id = v;
    if emp.id is null then raise exception 'Сотрудник недоступен'; end if;
    -- План наличных (main) — общий для всех наличных графиков: «Основной» и
    -- «Клинер», у каждого свой день (Павел, 27.11).
    if not private.payroll_payout_in_plan(emp.payout_schedule, v_schedule) then
      raise exception 'Сотрудник % в другом графике выплат', emp.name;
    end if;
    amount := private.payroll_payout_money(item->'amount', emp.name);
    pay := nullif(item->>'pay_date', '')::date;
    if pay is not null and (pay < v_from or pay > v_to) then raise exception 'День выплаты вне окна: %', emp.name; end if;
    perform private.payroll_payout_guard(emp.id, v_month, amount);
    insert into public.payroll_payout_rows(account_id, venue_id, plan_id, employee_id, pay_date, amount, breakdown, updated_by)
    values (a, v, plan.id, emp.id, pay, amount,
      case when jsonb_typeof(item->'breakdown') = 'object' then item->'breakdown' else '{}'::jsonb end, u);
  end loop;

  insert into public.payroll_events(account_id, venue_id, entity_id, actor_id, action, details)
  values (a, v, plan.id, u, 'payout_plan', jsonb_build_object('schedule', v_schedule, 'month', v_month,
    'payout_no', v_no, 'version', plan.version, 'rows', jsonb_array_length(p_input->'rows')));
  return plan.id;
end $function$;

create or replace function public.payroll_payout_plan_save(p_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare a uuid; v uuid; u uuid;
begin
  select s.a, s.v, s.u into a, v, u from private.payroll_scope('payroll.pay') s;
  if a is null or v is null then raise exception 'Выберите заведение'; end if;
  return private.payroll_payout_plan_save_core(p_input, a, v, u);
end $function$;

create or replace function public.payroll_payout_plan_draft_system(p_account uuid, p_venue uuid, p_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
begin
  if p_account is null or p_venue is null then raise exception 'Не указано заведение'; end if;
  if not exists (select 1 from public.venues where id = p_venue and account_id = p_account) then
    raise exception 'Заведение не найдено';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_venue::text, 0));
  if exists (
    select 1 from public.payroll_payout_plans
     where account_id = p_account and venue_id = p_venue
       and schedule = p_input->>'schedule'
       and month = (p_input->>'month')::date
       and payout_no = coalesce((p_input->>'payout_no')::smallint, 1)
  ) then
    return null;
  end if;
  return private.payroll_payout_plan_save_core(p_input, p_account, p_venue, null);
end $function$;

revoke all on function private.payroll_payout_plan_save_core(jsonb, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.payroll_payout_plan_save(jsonb) from public, anon;
grant execute on function public.payroll_payout_plan_save(jsonb) to authenticated;
revoke all on function public.payroll_payout_plan_draft_system(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.payroll_payout_plan_draft_system(uuid, uuid, jsonb) to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.payroll_payout_plan_draft_system(uuid, uuid, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.payroll_payout_plan_draft_system(uuid, uuid, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'private.payroll_payout_plan_save_core(jsonb, uuid, uuid, uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.payroll_payout_plan_draft_system(uuid, uuid, jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.payroll_payout_plan_save(jsonb)', 'execute') then
    raise exception 'Права на функции плана выплат выставлены неверно';
  end if;
end $$;
