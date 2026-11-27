-- План месяца с прогнозом и KPI старших, версия 2
-- (дизайн 2026-11-27-sales-plan-forecast-kpi-v2-design.md).
--
-- План месяца — оборот и доля алкоголя (%) в одной строке sales_month_plans,
-- задаётся только функцией sales_month_plan_save по новому праву «Планы продаж».
-- Журнал цен и таблица сезонности питают прогноз. KPI старших переходят на долю
-- алкоголя; условия и план замораживаются только закончившимся месяцем с итогами.
-- Рублёвые колонки плана алкоголя из 415 больше не пишутся (удалим позже).
begin;

-- ── Право «Планы продаж» ──────────────────────────────────
insert into public.permissions (code, module, description)
values ('sales.plan', 'sales', 'Задавать план продаж месяца, журнал цен и сезонность')
on conflict (code) do update set module = excluded.module, description = excluded.description;

insert into public.role_permissions (role_id, permission_id, granted)
select rp.role_id, n.id, true
from public.role_permissions rp
join public.permissions o on o.id = rp.permission_id and o.code = 'sales.configure_shifts'
cross join public.permissions n
where n.code = 'sales.plan' and rp.granted
on conflict (role_id, permission_id) do update set granted = excluded.granted;

-- ── Текущий месяц заведения: по его рабочему дню (часовой пояс и час начала дня) ─
-- Тот же рабочий день, что businessDate в приложении: до начала дня 1-го числа
-- ещё идёт прошлый месяц.
create or replace function private.venue_current_month(p_venue uuid)
returns date language sql stable security definer set search_path = public, pg_catalog as $$
  select date_trunc('month',
    (now() at time zone coalesce((select timezone from public.venues where id = p_venue), 'Europe/Moscow'))
    - make_interval(hours => coalesce((select day_start_hour from public.sales_settings where venue_id = p_venue), 9)))::date
$$;
revoke all on function private.venue_current_month(uuid) from public, anon, authenticated;

-- ── План месяца: доля алкоголя и снимок прогноза ──────────
alter table public.sales_month_plans
  add column alcohol_share numeric(5, 2) check (alcohol_share is null or alcohol_share between 0.1 and 100),
  add column forecast jsonb check (forecast is null or jsonb_typeof(forecast) = 'object'),
  drop constraint sales_month_plans_any,
  add constraint sales_month_plans_any check (turnover is not null or alcohol_share is not null or alcohol is not null);

-- Писать план — только функциями: прямая запись по правам «Смен» (402) закрыта.
drop policy if exists sales_month_plans_insert on public.sales_month_plans;
drop policy if exists sales_month_plans_update on public.sales_month_plans;
drop policy if exists sales_month_plans_delete on public.sales_month_plans;
revoke insert, update, delete on public.sales_month_plans from authenticated;

drop trigger if exists sales_alcohol_plan_guard on public.sales_month_plans;
drop function if exists private.sales_alcohol_plan_guard();
create or replace function private.sales_month_plan_guard()
returns trigger language plpgsql set search_path = public, pg_catalog as $$
begin
  -- Каскадное удаление (заведение, аккаунт) идёт из триггера внешнего ключа — пропускаем.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  if coalesce(current_setting('app.sales_plan_write', true), '') <> '1' then
    raise exception 'План продаж задаётся в «Статистике»';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function private.sales_month_plan_guard() from public, anon, authenticated;
create trigger sales_month_plan_guard before insert or update or delete on public.sales_month_plans
  for each row execute function private.sales_month_plan_guard();

