-- KPI старших и план продаж алкоголя (дизайн 2026-11-27-payroll-kpi-design.md).
--
-- Условия KPI — версии по должности «с месяца», отдельно от правил расчёта смен:
-- сохранение версии правил ставит дни на пересчёт, а KPI на смены не влияет.
-- Итоги месяца — одна строка на сотрудника и месяц; итог пишется одной
-- премией allowance (origin='kpi'), которую обычная правка журнала не меняет.
-- План алкоголя — колонками в плане месяца заведения (402).
begin;

-- ── Условия KPI должности ─────────────────────────────────
create table public.payroll_kpi_terms (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  venue_id uuid not null,
  role_id uuid not null references public.roles(id),
  valid_from date not null check (extract(day from valid_from) = 1),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 20),
  change_reason text not null check (length(trim(change_reason)) between 3 and 500),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, id),
  unique (venue_id, role_id, valid_from),
  foreign key (account_id, venue_id) references public.payroll_settings(account_id, venue_id)
);
create index payroll_kpi_terms_account_venue on public.payroll_kpi_terms (account_id, venue_id);
create index payroll_kpi_terms_role on public.payroll_kpi_terms (role_id);
create index payroll_kpi_terms_created_by on public.payroll_kpi_terms (created_by);

-- ── Итоги KPI за месяц ────────────────────────────────────
create table public.payroll_kpi_reviews (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  venue_id uuid not null,
  employee_id uuid not null,
  month date not null check (extract(day from month) = 1),
  terms_id uuid not null,
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  answers jsonb not null check (jsonb_typeof(answers) = 'object'),
  lines jsonb not null check (jsonb_typeof(lines) = 'array'),
  total numeric(15, 2) not null check (total between 0 and 1000000),
  adjustment_id uuid references public.payroll_adjustments(id),
  request_key uuid not null,
  saved_by uuid references public.profiles(id),
  saved_at timestamptz not null default now(),
  unique (account_id, id),
  unique (venue_id, employee_id, month),
  foreign key (account_id, venue_id, employee_id) references public.payroll_employees(account_id, venue_id, id),
  foreign key (account_id, terms_id) references public.payroll_kpi_terms(account_id, id)
);
create index payroll_kpi_reviews_employee on public.payroll_kpi_reviews (account_id, venue_id, employee_id);
create index payroll_kpi_reviews_terms on public.payroll_kpi_reviews (account_id, terms_id);
create index payroll_kpi_reviews_adjustment on public.payroll_kpi_reviews (adjustment_id);
create index payroll_kpi_reviews_saved_by on public.payroll_kpi_reviews (saved_by);

