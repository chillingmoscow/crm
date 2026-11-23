-- Допродажи: правила по подразделениям и расчёт дня по чекам «Смен».
--
-- Новая схема живёт рядом со старой очередью отчётов Quick Resto (283):
--   * sales_upsell_departments — какие подразделения заведения участвуют в
--     допродажах; legacy_kind связывает «Бар»/«Кальяны» со старыми видами
--     отчётов; version — защита редактора от устаревших правок.
--   * sales_upsell_rules — версии правил подразделения: строки «цель → ставка
--     за штуку» (блюдо, категория блюд, модификатор, группа модификаторов).
--   * sales_upsell_days — очередь и результат дня по подразделению. День
--     считается по чекам последней успешной загрузки «Смен» (sales_sync_jobs)
--     и пересчитывается, когда появилась новая загрузка, сменилась версия
--     правил или обновилась номенклатура при позициях «не из номенклатуры».
--
-- Запись — только через RPC: сохранение версии (authenticated) и
-- захват/фиксация/ошибка дня (service_role, воркер).

begin;

-- ── Таблицы ──────────────────────────────────────────────────

create table public.sales_upsell_departments (
 department_id uuid primary key references public.departments(id),
 account_id uuid not null,
 venue_id uuid not null,
 legacy_kind text check (legacy_kind in ('bar','masters')),
 version integer not null default 1 check (version > 0),
 created_at timestamptz not null default now(),
 unique (venue_id, legacy_kind),
 unique (account_id, venue_id, department_id),
 foreign key (account_id, venue_id) references public.venues(account_id, id)
);

create table public.sales_upsell_rules (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null,
 venue_id uuid not null,
 department_id uuid not null,
 valid_from date not null,
 lines jsonb not null check (jsonb_typeof(lines) = 'array'),
 reason text not null,
 created_at timestamptz not null default now(),
 created_by uuid references public.profiles(id),
 unique (department_id, id),
 foreign key (account_id, venue_id, department_id) references public.sales_upsell_departments(account_id, venue_id, department_id)
);
create index sales_upsell_rules_version on public.sales_upsell_rules(department_id, valid_from desc, created_at desc, id);
create index sales_upsell_rules_scope on public.sales_upsell_rules(account_id, venue_id, department_id);
create index sales_upsell_rules_author on public.sales_upsell_rules(created_by);

create table public.sales_upsell_days (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null,
 venue_id uuid not null,
 department_id uuid not null,
 business_date date not null,
 rule_id uuid not null,
 job_id uuid,
 state text not null default 'pending' check (state in ('pending','running','ready','error')),
 result jsonb,
 computed_at timestamptz,
 catalog_at timestamptz,
 last_error text,
 lease_token uuid,
 claimed_at timestamptz,
 attempts integer not null default 0,
 next_retry_at timestamptz not null default now(),
 unique (department_id, business_date),
 foreign key (account_id, venue_id, department_id) references public.sales_upsell_departments(account_id, venue_id, department_id),
 foreign key (department_id, rule_id) references public.sales_upsell_rules(department_id, id)
);
create index sales_upsell_days_scope on public.sales_upsell_days(account_id, venue_id, department_id, business_date desc);
create index sales_upsell_days_rule on public.sales_upsell_days(department_id, rule_id);
create index sales_upsell_days_queue on public.sales_upsell_days(next_retry_at) where state in ('pending','running','error');

-- «Последняя успешная загрузка дня» ищется на каждый день очереди.
create index sales_sync_jobs_success_day on public.sales_sync_jobs(venue_id, business_date, finished_at desc nulls last) where status = 'success';

-- ── RLS: чтение как у sales_additional_read (283), запись только через RPC ──