create or replace function public.sales_month_plan_save(p_month date, p_input jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  a uuid := public.get_active_account_id();
  v uuid := public.get_active_venue_id();
  u uuid := auth.uid();
  v_turnover numeric;
  v_share numeric;
  cur public.sales_month_plans;
  result uuid;
begin
  if u is null or a is null or v is null then raise exception 'Войдите в аккаунт и выберите заведение'; end if;
  if not public.has_permission('sales.plan') then raise exception 'Нет доступа к планам продаж'; end if;
  if p_month is null or extract(day from p_month) <> 1 then raise exception 'Проверьте месяц'; end if;
  begin
    v_turnover := round(nullif(p_input->>'turnover', '')::numeric, 2);
    v_share := round(nullif(p_input->>'alcohol_share', '')::numeric, 2);
  exception when others then
    raise exception 'Проверьте суммы плана';
  end;
  if v_turnover is not null and (v_turnover <= 0 or v_turnover >= 1e12) then raise exception 'План оборота должен быть больше нуля'; end if;
  if v_share is not null and (v_share < 0.1 or v_share > 100) then raise exception 'Доля алкоголя — от 0,1 до 100%%'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v::text, 0));
  select * into cur from public.sales_month_plans where account_id = a and venue_id = v and month = p_month for update;
  -- Долю закончившегося месяца, по которой подведены итоги KPI, не меняем задним числом.
  if cur.alcohol_share is distinct from v_share and p_month < private.venue_current_month(v)
     and exists (select 1 from public.payroll_kpi_reviews where account_id = a and venue_id = v and month = p_month) then
    raise exception 'Итоги KPI за % подведены — долю алкоголя менять нельзя', private.payroll_month_label(p_month);
  end if;
  if cur.id is null and v_turnover is null and v_share is null then return null; end if;
  if cur.id is not null and cur.turnover is not distinct from v_turnover and cur.alcohol_share is not distinct from v_share then
    return cur.id;
  end if;
  perform set_config('app.sales_plan_write', '1', true);
  if cur.id is null then
    insert into public.sales_month_plans (account_id, venue_id, month, turnover, alcohol_share, forecast, created_by, updated_by)
    values (a, v, p_month, v_turnover, v_share, p_input->'forecast', u, u) returning id into result;
  elsif v_turnover is null and v_share is null and cur.alcohol is null then
    delete from public.sales_month_plans where id = cur.id;
    result := cur.id;
  else
    update public.sales_month_plans
    set turnover = v_turnover, alcohol_share = v_share, forecast = coalesce(p_input->'forecast', forecast), updated_by = u
    where id = cur.id returning id into result;
  end if;
  perform set_config('app.sales_plan_write', '', true);
  insert into public.audit_logs (account_id, venue_id, user_id, action_code, entity_type, entity_id, details)
  values (a, v, u, 'sales.plan.saved', 'sales_month_plan', result, jsonb_build_object(
    'month', to_char(p_month, 'YYYY-MM'),
    'before', jsonb_build_object('turnover', cur.turnover, 'alcohol_share', cur.alcohol_share),
    'after', jsonb_build_object('turnover', v_turnover, 'alcohol_share', v_share),
    'forecast', p_input->'forecast'));
  return result;
end $$;

-- ── Журнал цен ────────────────────────────────────────────
create table public.sales_price_changes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  venue_id uuid not null,
  effective_on date not null,
  percent numeric(5, 2) not null check (percent between -50 and 100 and percent <> 0),
  note text not null default '' check (length(note) <= 300),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (account_id, id),
  foreign key (account_id, venue_id) references public.venues(account_id, id) on delete cascade
);
create index sales_price_changes_venue on public.sales_price_changes (account_id, venue_id, effective_on);
create index sales_price_changes_created_by on public.sales_price_changes (created_by);

-- ── Сезонность заведения (null-строки нет — отраслевая по умолчанию) ─
create table public.sales_seasonality (
  venue_id uuid primary key,
  account_id uuid not null,
  index jsonb not null check (jsonb_typeof(index) = 'array' and jsonb_array_length(index) = 12),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (account_id, venue_id),
  foreign key (account_id, venue_id) references public.venues(account_id, id) on delete cascade
);
create index sales_seasonality_updated_by on public.sales_seasonality (updated_by);

