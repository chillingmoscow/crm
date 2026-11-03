-- Постановка удержания по недостаче в зарплатную ведомость.
--
-- Строка ложится в public.payroll_adjustments так же, как пишет журнал корректировок (248):
-- kind = 'inventory', medium = 'money' (иначе расчёт ведомости её пропустит), approved = true
-- (иначе строка станет замечанием, а не суммой), managed = true и ОТРИЦАТЕЛЬНАЯ сумма.
-- Начисление под строкой создаёт и пересчитывает триггер 248, здесь оно не пишется.
--
-- Исправление идёт сторно (deleted_at / deleted_by / delete_reason), правки на месте нет.
-- Закрытый период (payroll_periods.status <> 'draft') не вскрывается: ни поставить в него,
-- ни сторнировать из него строку нельзя, это явная ошибка, а не молчаливый пропуск.
--
-- ВАЖНО про границу доверия. Суммы строк считает TypeScript (allocateMonthlyShortage), RPC их
-- только записывает. Поэтому post_inventory_deduction и reverse_inventory_deduction доступны ТОЛЬКО
-- service_role: из браузера (PostgREST под authenticated) их вызвать нельзя, иначе любой держатель
-- права ввёл бы произвольные суммы и подделал снимок расчёта. Серверное действие сначала проверяет
-- право по сессии пользователя (can_post_inventory_deduction), затем вызывает RPC серверным клиентом и
-- передаёт id пользователя в p_actor: под service_role нет auth.uid(). Журнал корректировок 248 -
-- намеренно иначе: там человек сам ВВОДИТ сумму с основанием, поэтому доверие к вызывающему там задумано.
begin;

-- 1. Право. Ставит удержание тот, кто подводит итоги акта: автоматическая постановка идёт от его имени.
-- Модуль inventory_documents: новым custom_manager / custom_admin право выдаёт триггер 206.
insert into public.permissions (code, module, description)
values (
  'inventory.post_deductions',
  'inventory_documents',
  'Ставить удержания по недостаче в зарплатную ведомость (при подведении итогов акта и при пересчёте месяца)'
)
on conflict (code) do update set
  module = excluded.module,
  description = excluded.description;

insert into public.role_permissions (role_id, permission_id, granted)
select rp.role_id, n.id, true
from public.role_permissions rp
join public.permissions o on o.id = rp.permission_id and o.code = 'inventory.finalize_results'
cross join public.permissions n
where n.code = 'inventory.post_deductions'
  and rp.granted
on conflict (role_id, permission_id)
do update set granted = excluded.granted;

-- 2. Журнал снимков расчёта: из чего получилась поставленная сумма.
-- Пишется только готовый расчёт; неготовый месяц не оставляет в базе ничего.
create table public.inventory_deduction_snapshots (
  id uuid primary key,
  account_id uuid not null,
  venue_id uuid not null,
  month date not null check (extract(day from month) = 1),
  rule_version_id uuid not null references public.stock_deduction_rules(id),
  captured_at timestamptz not null,
  state text not null check (state = 'ready'),
  shortage_total numeric(15,2) not null check (shortage_total >= 0),
  company_total numeric(15,2) not null check (company_total >= 0),
  employees_total numeric(15,2) not null check (employees_total >= 0),
  snapshot jsonb not null default '{}',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  -- Метка сторно без замены (переоткрытие акта): месяц снова не посчитан.
  reversed_at timestamptz,
  unique (account_id, id),
  foreign key (account_id, venue_id) references public.venues(account_id, id)
);
-- Покрывает составной FK на заведение и поиск последнего снимка месяца.
create index inventory_deduction_snapshots_month
  on public.inventory_deduction_snapshots (account_id, venue_id, month, captured_at desc);
create index inventory_deduction_snapshots_rule on public.inventory_deduction_snapshots (rule_version_id);
create index inventory_deduction_snapshots_actor on public.inventory_deduction_snapshots (created_by);