do $$
declare t text;
begin
 foreach t in array array['sales_upsell_departments','sales_upsell_rules','sales_upsell_days'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
  execute format('grant select on public.%I to authenticated, service_role', t);
  execute format('create policy sales_upsell_read on public.%I for select to authenticated using (account_id = (select public.get_active_account_id()) and venue_id = (select public.get_active_venue_id()) and (select public.has_permission(''sales.view_shifts'')))', t);
 end loop;
end $$;

-- ── Помощники ────────────────────────────────────────────────

-- Строки версии правил. Элемент: {target, external_id, name, rate};
-- до 500 строк, пара target+external_id не повторяется.
create function private.sales_validate_upsell_lines(p jsonb) returns void
language plpgsql immutable set search_path = public, pg_catalog as $$
declare l jsonb;n numeric;k text;seen text[]:='{}';
begin
 if p is null or jsonb_typeof(p) <> 'array' then raise exception 'Проверьте строки правил допродаж';end if;
 if jsonb_array_length(p) > 500 then raise exception 'В версии правил допродаж не больше 500 строк';end if;
 for l in select value from jsonb_array_elements(p) loop
  if jsonb_typeof(l) <> 'object' then raise exception 'Проверьте строки правил допродаж';end if;
  if not l ?& array['target','external_id','name','rate'] or l - array['target','external_id','name','rate'] <> '{}'::jsonb
     or jsonb_typeof(l->'target') <> 'string' or jsonb_typeof(l->'external_id') <> 'string'
     or jsonb_typeof(l->'name') <> 'string' or jsonb_typeof(l->'rate') <> 'number' then
   raise exception 'Проверьте строки правил допродаж';
  end if;
  if l->>'target' not in ('dish','dish_group','modifier','modifier_group') then
   raise exception 'В правилах допродаж можно выбрать блюдо, категорию блюд, модификатор или группу модификаторов';
  end if;
  if (l->>'external_id') !~ '^[0-9]+$' then raise exception 'Некорректный код позиции в правилах допродаж';end if;
  if length(trim(l->>'name')) not between 1 and 200 then raise exception 'Название позиции в правилах допродаж — от 1 до 200 символов';end if;
  n := (l->>'rate')::numeric;
  if n < 0 or n > 1000000 or n <> round(n, 2) then raise exception 'Некорректная ставка допродаж';end if;
  k := (l->>'target') || ':' || (l->>'external_id');
  if k = any(seen) then raise exception 'Позиция повторяется в правилах допродаж';end if;
  seen := array_append(seen, k);
 end loop;
end $$;

-- Актуальная версия правил подразделения на день.
create function private.sales_upsell_rule_for(p_department uuid, p_date date) returns uuid
language sql stable set search_path = public, pg_catalog as $$
 select id from public.sales_upsell_rules
 where department_id = p_department and valid_from <= p_date
 order by valid_from desc, created_at desc, id desc limit 1
$$;

-- Последняя успешная загрузка чеков ЗАВЕРШЁННОГО дня («Смены»). Загрузка берёт
-- чеки до момента своего создания (salesSource: конец окна = min(конец дня,
-- created_at)), поэтому промежуточная загрузка, созданная до конца рабочего
-- дня, видит не все чеки — хотя её статус тоже 'success'. Принимается только
-- загрузка, созданная не раньше конца дня: она же фиксирует день как
-- 'complete' (проверка закрытых кассовых смен в sales/sync.ts). Запрос дня,
-- захват и фиксация зовут эту функцию — выбор job у них общий.
create function private.sales_upsell_job_for(p_venue uuid, p_date date) returns uuid
language sql stable set search_path = public, pg_catalog as $$
 select j.id from public.sales_sync_jobs j
 join public.sales_settings s on s.venue_id = j.venue_id
 where j.venue_id = p_venue and j.business_date = p_date and j.status = 'success'
  and j.created_at >= ((p_date + 1)::timestamp + make_interval(hours => s.day_start_hour)) at time zone s.timezone
 order by j.finished_at desc nulls last, j.created_at desc, j.id desc limit 1
$$;

-- ── Сохранение версии правил ─────────────────────────────────

create function public.sales_save_upsell_rules(p_expected_venue uuid, p_department uuid, p_version integer, p_from date, p_lines jsonb, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare a uuid := public.get_active_account_id();v uuid := public.get_active_venue_id();dep_name text;s public.sales_upsell_departments;r uuid;cutoff date;reason text := trim(p_reason);
begin
 if auth.uid() is null or a is null or v is null or not public.has_permission('sales.configure_shifts') or not public.has_permission('sales.view_shifts') then
  raise exception 'Нет доступа к правилам допродаж';
 end if;
 if v is distinct from p_expected_venue then raise exception 'Заведение изменилось. Обновите страницу';end if;
 select d.name into dep_name from public.departments d join public.venues w on w.id = d.venue_id
 where d.id = p_department and d.venue_id = v and w.account_id = a and d.archived_at is null;
 if not found then raise exception 'Подразделение недоступно. Обновите страницу';end if;
 select ((now() at time zone timezone) - make_interval(hours => day_start_hour))::date into cutoff from public.sales_settings where account_id = a and venue_id = v;
 if p_from is null or cutoff is null or p_from <= cutoff or p_from > cutoff + 366 then raise exception 'Новые правила можно назначить со следующего рабочего дня';end if;
 if coalesce(length(reason), 0) not between 3 and 1000 then raise exception 'Укажите причину изменения';end if;
 perform private.sales_validate_upsell_lines(p_lines);
 select * into s from public.sales_upsell_departments where department_id = p_department for update;
 if found then
  if s.account_id <> a or s.venue_id <> v then raise exception 'Подразделение недоступно. Обновите страницу';end if;
  if p_version is distinct from s.version then raise exception 'Правила изменились. Обновите страницу';end if;
  update public.sales_upsell_departments set version = version + 1 where department_id = p_department;
 else
  -- Подразделение ещё не участвует: редактор видел «версий нет» (0 или null).
  if coalesce(p_version, 0) <> 0 then raise exception 'Правила изменились. Обновите страницу';end if;
  insert into public.sales_upsell_departments(department_id, account_id, venue_id) values (p_department, a, v) on conflict do nothing;
  if not found then raise exception 'Правила изменились. Обновите страницу';end if;
 end if;
 insert into public.sales_upsell_rules(account_id, venue_id, department_id, valid_from, lines, reason, created_by)
 values (a, v, p_department, p_from, p_lines, reason, auth.uid()) returning id into r;
 insert into public.audit_logs(account_id, venue_id, user_id, action_code, entity_type, entity_id, details)
 values (a, v, auth.uid(), 'sales.additional_rules.updated', 'sales_additional_rules', r,
  jsonb_build_object('department_id', p_department, 'department_name', dep_name, 'valid_from', p_from, 'reason', reason, 'lines', p_lines));
 return r;
end $$;

-- ── Очередь дня ──────────────────────────────────────────────

-- Ставит день подразделения в очередь. 0 — день не закрыт, версии на день
-- нет или пересчитывать нечего. Строка в работе (running) перезапускается
-- только принудительно: смену версии или загрузки отловит фиксация.
create function private.sales_request_upsell_day(p_department uuid, p_date date, p_force boolean) returns integer
language plpgsql set search_path = public, pg_catalog as $$
declare s record;cutoff date;rule uuid;job uuid;n integer;
begin
 if p_date is null or extract(year from p_date) not between 2000 and 2100 then raise exception 'Проверьте дату смены';end if;
 select u.department_id, u.account_id, u.venue_id, q.timezone, q.day_start_hour into s
 from public.sales_upsell_departments u
 join public.departments dep on dep.id = u.department_id and dep.venue_id = u.venue_id and dep.archived_at is null
 join public.sales_settings q on q.venue_id = u.venue_id and q.account_id = u.account_id and q.enabled
 where u.department_id = p_department;
 if not found then raise exception 'Допродажи подразделения ещё не настроены';end if;
 cutoff := ((now() at time zone s.timezone) - make_interval(hours => s.day_start_hour))::date;
 if p_date >= cutoff then return 0;end if;
 rule := private.sales_upsell_rule_for(p_department, p_date);
 if rule is null then return 0;end if;
 job := private.sales_upsell_job_for(s.venue_id, p_date);
 insert into public.sales_upsell_days as x (account_id, venue_id, department_id, business_date, rule_id, job_id)
 values (s.account_id, s.venue_id, p_department, p_date, rule, job)
 on conflict (department_id, business_date) do update set
  rule_id = excluded.rule_id, job_id = excluded.job_id,
  -- результат другой версии правил рядом с новым rule_id не оставляем
  result = case when x.rule_id = excluded.rule_id then x.result end,
  computed_at = case when x.rule_id = excluded.rule_id then x.computed_at end,
  catalog_at = case when x.rule_id = excluded.rule_id then x.catalog_at end,
  state = 'pending', lease_token = null, claimed_at = null, attempts = 0, next_retry_at = now(), last_error = null
 where p_force or (x.state in ('ready','error') and (
  x.rule_id is distinct from excluded.rule_id
  or x.job_id is distinct from excluded.job_id
  or (coalesce(x.result->'unknown', '[]'::jsonb) <> '[]'::jsonb
      and (select max(i.synced_at) from public.ingredients i where i.account_id = s.account_id) > coalesce(x.catalog_at, '-infinity'::timestamptz))));
 get diagnostics n = row_count;
 return n;
end $$;

create function public.sales_schedule_upsell_days() returns integer
language plpgsql security definer set search_path = public, pg_catalog as $$
declare s record;d date;cutoff date;n integer := 0;
begin
 for s in
  select u.department_id, q.timezone, q.day_start_hour
  from public.sales_upsell_departments u
  join public.departments dep on dep.id = u.department_id and dep.venue_id = u.venue_id and dep.archived_at is null
  join public.sales_settings q on q.venue_id = u.venue_id and q.account_id = u.account_id and q.enabled
 loop
  cutoff := ((now() at time zone s.timezone) - make_interval(hours => s.day_start_hour))::date;
  for d in select generate_series(cutoff - 3, cutoff - 1, interval '1 day')::date loop
   if exists (select 1 from public.sales_upsell_rules r where r.department_id = s.department_id and r.valid_from <= d) then
    n := n + private.sales_request_upsell_day(s.department_id, d, false);
   end if;
  end loop;
 end loop;
 return n;
end $$;

-- «Обновить отчёты» за месяц: старая очередь (283, поведение 377) и дни
-- участвующих подразделений. Старый цикл — только если у заведения настроены
-- источники старых отчётов; без них и без подразделений — прежняя ошибка.
create or replace function public.sales_request_additional_month(p_month date, p_expected_venue uuid) returns integer
language plpgsql security definer set search_path = public, pg_catalog as $$
declare a uuid := public.get_active_account_id();v uuid := public.get_active_venue_id();d date;n integer := 0;dep uuid;deps uuid[];legacy boolean;
begin
 if auth.uid() is null or not public.has_permission('sales.sync_shifts') or not public.has_permission('sales.view_shifts') then raise exception 'Нет доступа к обновлению допродаж';end if;
 if v is distinct from p_expected_venue then raise exception 'Заведение изменилось. Обновите страницу';end if;
 if p_month is null or extract(day from p_month) <> 1 or extract(year from p_month) not between 2000 and 2100 then raise exception 'Проверьте месяц';end if;
 legacy := exists (select 1 from public.sales_additional_sources c where c.venue_id = v and c.enabled);
 select coalesce(array_agg(u.department_id order by u.department_id), '{}') into deps
 from public.sales_upsell_departments u
 join public.departments x on x.id = u.department_id and x.venue_id = u.venue_id and x.archived_at is null
 where u.venue_id = v and u.account_id = a;
 if not legacy and cardinality(deps) = 0 then raise exception 'Источники допродаж ещё не настроены';end if;
 for d in select generate_series(p_month, p_month + interval '1 month' - interval '1 day', interval '1 day')::date loop
  if legacy then n := n + private.sales_request_additional_day(v, d, true);end if;
  foreach dep in array deps loop n := n + private.sales_request_upsell_day(dep, d, true);end loop;
 end loop;
 if n > 0 then
  insert into public.audit_logs(account_id, venue_id, user_id, action_code, entity_type, entity_id, details)
  values (a, v, auth.uid(), 'sales.additional.refresh_requested', 'sales_settings', v, jsonb_build_object('month', p_month, 'reports', n));
 end if;
 return n;
end $$;

-- ── Воркер: захват, фиксация, ошибка ─────────────────────────

create function public.sales_claim_upsell_day() returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $$
declare r public.sales_upsell_days;token uuid := gen_random_uuid();rule public.sales_upsell_rules;
begin
 select j.* into r from public.sales_upsell_days j
 join public.sales_upsell_departments u on u.department_id = j.department_id
 join public.departments dep on dep.id = j.department_id and dep.venue_id = j.venue_id and dep.archived_at is null
 join public.sales_settings s on s.venue_id = j.venue_id and s.account_id = j.account_id and s.enabled
 where (j.state in ('pending','error') and j.next_retry_at <= now()) or (j.state = 'running' and j.claimed_at < now() - interval '3 minutes')
 order by j.business_date desc, j.next_retry_at, j.id
 for update of j skip locked limit 1;
 if not found then return null;end if;
 -- Версии не удаляются, поэтому актуальная версия на день всегда есть.
 select * into rule from public.sales_upsell_rules where id = coalesce(private.sales_upsell_rule_for(r.department_id, r.business_date), r.rule_id);
 update public.sales_upsell_days set
  state = 'running', lease_token = token, claimed_at = now(), attempts = attempts + 1, last_error = null,
  rule_id = rule.id,
  result = case when rule_id = rule.id then result end,
  computed_at = case when rule_id = rule.id then computed_at end,
  catalog_at = case when rule_id = rule.id then catalog_at end
 where id = r.id;
 return jsonb_build_object('id', r.id, 'account_id', r.account_id, 'venue_id', r.venue_id, 'department_id', r.department_id,
  'date', r.business_date, 'rule_id', rule.id, 'lines', rule.lines,
  'job_id', private.sales_upsell_job_for(r.venue_id, r.business_date), 'lease_token', token);
end $$;

-- Результат дня (задача 5, countUpsellDay): {bonus, lines, paid, unknown}.
-- Отклоняется, если после захвата сменилась актуальная версия правил или
-- последняя успешная загрузка чеков дня.
create function public.sales_commit_upsell_day(p_id uuid, p_lease uuid, p_job uuid, p_catalog_at timestamptz, p_result jsonb) returns boolean
language plpgsql security definer set search_path = public, pg_catalog as $$
declare r public.sales_upsell_days;keys text[];seen text[] := '{}';x jsonb;k text;val jsonb;
begin
 select * into r from public.sales_upsell_days where id = p_id for update;
 if not found or p_lease is distinct from r.lease_token then return false;end if;
 -- Потерянный ответ: повтор той же фиксации подтверждается без записи.
 if r.state = 'ready' then return r.result is not distinct from p_result and r.job_id is not distinct from p_job;end if;
 if r.state <> 'running' then return false;end if;
 if p_job is null then raise exception 'Не указана загрузка чеков дня';end if;
 if private.sales_upsell_rule_for(r.department_id, r.business_date) is distinct from r.rule_id
    or private.sales_upsell_job_for(r.venue_id, r.business_date) is distinct from p_job then
  update public.sales_upsell_days set state = 'error', last_error = 'Правила или чеки дня изменились. Посчитаем заново.', next_retry_at = now() where id = r.id;
  return false;
 end if;

 if p_result is null or jsonb_typeof(p_result) <> 'object' then raise exception 'Некорректный результат допродаж';end if;
 if not p_result ?& array['bonus','lines','paid','unknown'] or p_result - array['bonus','lines','paid','unknown'] <> '{}'::jsonb
    or jsonb_typeof(p_result->'bonus') <> 'number' or jsonb_typeof(p_result->'lines') <> 'array'
    or jsonb_typeof(p_result->'paid') <> 'object' or jsonb_typeof(p_result->'unknown') <> 'array' then
  raise exception 'Некорректный результат допродаж';
 end if;
 if (p_result->>'bonus')::numeric < 0 or abs((p_result->>'bonus')::numeric) > 1e12 or (p_result->>'bonus')::numeric <> round((p_result->>'bonus')::numeric) then
  raise exception 'Некорректная прибавка допродаж';
 end if;

 select coalesce(array_agg((l->>'target') || ':' || (l->>'external_id')), '{}') into keys
 from public.sales_upsell_rules, jsonb_array_elements(lines) l where id = r.rule_id;
 for x in select value from jsonb_array_elements(p_result->'lines') loop
  if jsonb_typeof(x) <> 'object' then raise exception 'Некорректная строка результата допродаж';end if;
  if not x ?& array['key','quantity','amount'] or x - array['key','quantity','amount'] <> '{}'::jsonb
     or jsonb_typeof(x->'key') <> 'string' or jsonb_typeof(x->'quantity') <> 'number' or jsonb_typeof(x->'amount') <> 'number' then
   raise exception 'Некорректная строка результата допродаж';
  end if;
  if (x->>'quantity')::numeric < 0 or (x->>'amount')::numeric < 0 or abs((x->>'quantity')::numeric) > 1e12 or abs((x->>'amount')::numeric) > 1e12 then raise exception 'Некорректная строка результата допродаж';end if;
  k := x->>'key';
  if k = any(seen) or not k = any(keys) then raise exception 'Строки результата не совпадают с правилами допродаж';end if;
  seen := array_append(seen, k);
 end loop;
 if cardinality(seen) <> cardinality(keys) then raise exception 'Неполный набор строк результата допродаж';end if;

 for k, val in select * from jsonb_each(p_result->'paid') loop
  if jsonb_typeof(val) <> 'string' then raise exception 'Некорректный результат допродаж';end if;
 end loop;
 for x in select value from jsonb_array_elements(p_result->'unknown') loop
  if jsonb_typeof(x) <> 'object' then raise exception 'Некорректный результат допродаж';end if;
  if not x ?& array['key','quantity'] or x - array['key','quantity'] <> '{}'::jsonb
     or jsonb_typeof(x->'key') <> 'string' or jsonb_typeof(x->'quantity') <> 'number' then
   raise exception 'Некорректный результат допродаж';
  end if;
  if (x->>'quantity')::numeric < 0 or abs((x->>'quantity')::numeric) > 1e12 then raise exception 'Некорректный результат допродаж';end if;
 end loop;

 update public.sales_upsell_days set result = p_result, job_id = p_job, catalog_at = p_catalog_at, computed_at = now(), state = 'ready', last_error = null where id = r.id;
 return true;
end $$;

create function public.sales_fail_upsell_day(p_id uuid, p_lease uuid, p_error text) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare r public.sales_upsell_days;
begin
 select * into r from public.sales_upsell_days where id = p_id and lease_token = p_lease and state = 'running' for update;
 if not found then return;end if;
 update public.sales_upsell_days set state = 'error', last_error = left(coalesce(nullif(trim(p_error), ''), 'Не удалось посчитать допродажи'), 300),
  next_retry_at = now() + make_interval(secs => least(3600, 60 * power(2, least(attempts, 6))::integer))
 where id = r.id;
end $$;

-- ── Права на функции ─────────────────────────────────────────

revoke all on function private.sales_validate_upsell_lines(jsonb) from public, anon, authenticated;
revoke all on function private.sales_upsell_rule_for(uuid, date) from public, anon, authenticated;
revoke all on function private.sales_upsell_job_for(uuid, date) from public, anon, authenticated;
revoke all on function private.sales_request_upsell_day(uuid, date, boolean) from public, anon, authenticated;

revoke all on function public.sales_save_upsell_rules(uuid, uuid, integer, date, jsonb, text) from public, anon;
grant execute on function public.sales_save_upsell_rules(uuid, uuid, integer, date, jsonb, text) to authenticated;
revoke all on function public.sales_request_additional_month(date, uuid) from public, anon;
grant execute on function public.sales_request_additional_month(date, uuid) to authenticated;

revoke all on function public.sales_schedule_upsell_days() from public, anon, authenticated;
revoke all on function public.sales_claim_upsell_day() from public, anon, authenticated;
revoke all on function public.sales_commit_upsell_day(uuid, uuid, uuid, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.sales_fail_upsell_day(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.sales_schedule_upsell_days() to service_role;
grant execute on function public.sales_claim_upsell_day() to service_role;
grant execute on function public.sales_commit_upsell_day(uuid, uuid, uuid, timestamptz, jsonb) to service_role;
grant execute on function public.sales_fail_upsell_day(uuid, uuid, text) to service_role;

-- ── Данные: «Бар» и «Кальяны» заведений со старыми отчётами ──

insert into public.sales_upsell_departments(department_id, account_id, venue_id, legacy_kind)
select d.id, c.account_id, c.venue_id, k.kind
from public.sales_additional_sources c
join (values ('Бар', 'bar'), ('Кальяны', 'masters')) as k(name, kind) on true
join public.departments d on d.venue_id = c.venue_id and d.name = k.name and d.archived_at is null
on conflict do nothing;

-- ── Проверка привилегий (REVOKE от не-владельца молча ничего не делает) ──

do $$
declare f text;r text;t text;p text;
begin
 foreach f in array array[
  'private.sales_validate_upsell_lines(jsonb)', 'private.sales_upsell_rule_for(uuid,date)', 'private.sales_upsell_job_for(uuid,date)',
  'private.sales_request_upsell_day(uuid,date,boolean)', 'public.sales_schedule_upsell_days()', 'public.sales_claim_upsell_day()',
  'public.sales_commit_upsell_day(uuid,uuid,uuid,timestamptz,jsonb)', 'public.sales_fail_upsell_day(uuid,uuid,text)'] loop
  foreach r in array array['anon','authenticated'] loop
   if has_function_privilege(r, f, 'execute') then raise exception '% не должен вызывать %', r, f;end if;
  end loop;
 end loop;
 foreach f in array array['public.sales_save_upsell_rules(uuid,uuid,integer,date,jsonb,text)', 'public.sales_request_additional_month(date,uuid)'] loop
  if has_function_privilege('anon', f, 'execute') then raise exception 'anon не должен вызывать %', f;end if;
  if not has_function_privilege('authenticated', f, 'execute') then raise exception 'authenticated должен вызывать %', f;end if;
 end loop;
 foreach t in array array['public.sales_upsell_departments','public.sales_upsell_rules','public.sales_upsell_days'] loop
  foreach p in array array['insert','update','delete','truncate'] loop
   foreach r in array array['anon','authenticated','service_role'] loop
    if has_table_privilege(r, t, p) then raise exception '% не должен писать в % (%)', r, t, p;end if;
   end loop;
  end loop;
  if has_table_privilege('anon', t, 'select') then raise exception 'anon не должен читать %', t;end if;
 end loop;
end $$;

commit;