do $$
declare t text;
begin
  foreach t in array array['sales_price_changes', 'sales_seasonality'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
create policy sales_price_changes_select on public.sales_price_changes for select to authenticated
  using (account_id = (select public.get_active_account_id()) and venue_id = (select public.get_active_venue_id())
         and ((select public.has_permission('sales.view_shifts')) or (select public.has_permission('sales.plan'))));
create policy sales_seasonality_select on public.sales_seasonality for select to authenticated
  using (account_id = (select public.get_active_account_id()) and venue_id = (select public.get_active_venue_id())
         and ((select public.has_permission('sales.view_shifts')) or (select public.has_permission('sales.plan'))));

create or replace function public.sales_price_change_save(p_input jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare a uuid := public.get_active_account_id(); v uuid := public.get_active_venue_id(); u uuid := auth.uid();
  d date; p numeric; n text := trim(coalesce(p_input->>'note', '')); result uuid;
begin
  if u is null or a is null or v is null then raise exception 'Войдите в аккаунт и выберите заведение'; end if;
  if not public.has_permission('sales.plan') then raise exception 'Нет доступа к планам продаж'; end if;
  begin
    d := (p_input->>'date')::date; p := round((p_input->>'percent')::numeric, 2);
  exception when others then raise exception 'Проверьте дату и процент';
  end;
  if d is null or p is null or p = 0 or p < -50 or p > 100 then raise exception 'Изменение цен — от −50 до 100%%, не ноль'; end if;
  if length(n) > 300 then raise exception 'Комментарий — до 300 символов'; end if;
  insert into public.sales_price_changes (account_id, venue_id, effective_on, percent, note, created_by)
  values (a, v, d, p, n, u) returning id into result;
  insert into public.audit_logs (account_id, venue_id, user_id, action_code, entity_type, entity_id, details)
  values (a, v, u, 'sales.price_change.created', 'sales_price_change', result, jsonb_build_object('date', d, 'percent', p, 'note', n));
  return result;
end $$;

create or replace function public.sales_price_change_delete(p_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_catalog as $$
declare a uuid := public.get_active_account_id(); v uuid := public.get_active_venue_id(); u uuid := auth.uid();
  r public.sales_price_changes;
begin
  if u is null or a is null or v is null then raise exception 'Войдите в аккаунт и выберите заведение'; end if;
  if not public.has_permission('sales.plan') then raise exception 'Нет доступа к планам продаж'; end if;
  delete from public.sales_price_changes where id = p_id and account_id = a and venue_id = v returning * into r;
  if r.id is null then return false; end if;
  insert into public.audit_logs (account_id, venue_id, user_id, action_code, entity_type, entity_id, details)
  values (a, v, u, 'sales.price_change.deleted', 'sales_price_change', r.id,
    jsonb_build_object('date', r.effective_on, 'percent', r.percent, 'note', r.note));
  return true;
end $$;

create or replace function public.sales_seasonality_save(p_index jsonb)
returns boolean language plpgsql security definer set search_path = public, pg_catalog as $$
declare a uuid := public.get_active_account_id(); v uuid := public.get_active_venue_id(); u uuid := auth.uid();
  before jsonb;
begin
  if u is null or a is null or v is null then raise exception 'Войдите в аккаунт и выберите заведение'; end if;
  if not public.has_permission('sales.plan') then raise exception 'Нет доступа к планам продаж'; end if;
  select index into before from public.sales_seasonality where venue_id = v and account_id = a;
  if before is not distinct from (case when p_index = 'null'::jsonb then null else p_index end) then return true; end if;
  if p_index is null or p_index = 'null'::jsonb then
    delete from public.sales_seasonality where venue_id = v and account_id = a;
  else
    if jsonb_typeof(p_index) <> 'array' or jsonb_array_length(p_index) <> 12
       or exists (select 1 from jsonb_array_elements(p_index) x where jsonb_typeof(x) <> 'number' or (x)::text::numeric <= 0 or (x)::text::numeric > 10) then
      raise exception 'Сезонность — 12 положительных чисел';
    end if;
    insert into public.sales_seasonality (venue_id, account_id, index, updated_by) values (v, a, p_index, u)
    on conflict (venue_id) do update set index = excluded.index, updated_by = excluded.updated_by, updated_at = now();
  end if;
  insert into public.audit_logs (account_id, venue_id, user_id, action_code, entity_type, entity_id, details)
  values (a, v, u, 'sales.seasonality.changed', 'venue', v, jsonb_build_object('before', before, 'after', p_index));
  return true;
end $$;

-- ── KPI: показатель плана — доля алкоголя ─────────────────
update public.payroll_kpi_terms
set items = (
  select jsonb_agg(case when i->>'type' = 'plan' then i || '{"metric":"alcohol_share"}'::jsonb else i end order by ord)
  from jsonb_array_elements(items) with ordinality as e(i, ord)
)
where exists (select 1 from jsonb_array_elements(items) i where i->>'type' = 'plan' and i->>'metric' is distinct from 'alcohol_share');

create or replace function public.payroll_kpi_terms_save(p_role_id uuid, p_input jsonb, p_expected_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  a uuid := public.get_active_account_id();
  v uuid := public.get_active_venue_id();
  u uuid := auth.uid();
  f date;
  why text := trim(coalesce(p_input->>'reason', ''));
  v_items jsonb := p_input->'items';
  latest uuid;
  previous public.payroll_kpi_terms;
  role_label text;
  result uuid;
begin
  if u is null or a is null or v is null then raise exception 'Войдите в аккаунт и выберите заведение'; end if;
  if not public.has_permission('payroll.configure') then raise exception 'Нет доступа к условиям оплаты'; end if;
  select name into role_label from public.roles where id = p_role_id and venue_id = v and archived_at is null;
  if role_label is null then raise exception 'Должность не найдена'; end if;
  if not exists (select 1 from public.payroll_settings where account_id = a and venue_id = v) then
    raise exception 'Зарплата заведения ещё не настроена';
  end if;
  begin
    f := (p_input->>'valid_from')::date;
  exception when others then f := null;
  end;
  if f is null or extract(day from f) <> 1 or length(why) < 3 or length(why) > 500 then
    raise exception 'Укажите месяц и причину изменения условий';
  end if;
  if jsonb_typeof(v_items) is distinct from 'array' or jsonb_array_length(v_items) not between 1 and 20 then
    raise exception 'Добавьте от 1 до 20 пунктов KPI';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v::text, 0));
  select id into latest from public.payroll_kpi_terms
  where venue_id = v and role_id = p_role_id order by valid_from desc, created_at desc limit 1;
  if latest is distinct from p_expected_id then
    raise exception 'Условия KPI только что изменили. Обновите страницу';
  end if;
  -- Итоги в течение месяца условия не замораживают: только закончившийся месяц с итогами.
  if exists (
    select 1 from public.payroll_kpi_reviews r join public.payroll_kpi_terms t on t.id = r.terms_id
    where r.venue_id = v and t.role_id = p_role_id and r.month >= f and r.month < private.venue_current_month(v)
  ) then
    raise exception 'За этот месяц KPI уже подведены. Новые условия можно задать со следующего месяца';
  end if;
  select * into previous from public.payroll_kpi_terms
  where venue_id = v and role_id = p_role_id and valid_from <= f order by valid_from desc limit 1;
  insert into public.payroll_kpi_terms (account_id, venue_id, role_id, valid_from, items, change_reason, created_by)
  values (a, v, p_role_id, f, v_items, why, u)
  on conflict (venue_id, role_id, valid_from) do update
    set items = excluded.items, change_reason = excluded.change_reason, created_by = excluded.created_by, updated_at = now()
  returning id into result;
  insert into public.audit_logs (account_id, venue_id, user_id, action_code, entity_type, entity_id, details)
  values (a, v, u, 'payroll.kpi_terms.changed', 'payroll_kpi_terms', result, jsonb_build_object(
    'role_id', p_role_id, 'role_name', role_label, 'valid_from', f, 'reason', why,
    'before', previous.items, 'after', v_items));
  return result;
end $$;

create or replace function public.payroll_kpi_save(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  a uuid := public.get_active_account_id();
  v uuid := public.get_active_venue_id();
  u uuid := auth.uid();
  e public.payroll_employees;
  t public.payroll_kpi_terms;
  r public.payroll_kpi_reviews;
  adj public.payroll_adjustments;
  m date;
  last_day date;
  v_key uuid;
  v_total numeric;
  why text := trim(coalesce(p_input->>'reason', ''));
  starts date;
  v_role uuid;
  v_model uuid;
  before_total numeric;
begin
  if u is null or a is null or v is null then raise exception 'Войдите в аккаунт и выберите заведение'; end if;
  if not (public.has_permission('payroll.review') or public.has_permission('payroll.pay')) then
    raise exception 'Нет доступа к итогам KPI';
  end if;
  begin
    v_key := (p_input->>'request_key')::uuid;
    m := (p_input->>'month')::date;
    v_total := round((p_input->>'total')::numeric, 2);
  exception when others then
    raise exception 'Проверьте данные итогов KPI';
  end;
  if v_key is null or m is null or extract(day from m) <> 1 then raise exception 'Проверьте данные итогов KPI'; end if;
  if v_total is null or v_total < 0 or v_total > 1000000 then raise exception 'Итог KPI — от 0 до 1 000 000 ₽'; end if;
  if length(why) < 3 or length(why) > 1000 then raise exception 'Проверьте данные итогов KPI'; end if;
  if jsonb_typeof(p_input->'answers') is distinct from 'object' or jsonb_typeof(p_input->'lines') is distinct from 'array' then
    raise exception 'Проверьте данные итогов KPI';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v::text, 0));

  select * into e from public.payroll_employees where id = (p_input->>'employee_id')::uuid and account_id = a and venue_id = v;
  if e.id is null then raise exception 'Сотрудник не найден'; end if;
  select starts_on into starts from public.payroll_settings where account_id = a and venue_id = v;
  if starts is null or m < greatest('2026-11-01'::date, date_trunc('month', starts)::date) then
    raise exception 'KPI за этот месяц в приложении не подводятся';
  end if;

  -- Условия — действующие для должности сотрудника на последний день месяца.
  -- Должность — как в приложении (employeeAtDate): модель из последнего
  -- назначения или текущая, должность модели или сотрудника.
  last_day := (m + interval '1 month' - interval '1 day')::date;
  select em.model_id into v_model from public.payroll_employee_models em
  where em.employee_id = e.id and em.valid_from <= last_day order by em.valid_from desc, em.created_at desc limit 1;
  v_model := coalesce(v_model, e.model_id);
  select pm.role_id into v_role from public.payroll_models pm where pm.id = v_model;
  v_role := coalesce(v_role, e.role_id);
  select * into t from public.payroll_kpi_terms
  where venue_id = v and role_id = v_role and valid_from <= m order by valid_from desc limit 1;
  if t.id is null or t.id is distinct from (p_input->>'terms_id')::uuid then
    raise exception 'Условия KPI изменились. Обновите страницу';
  end if;

  -- Итог считает сервер приложения, но база не верит ему на слово: больше,
  -- чем дают условия (все пункты + 50 штук «за каждую»), итог быть не может.
  if v_total > (
    select coalesce(sum(case when i->>'type' = 'each' then (i->>'price')::numeric * 50 else (i->>'amount')::numeric end), 0)
    from jsonb_array_elements(t.items) i
  ) then
    raise exception 'Итог KPI больше, чем дают условия. Обновите страницу';
  end if;

  select * into r from public.payroll_kpi_reviews where venue_id = v and employee_id = e.id and month = m for update;
  -- Повтор того же запроса (двойной клик, повторная отправка) — прежний результат.
  if r.id is not null and r.request_key = v_key then
    if r.total <> v_total or r.answers <> (p_input->'answers') then raise exception 'Повторный запрос содержит другие данные'; end if;
    return jsonb_build_object('review_id', r.id, 'adjustment_id', r.adjustment_id, 'total', r.total);
  end if;
  -- Итоги открыли в двух окнах: сохранение из устаревшего не перезаписывает новое.
  if r.id is not null and r.saved_at is distinct from nullif(p_input->>'expected_saved_at', '')::timestamptz then
    raise exception 'Итоги KPI только что изменили. Обновите страницу';
  end if;
  -- Итог посчитан по плану, который видел сервер приложения; план могли поменять.
  if (select alcohol_share from public.sales_month_plans where account_id = a and venue_id = v and month = m)
     is distinct from round(nullif(p_input->>'plan_target', '')::numeric, 2) then
    raise exception 'План продаж за месяц изменился. Обновите страницу';
  end if;

  if exists (select 1 from public.payroll_periods where venue_id = v and month = m and status <> 'draft') then
    raise exception 'Период зафиксирован. Итоги KPI за этот месяц менять нельзя';
  end if;
  if exists (
    select 1 from public.payroll_payout_plans p join public.payroll_payout_rows w on w.plan_id = p.id
    where p.account_id = a and p.venue_id = v and p.month = m and p.payout_no = 2 and p.carried_at is not null and w.employee_id = e.id
  ) then
    raise exception 'Остаток за % уже перенесён — поправку внесите премией за %',
      private.payroll_month_label(m), private.payroll_month_label((m + interval '1 month')::date);
  end if;

  before_total := r.total;
  if r.id is null then
    insert into public.payroll_kpi_reviews (account_id, venue_id, employee_id, month, terms_id, items, answers, lines, total, request_key, saved_by)
    values (a, v, e.id, m, t.id, t.items, p_input->'answers', p_input->'lines', v_total, v_key, u)
    returning * into r;
  else
    update public.payroll_kpi_reviews
    set terms_id = t.id, items = t.items, answers = p_input->'answers', lines = p_input->'lines', total = v_total,
        request_key = v_key, saved_by = u, saved_at = now()
    where id = r.id returning * into r;
  end if;

  perform set_config('app.kpi_write', '1', true);
  if r.adjustment_id is not null then
    select * into adj from public.payroll_adjustments where id = r.adjustment_id for update;
  end if;
  if v_total > 0 and adj.id is null then
    insert into public.payroll_adjustments (account_id, venue_id, employee_id, business_date, kind, medium, amount, reason,
      approved, created_by, approved_by, managed, origin, rule_snapshot, request_key, external_state)
    values (a, v, e.id, m, 'allowance', 'money', v_total, why, true, u, u, true, 'kpi', '{"kpi":true}',
      md5('kpi:' || r.id)::uuid, 'not_required')
    returning * into adj;
  elsif v_total > 0 then
    update public.payroll_adjustments
    set amount = v_total, reason = why, deleted_at = null, deleted_by = null, delete_reason = null
    where id = adj.id returning * into adj;
  elsif adj.id is not null and adj.deleted_at is null then
    update public.payroll_adjustments
    set deleted_at = now(), deleted_by = u, delete_reason = 'Итог KPI — 0 ₽'
    where id = adj.id returning * into adj;
  end if;
  perform set_config('app.kpi_write', '', true);
  update public.payroll_kpi_reviews set adjustment_id = adj.id where id = r.id;
  -- Сотрудник узнаёт и об изменённой премии: уведомление ставится только на
  -- новую запись (316), поэтому изменённую сумму ставим в очередь сами.
  if adj.id is not null and adj.deleted_at is null and before_total is not null and before_total is distinct from v_total
     and exists (select 1 from public.organization_telegram_settings s
                 where s.account_id = a and s.fines_notify_from is not null and adj.created_at >= s.fines_notify_from) then
    insert into public.payroll_adjustment_notifications (adjustment_id, account_id, venue_id, available_at)
    values (adj.id, a, v, now() + interval '2 minutes')
    on conflict (account_id, adjustment_id) do update
      set state = 'pending', attempts = 0, available_at = excluded.available_at, claimed_at = null, last_error = null, updated_at = now();
  end if;

  insert into public.audit_logs (account_id, venue_id, user_id, action_code, entity_type, entity_id, details)
  values (a, v, u, 'payroll.kpi.saved', 'payroll_kpi_review', r.id, jsonb_build_object(
    'employee_id', e.id, 'employee_name', e.name, 'month', m, 'total', v_total, 'before_total', before_total,
    'lines', p_input->'lines'));
  return jsonb_build_object('review_id', r.id, 'adjustment_id', adj.id, 'total', v_total);
end $$;

-- Рублёвый план алкоголя из 415 больше не пишется: его функцию закрываем.
revoke all on function public.sales_alcohol_plan_save(date, jsonb) from public, anon, authenticated;

-- ── Карточка «План продаж не задан» ───────────────────────
alter table public.payroll_payout_alerts drop constraint payroll_payout_alerts_kind_check;
alter table public.payroll_payout_alerts add constraint payroll_payout_alerts_kind_check
  check (kind in ('reconcile', 'short', 'carry', 'transfer', 'failed', 'message', 'kpi', 'kpi_plan', 'sales_plan'));

do $$
declare f text;
begin
  foreach f in array array[
    'public.sales_month_plan_save(date,jsonb)',
    'public.sales_price_change_save(jsonb)',
    'public.sales_price_change_delete(uuid)',
    'public.sales_seasonality_save(jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- REVOKE/GRANT от роли-не-владельца молча ничего не меняют: проверяем итог.
do $$
declare f text;
begin
  foreach f in array array[
    'public.sales_month_plan_save(date,jsonb)',
    'public.sales_price_change_save(jsonb)',
    'public.sales_price_change_delete(uuid)',
    'public.sales_seasonality_save(jsonb)',
    'public.payroll_kpi_save(jsonb)',
    'public.payroll_kpi_terms_save(uuid,jsonb,uuid)'
  ] loop
    if has_function_privilege('anon', f, 'execute') then raise exception 'План: у anon остался доступ к %', f; end if;
    if not has_function_privilege('authenticated', f, 'execute') then raise exception 'План: у authenticated нет доступа к %', f; end if;
  end loop;
  if has_function_privilege('authenticated', 'public.sales_alcohol_plan_save(date,jsonb)', 'execute') then
    raise exception 'План: функция рублёвого плана из 415 доступна пользователю';
  end if;
  if has_function_privilege('authenticated', 'private.venue_current_month(uuid)', 'execute') then
    raise exception 'План: служебная функция доступна пользователю';
  end if;
  if has_table_privilege('authenticated', 'public.sales_month_plans', 'insert')
     or has_table_privilege('authenticated', 'public.sales_price_changes', 'insert')
     or has_table_privilege('authenticated', 'public.sales_seasonality', 'update') then
    raise exception 'План: таблицы плана доступны на запись пользователю';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