comment on table public.inventory_deduction_snapshots is
  'Снимки расчёта удержания по недостаче, по которым в ведомость поставлены строки. Пишутся только RPC post_inventory_deduction.';

alter table public.inventory_deduction_snapshots enable row level security;
revoke all on public.inventory_deduction_snapshots from public, anon, authenticated, service_role;
grant select on public.inventory_deduction_snapshots to authenticated, service_role;
create policy inventory_deduction_snapshots_read on public.inventory_deduction_snapshots
  for select to authenticated
  using (
    account_id = (select public.get_active_account_id())
    and venue_id = (select public.get_active_venue_id())
    and ((select public.has_permission('inventory.post_deductions'))
         or (select public.has_permission('payroll.view')))
  );

-- 3. Какой снимок породил строку ведомости.
alter table public.payroll_adjustments add column inventory_snapshot_id uuid;
alter table public.payroll_adjustments
  add constraint payroll_adjustments_inventory_snapshot
  foreign key (account_id, inventory_snapshot_id)
  references public.inventory_deduction_snapshots (account_id, id);
create index payroll_adjustments_inventory_snapshot
  on public.payroll_adjustments (account_id, inventory_snapshot_id);

-- 4. Внутренние помощники.

-- Живые строки удержания за месяц заведения (в том числе перенесённые в другой период).
create or replace function private.inventory_deduction_live(p_account uuid, p_venue uuid, p_month date)
returns setof public.payroll_adjustments
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select l.*
  from public.payroll_adjustments l
  join public.inventory_deduction_snapshots s on s.account_id = l.account_id and s.id = l.inventory_snapshot_id
  where s.account_id = p_account and s.venue_id = p_venue and s.month = p_month
    and l.origin = 'inventory_deduction' and l.deleted_at is null
$$;
revoke all on function private.inventory_deduction_live(uuid, uuid, date) from public, anon, authenticated, service_role;

