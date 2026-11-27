-- План выплат: день выплаты идёт за графиком, кроме выбранного руками.
--
-- Наличные выдают на смене, и план ставит день выплаты на смену сотрудника.
-- После утверждения график меняется (замены, новые и снятые смены), а день в
-- строке оставался прежним: автовыдача выдавала тому, кого нет на смене, и не
-- выдавала вышедшему на замену (Павел, 27.11). Теперь сервер сверяет день,
-- поставленный планом, с графиком (src/lib/payroll/payout-follow.ts). День,
-- выбранный человеком, — сознательное решение, его сверка не трогает: для
-- этого и нужен признак.
--
-- Признак ставит только правка строки, если день изменился. «Пересчитать»
-- пересобирает строки заново — признак сбрасывается вместе с ними.

alter table public.payroll_payout_rows
  add column if not exists pay_date_manual boolean not null default false;

-- Уже выбранные руками дни — по журналу правок строки.
update public.payroll_payout_rows r
   set pay_date_manual = true
 where exists (
   select 1 from public.payroll_events e
    where e.action = 'payout_row'
      and e.entity_id = r.plan_id
      and e.details->>'row_id' = r.id::text
      and (e.details->>'pay_date') is distinct from (e.details->>'previous_pay_date')
 );

create or replace function public.payroll_payout_row_update(p_row uuid, p_amount numeric, p_pay_date date)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare a uuid; v uuid; u uuid; r public.payroll_payout_rows; plan public.payroll_payout_plans; name text;
begin
  select s.a, s.v, s.u into a, v, u from private.payroll_scope('payroll.pay') s;
  if a is null or v is null then raise exception 'Выберите заведение'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v::text, 0));
  select * into r from public.payroll_payout_rows where id = p_row and account_id = a and venue_id = v for update;
  if r.id is null then raise exception 'Строка плана недоступна'; end if;
  select * into plan from public.payroll_payout_plans where id = r.plan_id for update;
  select e.name into name from public.payroll_employees e where e.id = r.employee_id;
  if plan.state = 'cancelled' then raise exception 'План отменён'; end if;
  if r.state = 'issued' then raise exception 'Строка уже выдана'; end if;
  if p_amount is null or p_amount < 0 or p_amount > 1000000000 or round(p_amount, 2) <> p_amount then
    raise exception 'Некорректная сумма: %', name;
  end if;
  if p_amount < r.issued then raise exception 'Уже выдано больше'; end if;
  if p_pay_date is not null and (p_pay_date < plan.window_from or p_pay_date > plan.window_to) then
    raise exception 'День выплаты вне окна: %', name;
  end if;
  perform private.payroll_payout_guard(r.employee_id, plan.month, p_amount - r.issued);
  update public.payroll_payout_rows
     set amount = p_amount, pay_date = p_pay_date, updated_by = u, updated_at = now(),
         manual = r.manual or p_amount <> r.amount,
         pay_date_manual = r.pay_date_manual or p_pay_date is distinct from r.pay_date,
         state = case when r.issued = 0 then 'planned' when r.issued = p_amount then 'issued' else 'partial' end
   where id = r.id;
  insert into public.payroll_events(account_id, venue_id, employee_id, entity_id, actor_id, action, details)
  values (a, v, r.employee_id, plan.id, u, 'payout_row', jsonb_build_object('row_id', r.id,
    'amount', p_amount, 'previous_amount', r.amount, 'pay_date', p_pay_date, 'previous_pay_date', r.pay_date));
end $function$;

-- Права на функцию переживают create or replace; проверяем, что колонка
-- читается теми же ролями, что и остальная строка плана.
do $$
begin
  if not has_column_privilege('authenticated', 'public.payroll_payout_rows', 'pay_date_manual', 'select') then
    raise exception 'authenticated не читает payroll_payout_rows.pay_date_manual';
  end if;
  if not has_function_privilege('authenticated', 'public.payroll_payout_row_update(uuid,numeric,date)', 'execute') then
    raise exception 'authenticated потерял execute на payroll_payout_row_update';
  end if;
end $$;