do $$
declare t text;
begin
  foreach t in array array['payroll_kpi_terms', 'payroll_kpi_reviews'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- Условия видят те, кто видит зарплату или настраивает условия оплаты.
create policy payroll_kpi_terms_select on public.payroll_kpi_terms
  for select to authenticated
  using (
    private.payroll_read(account_id, venue_id)
    or (
      account_id = (select public.get_active_account_id())
      and venue_id = (select public.get_active_venue_id())
      and (select public.has_permission('payroll.configure'))
    )
  );
-- Итоги — как начисления: вся зарплата или своя строка.
create policy payroll_kpi_reviews_select on public.payroll_kpi_reviews
  for select to authenticated
  using (private.payroll_read(account_id, venue_id, employee_id));

-- ── План алкоголя в плане месяца ──────────────────────────
alter table public.sales_month_plans
  alter column turnover drop not null,
  add column alcohol numeric(14, 2) check (alcohol is null or (alcohol > 0 and alcohol < 1e12)),
  add column alcohol_suggested numeric(14, 2) check (alcohol_suggested is null or (alcohol_suggested > 0 and alcohol_suggested < 1e12)),
  add column price_increase_percent numeric(5, 2) check (price_increase_percent is null or price_increase_percent between 0.1 and 100),
  add constraint sales_month_plans_any check (turnover is not null or alcohol is not null);

-- План алкоголя нужен и тем, кто подводит KPI, без права видеть смены.
drop policy sales_month_plans_select on public.sales_month_plans;
create policy sales_month_plans_select on public.sales_month_plans
  for select to authenticated
  using (
    account_id = (select public.get_active_account_id())
    and venue_id = (select public.get_active_venue_id())
    and ((select public.has_permission('sales.view_shifts')) or (select public.has_permission('payroll.view')))
  );

-- ── Карточки «На разбор» ──────────────────────────────────
alter table public.payroll_payout_alerts drop constraint payroll_payout_alerts_kind_check;
alter table public.payroll_payout_alerts add constraint payroll_payout_alerts_kind_check
  check (kind in ('reconcile', 'short', 'carry', 'transfer', 'failed', 'message', 'kpi', 'kpi_plan'));

-- ── Название месяца для текстов ошибок ────────────────────
create or replace function private.payroll_month_label(p_month date)
returns text language sql immutable set search_path = pg_catalog as $$
  select (array['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'])[extract(month from p_month)::int]
    || ' ' || extract(year from p_month)::int
$$;
revoke all on function private.payroll_month_label(date) from public, anon, authenticated;

-- ── Премия KPI меняется только через итоги KPI ────────────
create or replace function private.payroll_kpi_guard()
returns trigger language plpgsql set search_path = public, pg_catalog as $$
begin
  if old.origin = 'kpi' and coalesce(current_setting('app.kpi_write', true), '') <> '1' and (
    tg_op = 'DELETE'
    or new.amount is distinct from old.amount
    or new.reason is distinct from old.reason
    or new.kind is distinct from old.kind
    or new.business_date is distinct from old.business_date
    or new.employee_id is distinct from old.employee_id
    or new.medium is distinct from old.medium
    or new.deleted_at is distinct from old.deleted_at
    or new.origin is distinct from old.origin
  ) then
    raise exception 'Эта премия — итог KPI. Измените её в итогах KPI';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function private.payroll_kpi_guard() from public, anon, authenticated;
create trigger payroll_kpi_guard before update or delete on public.payroll_adjustments
  for each row execute function private.payroll_kpi_guard();

-- ── Сохранение условий KPI должности ──────────────────────
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
  if exists (
    select 1 from public.payroll_kpi_reviews r join public.payroll_kpi_terms t on t.id = r.terms_id
    where r.venue_id = v and t.role_id = p_role_id and r.month >= f
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

-- ── Сохранение итогов KPI за месяц ────────────────────────
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
  if (select alcohol from public.sales_month_plans where account_id = a and venue_id = v and month = m)
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

-- ── Запрос отчёта продаж алкоголя для итогов KPI ──────────
create or replace function public.payroll_kpi_request_alcohol(p_month date)
returns integer language plpgsql security definer set search_path = public, pg_catalog as $$
declare v uuid := public.get_active_venue_id();
begin
  if auth.uid() is null or v is null then raise exception 'Войдите в аккаунт и выберите заведение'; end if;
  if not (public.has_permission('payroll.review') or public.has_permission('payroll.pay')) then
    raise exception 'Нет доступа к итогам KPI';
  end if;
  if p_month is null or extract(day from p_month) <> 1 then raise exception 'Проверьте месяц'; end if;
  return private.sales_request_month_reports(v, p_month, false);
end $$;

-- ── План продаж алкоголя на месяц ─────────────────────────
create or replace function public.sales_alcohol_plan_save(p_month date, p_input jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  a uuid := public.get_active_account_id();
  v uuid := public.get_active_venue_id();
  u uuid := auth.uid();
  v_plan numeric;
  v_suggested numeric;
  v_percent numeric;
  cur public.sales_month_plans;
  result uuid;
begin
  if u is null or a is null or v is null then raise exception 'Войдите в аккаунт и выберите заведение'; end if;
  if not (public.has_permission('payroll.review') or public.has_permission('payroll.pay') or public.has_permission('sales.configure_shifts')) then
    raise exception 'Нет доступа к плану продаж';
  end if;
  if p_month is null or extract(day from p_month) <> 1 then raise exception 'Проверьте месяц'; end if;
  begin
    v_plan := round((p_input->>'alcohol')::numeric, 2);
    v_suggested := round((p_input->>'suggested')::numeric, 2);
    v_percent := round((p_input->>'price_increase_percent')::numeric, 2);
  exception when others then
    raise exception 'Проверьте сумму плана';
  end;
  if v_plan is not null and (v_plan <= 0 or v_plan >= 1e12) then raise exception 'План должен быть больше нуля'; end if;
  if v_suggested is not null and (v_suggested <= 0 or v_suggested >= 1e12) then v_suggested := null; end if;
  if v_percent is not null and (v_percent < 0.1 or v_percent > 100) then raise exception 'Повышение цен — от 0,1 до 100%%'; end if;
  -- Та же блокировка, что у сохранения итогов KPI: план и итог не разъедутся.
  perform pg_advisory_xact_lock(hashtextextended(v::text, 0));
  -- План, по которому уже подвели итоги KPI, задним числом не меняется.
  if exists (select 1 from public.payroll_kpi_reviews where account_id = a and venue_id = v and month = p_month) then
    raise exception 'Итоги KPI за % уже подведены — план этого месяца менять нельзя', private.payroll_month_label(p_month);
  end if;
  select * into cur from public.sales_month_plans where account_id = a and venue_id = v and month = p_month for update;
  if cur.id is null and v_plan is null then return null; end if;
  if cur.id is not null and cur.alcohol is not distinct from v_plan and cur.price_increase_percent is not distinct from v_percent then
    return cur.id;
  end if;
  perform set_config('app.alcohol_plan_write', '1', true);
  if cur.id is null then
    insert into public.sales_month_plans (account_id, venue_id, month, alcohol, alcohol_suggested, price_increase_percent, created_by, updated_by)
    values (a, v, p_month, v_plan, v_suggested, v_percent, u, u) returning id into result;
  elsif v_plan is null and cur.turnover is null then
    delete from public.sales_month_plans where id = cur.id;
    result := cur.id;
  else
    update public.sales_month_plans
    set alcohol = v_plan, alcohol_suggested = case when v_plan is null then null else v_suggested end,
        price_increase_percent = case when v_plan is null then null else v_percent end, updated_by = u
    where id = cur.id returning id into result;
  end if;
  perform set_config('app.alcohol_plan_write', '', true);
  insert into public.audit_logs (account_id, venue_id, user_id, action_code, entity_type, entity_id, details)
  values (a, v, u, 'sales.plan.alcohol_set', 'sales_month_plan', result, jsonb_build_object(
    'month', to_char(p_month, 'YYYY-MM'), 'before', cur.alcohol, 'after', v_plan,
    'suggested', v_suggested, 'price_increase_percent', v_percent));
  return result;
end $$;

-- План алкоголя пишет только sales_alcohol_plan_save: прямая запись в таблицу
-- (у «Смен» есть права на строку плана) не должна менять его в обход проверок.
create or replace function private.sales_alcohol_plan_guard()
returns trigger language plpgsql set search_path = public, pg_catalog as $$
begin
  if coalesce(current_setting('app.alcohol_plan_write', true), '') = '1' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if (tg_op = 'INSERT' and (new.alcohol is not null or new.alcohol_suggested is not null or new.price_increase_percent is not null))
     or (tg_op = 'UPDATE' and (new.alcohol is distinct from old.alcohol or new.alcohol_suggested is distinct from old.alcohol_suggested
       or new.price_increase_percent is distinct from old.price_increase_percent))
     or (tg_op = 'DELETE' and old.alcohol is not null) then
    raise exception 'План продаж алкоголя задаётся во вкладке «KPI» зарплаты';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function private.sales_alcohol_plan_guard() from public, anon, authenticated;
create trigger sales_alcohol_plan_guard before insert or update or delete on public.sales_month_plans
  for each row execute function private.sales_alcohol_plan_guard();

do $$
declare f text;
begin
  foreach f in array array[
    'public.payroll_kpi_terms_save(uuid,jsonb,uuid)',
    'public.payroll_kpi_save(jsonb)',
    'public.payroll_kpi_request_alcohol(date)',
    'public.sales_alcohol_plan_save(date,jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ── История продаж алкоголя за прошлый год ────────────────
-- Разово ставим в очередь отчёты за январь 2025 — август 2026: их забирает
-- обычная обработка статистики. Пустые месяцы останутся без данных.
do $$
declare s record; m date;
begin
  for s in
    select c.venue_id from public.sales_statistics_sources c
    join public.sales_settings q on q.venue_id = c.venue_id and q.account_id = c.account_id and q.enabled
    where c.enabled
  loop
    for m in select generate_series('2025-01-01'::date, '2026-08-01'::date, interval '1 month')::date loop
      perform private.sales_request_month_reports(s.venue_id, m, false);
    end loop;
  end loop;
end $$;

-- ── Условия старшего бармена с ноября 2026 ────────────────
insert into public.payroll_kpi_terms (account_id, venue_id, role_id, valid_from, items, change_reason)
select ps.account_id, r.venue_id, r.id, '2026-11-01',
  '[{"id":"inventory","type":"done","label":"Инвентаризация до 20-го","amount":7000},
    {"id":"purchasing","type":"done","label":"Закупки алкоголя (кроме пива)","amount":10000},
    {"id":"team_event","type":"done","label":"Командное мероприятие","amount":3000},
    {"id":"all_three","type":"all","label":"Все три KPI","amount":5000,"requires":["inventory","purchasing","team_event"]},
    {"id":"alcohol_plan","type":"plan","label":"План продаж алкоголя","amount":10000,"metric":"alcohol"},
    {"id":"seasonal","type":"each","label":"Сезонные позиции","price":1000}]'::jsonb,
  'Условия старшего бармена, подтверждены владельцем 27.11.2026'
from public.roles r join public.payroll_settings ps on ps.venue_id = r.venue_id
where r.code = 'payroll_senior_bar' and r.archived_at is null
on conflict (venue_id, role_id, valid_from) do nothing;

-- REVOKE/GRANT от роли-не-владельца молча ничего не меняют: проверяем итог.
do $$
declare f text;
begin
  foreach f in array array[
    'public.payroll_kpi_terms_save(uuid,jsonb,uuid)',
    'public.payroll_kpi_save(jsonb)',
    'public.payroll_kpi_request_alcohol(date)',
    'public.sales_alcohol_plan_save(date,jsonb)'
  ] loop
    if has_function_privilege('anon', f, 'execute') then raise exception 'KPI: у anon остался доступ к %', f; end if;
    if not has_function_privilege('authenticated', f, 'execute') then raise exception 'KPI: у authenticated нет доступа к %', f; end if;
  end loop;
  if has_function_privilege('authenticated', 'private.payroll_kpi_guard()', 'execute') then
    raise exception 'KPI: защита премии доступна пользователю';
  end if;
  if has_table_privilege('authenticated', 'public.payroll_kpi_reviews', 'insert')
     or has_table_privilege('authenticated', 'public.payroll_kpi_terms', 'update') then
    raise exception 'KPI: таблицы KPI доступны на запись пользователю';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