-- Сторно живых строк месяца. Если хоть одна лежит в зафиксированном периоде - ошибка, ничего не тронуто.
create or replace function private.inventory_deduction_reverse(
  p_account uuid, p_venue uuid, p_month date, p_reason text, p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  locked date;
  n integer;
begin
  select date_trunc('month', l.business_date)::date into locked
  from private.inventory_deduction_live(p_account, p_venue, p_month) l
  join public.payroll_periods pp
    on pp.venue_id = p_venue and pp.month = date_trunc('month', l.business_date)::date and pp.status <> 'draft'
  limit 1;
  if locked is not null then
    raise exception 'Период зафиксирован: удержание за % уже в ведомости за %, пересчитать или сторнировать его нельзя',
      to_char(p_month, 'MM.YYYY'), to_char(locked, 'MM.YYYY');
  end if;
  update public.payroll_adjustments
     set deleted_at = now(), deleted_by = p_user, delete_reason = p_reason
   where id in (select id from private.inventory_deduction_live(p_account, p_venue, p_month));
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function private.inventory_deduction_reverse(uuid, uuid, date, text, uuid) from public, anon, authenticated, service_role;

-- 5. Право ставить удержание в заведении (по ролям именно этого заведения, не по активному в сессии:
-- акт может принадлежать заведению, отличному от активного у пользователя).
create or replace function private.inventory_deduction_user_can_post(p_user uuid, p_venue uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select p_user is not null and p_venue is not null and exists (
    select 1
    from public.user_venue_roles uvr
    join public.venues ve on ve.id = uvr.venue_id and ve.archived_at is null
    join public.role_permissions rp on rp.role_id = uvr.role_id and rp.granted
    join public.permissions p on p.id = rp.permission_id
    where uvr.user_id = p_user
      and uvr.venue_id = p_venue
      and uvr.status = 'active'
      and p.code = 'inventory.post_deductions'
  )
$$;
revoke all on function private.inventory_deduction_user_can_post(uuid, uuid) from public, anon, authenticated, service_role;

-- Проверка по сессии: серверное действие зовёт её ДО записи. Сама ничего не пишет.
create or replace function public.can_post_inventory_deduction(p_venue uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select private.inventory_deduction_user_can_post((select auth.uid()), p_venue)
$$;
revoke all on function public.can_post_inventory_deduction(uuid) from public, anon, service_role;
grant execute on function public.can_post_inventory_deduction(uuid) to authenticated;

-- Под service_role нет auth.uid(), а триггеры ведомости (история, аудит, имя автора) читают его.
-- auth.uid() берёт request.jwt.claim.sub первым, поэтому на время записи подставляется только он;
-- request.jwt.claims не трогается вообще, так что то, что кастуют из него в jsonb, остаётся как было.
-- Прежнее значение возвращается после записи. Если sub не был задан, вернуть его в NULL нельзя:
-- PostgreSQL после set_config/reset оставляет пустую строку (проверено), а auth.uid() и остальные
-- помощники Supabase читают sub через nullif(..., ''), для них '' и NULL равны. Значение к тому же
-- транзакционное (is_local = true): на границе транзакции пул соединений ничего не уносит.
create or replace function private.inventory_deduction_act_as(p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  prev jsonb := jsonb_build_object('sub', current_setting('request.jwt.claim.sub', true));
begin
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  return prev;
end;
$$;
revoke all on function private.inventory_deduction_act_as(uuid) from public, anon, authenticated, service_role;

create or replace function private.inventory_deduction_restore(p_prev jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_prev->>'sub', ''), true);
end;
$$;
revoke all on function private.inventory_deduction_restore(jsonb) from public, anon, authenticated, service_role;

-- 6. Постановка.
--
-- Только service_role (см. заметку в начале файла). p_actor - пользователь, от имени которого ставится
-- строка; его право проверяется здесь ещё раз, а не только в серверном действии.
-- p_lines: [{employee_id, amount (положительная, ₽), request_key, reason}] - по одной на сотрудника.
-- p_snapshot: {id, state, captured_at, rule_version_id, shortage_total, company_total, employees_total, missing, payload}.
--
-- Возвращает jsonb:
--  - неготовый расчёт: {posted:false, state, missing} и НИЧЕГО не пишется;
--  - повтор того же снимка: {posted:false, replayed:true};
--  - расчёт совпал с уже поставленным: {posted:false, unchanged:true};
--  - иначе {posted:true, reversed, target_month, displaced, lines, inactive}.
-- Суммы в lines - как в ведомости (отрицательные).
create or replace function public.post_inventory_deduction(
  p_actor uuid, p_venue uuid, p_month date, p_lines jsonb, p_snapshot jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  u uuid := p_actor;
  a uuid;
  tz text;
  prev_claims jsonb;
  today date;
  cur_month date;
  starts date;
  snap_id uuid;
  captured timestamptz;
  rule_id uuid;
  shortage numeric; company numeric; employees numeric;
  rec record;
  emp public.payroll_employees%rowtype;
  desired jsonb := '{}';
  live jsonb;
  lines_sum numeric := 0;
  line_amount numeric;
  line_reason text;
  line_key uuid;
  existing public.inventory_deduction_snapshots%rowtype;
  latest_captured timestamptz;
  latest_unreversed boolean;
  target date;
  line_date date;
  displaced boolean := false;
  reversed integer := 0;
  suffix text := '';
  adj_id uuid;
  out_lines jsonb := '[]';
  out_inactive jsonb := '[]';
  is_inactive boolean;
begin
  if u is null or p_venue is null or not private.inventory_deduction_user_can_post(u, p_venue) then
    raise exception 'Нет права ставить удержания по недостаче в этом заведении';
  end if;
  if not exists (select 1 from public.profiles pr where pr.id = u) then
    raise exception 'Нет права ставить удержания по недостаче в этом заведении';
  end if;
  select ve.account_id, coalesce(ve.timezone, 'Europe/Moscow') into a, tz
  from public.venues ve where ve.id = p_venue and ve.archived_at is null;
  if a is null then raise exception 'Заведение не найдено'; end if;

  if p_month is null or extract(day from p_month) <> 1 then
    raise exception 'Месяц задаётся первым числом, например 2026-10-01';
  end if;
  today := (now() at time zone tz)::date;
  cur_month := date_trunc('month', today)::date;
  if p_month > cur_month then raise exception 'Месяц ещё не наступил'; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then raise exception 'Не передан снимок расчёта'; end if;

  -- Только готовый расчёт ставится. Остальное ничего не пишет и возвращает, чего не хватает.
  if p_snapshot->>'state' is distinct from 'ready' then
    return jsonb_build_object('posted', false, 'state', coalesce(p_snapshot->>'state', 'unknown'),
                              'missing', coalesce(p_snapshot->'missing', '[]'::jsonb));
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then raise exception 'Строки удержания переданы неверно'; end if;
  begin
    snap_id := (p_snapshot->>'id')::uuid;
    captured := (p_snapshot->>'captured_at')::timestamptz;
    rule_id := (p_snapshot->>'rule_version_id')::uuid;
    shortage := (p_snapshot->>'shortage_total')::numeric;
    company := (p_snapshot->>'company_total')::numeric;
    employees := (p_snapshot->>'employees_total')::numeric;
  exception when others then
    raise exception 'Снимок расчёта заполнен неверно';
  end;
  if snap_id is null or captured is null or rule_id is null or shortage is null or company is null or employees is null
     or shortage < 0 or company < 0 or employees < 0 then
    raise exception 'Снимок расчёта заполнен неверно';
  end if;
  if not exists (select 1 from public.stock_deduction_rules r where r.id = rule_id and r.account_id = a and r.venue_id = p_venue) then
    raise exception 'Версия правил не найдена в этом заведении';
  end if;

  -- Один расчёт месяца за раз; тот же замок, что у журнала корректировок, держит
  -- постановку и фиксацию периода друг от друга.
  perform pg_advisory_xact_lock(hashtextextended('inventory-deduction:' || p_venue::text || ':' || p_month::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_venue::text, 0));

  -- Проверка строк.
  for rec in select e.value as line from jsonb_array_elements(p_lines) e loop
    begin
      line_amount := (rec.line->>'amount')::numeric;
      line_key := (rec.line->>'request_key')::uuid;
      select * into emp from public.payroll_employees pe
        where pe.id = (rec.line->>'employee_id')::uuid and pe.account_id = a and pe.venue_id = p_venue;
    exception when others then
      raise exception 'Строка удержания заполнена неверно';
    end;
    if emp.id is null then raise exception 'Сотрудник не найден в этом заведении'; end if;
    if line_amount is null or line_amount <= 0 or line_amount > 1000000000 or line_amount <> round(line_amount, 2) then
      raise exception 'Сумма удержания должна быть положительной, с точностью до копейки';
    end if;
    if line_key is null then raise exception 'У строки нет ключа повтора'; end if;
    if length(trim(coalesce(rec.line->>'reason', ''))) not between 3 and 300 then
      raise exception 'Основание строки: от 3 до 300 символов';
    end if;
    if desired ? emp.id::text then raise exception 'Сотрудник указан дважды'; end if;
    desired := desired || jsonb_build_object(emp.id::text, round(line_amount * 100)::bigint);
    lines_sum := lines_sum + line_amount;
  end loop;
  if lines_sum <> employees then raise exception 'Сумма строк не сходится с итогом расчёта'; end if;

  -- Повтор того же вызова (потеряли ответ, повторили клик): та же постановка, ничего нового.
  select * into existing from public.inventory_deduction_snapshots s where s.id = snap_id;
  if existing.id is not null then
    if existing.account_id <> a or existing.venue_id <> p_venue or existing.month <> p_month then
      raise exception 'Снимок расчёта относится к другому месяцу или заведению';
    end if;
    return jsonb_build_object('posted', false, 'replayed', true, 'snapshot_id', snap_id, 'month', p_month,
      'superseded', exists (select 1 from public.inventory_deduction_snapshots s
                            where s.venue_id = p_venue and s.month = p_month and s.captured_at > existing.captured_at));
  end if;

  select coalesce(jsonb_object_agg(l.employee_id::text, round(abs(l.amount) * 100)::bigint), '{}')
    into live from private.inventory_deduction_live(a, p_venue, p_month) l;
  select s.captured_at, s.reversed_at is null into latest_captured, latest_unreversed
    from public.inventory_deduction_snapshots s
    where s.account_id = a and s.venue_id = p_venue and s.month = p_month
    order by s.captured_at desc limit 1;

  -- Расчёт совпал с уже поставленным: второй клик не задваивает и не сторнирует.
  if live = desired and coalesce(latest_unreversed, false) then
    return jsonb_build_object('posted', false, 'unchanged', true, 'month', p_month);
  end if;

  -- Расчёт, снятый раньше уже поставленного, не затирает более свежий.
  if latest_captured is not null and captured < latest_captured then
    raise exception 'Расчёт устарел: по этому месяцу уже поставлен более свежий';
  end if;

  -- Куда ложатся строки: сам месяц, а если период зафиксирован (или учёт ещё не начат) - ближайший
  -- открытый, но не позже текущего. Закрытый период не вскрываем.
  target := p_month;
  if jsonb_array_length(p_lines) > 0 then
    select ps.starts_on into starts from public.payroll_settings ps where ps.venue_id = p_venue and ps.account_id = a;
    if starts is null then raise exception 'Зарплатная ведомость заведения не настроена'; end if;
    loop
      if target > cur_month then
        raise exception 'Нет открытого зарплатного периода для удержания за %: все месяцы до текущего зафиксированы', to_char(p_month, 'MM.YYYY');
      end if;
      line_date := least((target + interval '1 month' - interval '1 day')::date, today);
      exit when line_date >= starts
        and not exists (select 1 from public.payroll_periods pp where pp.venue_id = p_venue and pp.month = target and pp.status <> 'draft');
      target := (target + interval '1 month')::date;
    end loop;
    displaced := target <> p_month;
    if displaced then
      suffix := ' (период ' || to_char(p_month, 'MM.YYYY') || ' зафиксирован, строка перенесена в ' || to_char(target, 'MM.YYYY') || ')';
    end if;
  end if;

  -- Ключи строк не переиспользуются: ни живая, ни сторнированная строка не воскресает.
  if exists (
    select 1 from public.payroll_adjustments pa
    where pa.account_id = a
      and pa.request_key in (select (e.value->>'request_key')::uuid from jsonb_array_elements(p_lines) e)
  ) then
    raise exception 'Ключ строки уже использован другим расчётом';
  end if;

  -- Дальше идут записи: триггеры ведомости должны видеть исполнителя, а не пустоту.
  prev_claims := private.inventory_deduction_act_as(u);

  -- Сторно прежних строк (ошибка, если они в зафиксированном периоде), затем новые.
  reversed := private.inventory_deduction_reverse(a, p_venue, p_month,
    'Пересчёт удержания по недостаче за ' || to_char(p_month, 'MM.YYYY'), u);

  insert into public.inventory_deduction_snapshots
    (id, account_id, venue_id, month, rule_version_id, captured_at, state, shortage_total, company_total, employees_total, snapshot, created_by)
  values (snap_id, a, p_venue, p_month, rule_id, captured, 'ready', shortage, company, employees,
          coalesce(p_snapshot->'payload', '{}'::jsonb), u);

  for rec in select e.value as line from jsonb_array_elements(p_lines) e loop
    select * into emp from public.payroll_employees pe where pe.id = (rec.line->>'employee_id')::uuid;
    is_inactive := not emp.active;
    line_amount := (rec.line->>'amount')::numeric;
    line_reason := trim(rec.line->>'reason') || suffix;
    adj_id := gen_random_uuid();
    insert into public.payroll_adjustments(
      id, account_id, venue_id, employee_id, business_date, kind, medium, amount, reason,
      approved, created_by, approved_by, managed, origin, rule_snapshot, request_key, external_state, inventory_snapshot_id)
    values (
      adj_id, a, p_venue, emp.id, line_date, 'inventory', 'money', -round(line_amount, 2), line_reason,
      true, u, u, true, 'inventory_deduction',
      jsonb_build_object('kind', 'inventory_deduction', 'snapshot_id', snap_id, 'month', p_month,
        'displaced_from', case when displaced then p_month else null end,
        'inactive', is_inactive, 'pools', coalesce(rec.line->'pools', '[]'::jsonb)),
      (rec.line->>'request_key')::uuid, 'not_required', snap_id);
    out_lines := out_lines || jsonb_build_object('adjustment_id', adj_id, 'employee_id', emp.id,
      'amount', -round(line_amount, 2), 'business_date', line_date);
    if is_inactive then
      out_inactive := out_inactive || jsonb_build_object('employee_id', emp.id, 'name', emp.name, 'amount', -round(line_amount, 2));
    end if;
  end loop;

  insert into public.audit_logs(account_id, venue_id, user_id, action_code, entity_type, entity_id, details)
  values (a, p_venue, u, 'stock.deductions.posted', 'venue', p_venue,
    jsonb_build_object('snapshot_id', snap_id, 'month', p_month, 'target_month', target, 'displaced', displaced,
      'reversed', reversed, 'lines', jsonb_array_length(p_lines), 'employees_total', employees));

  perform private.inventory_deduction_restore(prev_claims);

  return jsonb_build_object('posted', true, 'unchanged', false, 'replayed', false, 'snapshot_id', snap_id,
    'month', p_month, 'target_month', target, 'displaced', displaced, 'reversed', reversed,
    'lines', out_lines, 'inactive', out_inactive);
end;
$$;
-- Только серверный клиент: из браузера суммы, пришедшие от вызывающего, принимать нельзя.
revoke all on function public.post_inventory_deduction(uuid, uuid, date, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.post_inventory_deduction(uuid, uuid, date, jsonb, jsonb) to service_role;

-- 7. Сторно без замены: переоткрытие акта делает месяц снова непосчитанным.
create or replace function public.reverse_inventory_deduction(p_actor uuid, p_venue uuid, p_month date, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  u uuid := p_actor;
  a uuid;
  n integer;
  prev_claims jsonb;
begin
  if u is null or p_venue is null or not private.inventory_deduction_user_can_post(u, p_venue) then
    raise exception 'Нет права ставить удержания по недостаче в этом заведении';
  end if;
  select ve.account_id into a from public.venues ve where ve.id = p_venue and ve.archived_at is null;
  if a is null then raise exception 'Заведение не найдено'; end if;
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception 'Месяц задаётся первым числом, например 2026-10-01';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Укажите причину сторно'; end if;

  perform pg_advisory_xact_lock(hashtextextended('inventory-deduction:' || p_venue::text || ':' || p_month::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_venue::text, 0));

  prev_claims := private.inventory_deduction_act_as(u);
  n := private.inventory_deduction_reverse(a, p_venue, p_month, trim(p_reason), u);
  update public.inventory_deduction_snapshots
     set reversed_at = now()
   where account_id = a and venue_id = p_venue and month = p_month and reversed_at is null;
  if n > 0 then
    insert into public.audit_logs(account_id, venue_id, user_id, action_code, entity_type, entity_id, details)
    values (a, p_venue, u, 'stock.deductions.reversed', 'venue', p_venue,
      jsonb_build_object('month', p_month, 'reversed', n, 'reason', trim(p_reason)));
  end if;
  perform private.inventory_deduction_restore(prev_claims);
  return jsonb_build_object('reversed', n, 'month', p_month);
end;
$$;
revoke all on function public.reverse_inventory_deduction(uuid, uuid, date, text) from public, anon, authenticated;
grant execute on function public.reverse_inventory_deduction(uuid, uuid, date, text) to service_role;

commit;
