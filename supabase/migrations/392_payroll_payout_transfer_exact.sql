-- 392: график «Переводом» — ровно половина месяца, без шага округления, запаса
-- и счёта по умолчанию (счетов несколько, счёт выбирают при каждой оплате).
-- Павел, 25.11.2026. Меняется только сохранение настроек и значение по умолчанию.

begin;

alter table public.payroll_payout_settings alter column schedules set default '{
    "main":     {"method":"cash",    "first":[25,1],  "second":[10,16], "step":5000, "reserve":5000},
    "cleaner":  {"method":"cash",    "first":[18,22], "second":[3,7],   "step":5000, "reserve":0},
    "transfer": {"method":"transfer","first":[25,1],  "second":[10,16], "step":0,    "reserve":0, "bank_account_id":null}
  }'::jsonb;

-- Уже сохранённые настройки: «Переводом» к новым значениям.
update public.payroll_payout_settings
   set schedules = jsonb_set(schedules, '{transfer}',
     '{"method":"transfer","first":[25,1],"second":[10,16],"step":0,"reserve":0,"bank_account_id":null}'::jsonb);

-- Последнее тело — 391_payroll_payout_plan.sql.
create or replace function public.payroll_payout_save_settings(p_input jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  a uuid; v uuid; u uuid;
  defaults jsonb := '{
    "main":     {"method":"cash",    "first":[25,1],  "second":[10,16], "step":5000, "reserve":5000},
    "cleaner":  {"method":"cash",    "first":[18,22], "second":[3,7],   "step":5000, "reserve":0},
    "transfer": {"method":"transfer","first":[25,1],  "second":[10,16], "step":0,    "reserve":0, "bank_account_id":null}
  }'::jsonb;
  result jsonb := '{}'::jsonb;
  code text; given jsonb; step numeric; reserve numeric;
  cash_bank uuid := nullif(p_input->>'bank_account_id', '')::uuid;
  chat text := nullif(trim(coalesce(p_input->>'chat_id', '')), '');
  min_cash numeric;
  item jsonb; emp uuid;
begin
  select s.a, s.v, s.u into a, v, u from private.payroll_scope('payroll.configure') s;
  if a is null or v is null then raise exception 'Выберите заведение'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v::text, 0));
  if not exists (select 1 from public.payroll_settings where account_id = a and venue_id = v) then
    raise exception 'Начальная настройка не выполнена';
  end if;

  min_cash := private.payroll_payout_money(coalesce(p_input->'min_cash', '120000'::jsonb), 'минимум в кэшбоксе');
  if chat is not null and chat !~ '^-?\d+$' then raise exception 'Укажите числовой ID чата'; end if;
  if cash_bank is not null and not exists (
    select 1 from public.bank_accounts b where b.id = cash_bank and b.account_id = a and b.is_active
      and b.currency = 'RUB' and b.type = 'cash' and (b.venue_id is null or b.venue_id = v)) then
    raise exception 'Для выдачи наличными выберите кассу';
  end if;

  -- Способ и окна графиков в этом этапе фиксированы: меняются только шаг, запас и счёт перевода.
  for code in select jsonb_object_keys(defaults) loop
    -- Переводом: ровно половина месяца, без шага и запаса; счёт выбирают при оплате.
    if code = 'transfer' then
      result := result || jsonb_build_object(code, defaults->code);
      continue;
    end if;
    given := coalesce(p_input->'schedules'->code, '{}'::jsonb);
    if jsonb_typeof(given) <> 'object' then raise exception 'Некорректный график выплат'; end if;
    step := private.payroll_payout_money(coalesce(given->'step', defaults->code->'step'), 'шаг округления');
    reserve := private.payroll_payout_money(coalesce(given->'reserve', defaults->code->'reserve'), 'запас');
    if step < 1 or step > 100000 or step <> trunc(step) then raise exception 'Шаг округления — от 1 до 100 000 ₽'; end if;
    if reserve > 1000000 then raise exception 'Запас — не больше 1 000 000 ₽'; end if;
    result := result || jsonb_build_object(code, (defaults->code) || jsonb_build_object('step', step, 'reserve', reserve));
  end loop;

  insert into public.payroll_payout_settings(account_id, venue_id, min_cash, chat_id, bank_account_id, schedules, updated_by, updated_at)
  values (a, v, min_cash, chat, cash_bank, result, u, now())
  on conflict (account_id, venue_id) do update
    set min_cash = excluded.min_cash, chat_id = excluded.chat_id, bank_account_id = excluded.bank_account_id,
        schedules = excluded.schedules, updated_by = u, updated_at = now();

  if p_input ? 'assignments' then
    if jsonb_typeof(p_input->'assignments') <> 'array' or jsonb_array_length(p_input->'assignments') > 1000 then
      raise exception 'Некорректный список сотрудников';
    end if;
    for item in select * from jsonb_array_elements(p_input->'assignments') loop
      if coalesce(item->>'schedule', '') not in ('main', 'cleaner', 'transfer') then raise exception 'Некорректный график выплат'; end if;
      update public.payroll_employees set payout_schedule = item->>'schedule'
       where id = (item->>'employee_id')::uuid and account_id = a and venue_id = v
       returning id into emp;
      if emp is null then raise exception 'Сотрудник недоступен'; end if;
    end loop;
  end if;

  insert into public.payroll_events(account_id, venue_id, entity_id, actor_id, action, details)
  values (a, v, v, u, 'payout_settings', jsonb_build_object('min_cash', min_cash, 'chat_id', chat, 'bank_account_id', cash_bank,
    'schedules', result, 'assignments', coalesce(p_input->'assignments', '[]'::jsonb)));
end $function$;

revoke all on function public.payroll_payout_save_settings(jsonb) from public, anon;
grant execute on function public.payroll_payout_save_settings(jsonb) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.payroll_payout_save_settings(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.payroll_payout_save_settings(jsonb)', 'execute') then
    raise exception 'Права на payroll_payout_save_settings выставлены неверно';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
