-- Допродажи: предварительный расчёт открытого дня (поверх 380).
--
-- Раньше день подразделения считался только по загрузке чеков, созданной
-- после конца рабочего дня. Чеки открытого дня «Смены» подтягивают каждые
-- ~15 минут, поэтому день теперь считается и в течение смены — по последней
-- успешной загрузке — и помечается provisional. После конца дня принимается
-- только финальная загрузка (как в 380): день пересчитывается окончательно,
-- provisional снимается. Зарплата предварительные дни не учитывает.

begin;

alter table public.sales_upsell_days add column provisional boolean not null default false;

-- Конец рабочего дня заведения: следующие сутки, час начала дня.
create function private.sales_day_end(p_venue uuid, p_date date) returns timestamptz
language sql stable set search_path = public, pg_catalog as $$
 select ((p_date + 1)::timestamp + make_interval(hours => s.day_start_hour)) at time zone s.timezone
 from public.sales_settings s where s.venue_id = p_venue
$$;

-- Загрузка чеков для расчёта дня. Пока день идёт — последняя успешная
-- (предварительный расчёт). После конца дня — только созданная не раньше
-- конца дня: промежуточная загрузка видит не все чеки (см. 380).
create or replace function private.sales_upsell_job_for(p_venue uuid, p_date date) returns uuid
language sql stable set search_path = public, pg_catalog as $$
 select j.id from public.sales_sync_jobs j
 cross join (select private.sales_day_end(p_venue, p_date) as day_end) e
 where j.venue_id = p_venue and j.business_date = p_date and j.status = 'success'
  and (j.created_at >= e.day_end or now() < e.day_end)
 order by j.finished_at desc nulls last, j.created_at desc, j.id desc limit 1
$$;

-- Загрузка создана до конца дня: результат по ней предварительный.
create function private.sales_upsell_job_provisional(p_job uuid) returns boolean
language sql stable set search_path = public, pg_catalog as $$
 select coalesce((select j.created_at < private.sales_day_end(j.venue_id, j.business_date)
  from public.sales_sync_jobs j where j.id = p_job), false)
$$;

-- Ставит день подразделения в очередь. 0 — день ещё не начался, версии на
-- день нет, загрузки чеков нет (кроме принудительного пересчёта) или
-- пересчитывать нечего. Текущий день тоже ставится — предварительно.
create or replace function private.sales_request_upsell_day(p_department uuid, p_date date, p_force boolean) returns integer
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
 if p_date > cutoff then return 0;end if;
 rule := private.sales_upsell_rule_for(p_department, p_date);
 if rule is null then return 0;end if;
 job := private.sales_upsell_job_for(s.venue_id, p_date);
 -- День закрылся, финальной загрузки ещё нет: предварительный результат
 -- остаётся на экране, пока она не появится.
 if job is null and not p_force then return 0;end if;
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

create or replace function public.sales_schedule_upsell_days() returns integer
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
  -- 7 закрытых дней (окно перепроверки чеков «Смен») и текущий день.
  for d in select generate_series(cutoff - 7, cutoff, interval '1 day')::date loop
   if exists (select 1 from public.sales_upsell_rules r where r.department_id = s.department_id and r.valid_from <= d) then
    n := n + private.sales_request_upsell_day(s.department_id, d, false);
   end if;
  end loop;
 end loop;
 return n;
end $$;

-- Захват дня воркером: как в 380, плюс признак предварительной загрузки —
-- воркер не ставит зарплату по предварительному дню.
create or replace function public.sales_claim_upsell_day() returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $$
declare r public.sales_upsell_days;token uuid := gen_random_uuid();rule public.sales_upsell_rules;job uuid;
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
 job := private.sales_upsell_job_for(r.venue_id, r.business_date);
 return jsonb_build_object('id', r.id, 'account_id', r.account_id, 'venue_id', r.venue_id, 'department_id', r.department_id,
  'date', r.business_date, 'rule_id', rule.id, 'lines', rule.lines,
  'job_id', job, 'provisional', private.sales_upsell_job_provisional(job), 'lease_token', token);
end $$;

-- Фиксация: тело 380 без изменений, кроме признака provisional по загрузке.
create or replace function public.sales_commit_upsell_day(p_id uuid, p_lease uuid, p_job uuid, p_catalog_at timestamptz, p_result jsonb) returns boolean
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

 update public.sales_upsell_days set result = p_result, job_id = p_job, catalog_at = p_catalog_at, computed_at = now(), state = 'ready', last_error = null,
  provisional = private.sales_upsell_job_provisional(p_job)
 where id = r.id;
 return true;
end $$;

revoke all on function private.sales_day_end(uuid, date) from public, anon, authenticated;
revoke all on function private.sales_upsell_job_provisional(uuid) from public, anon, authenticated;
revoke all on function private.sales_upsell_job_for(uuid, date) from public, anon, authenticated;
revoke all on function private.sales_request_upsell_day(uuid, date, boolean) from public, anon, authenticated;
revoke all on function public.sales_schedule_upsell_days() from public, anon, authenticated;
revoke all on function public.sales_claim_upsell_day() from public, anon, authenticated;
revoke all on function public.sales_commit_upsell_day(uuid, uuid, uuid, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.sales_schedule_upsell_days() to service_role;
grant execute on function public.sales_claim_upsell_day() to service_role;
grant execute on function public.sales_commit_upsell_day(uuid, uuid, uuid, timestamptz, jsonb) to service_role;

do $$
begin
 if has_function_privilege('authenticated', 'public.sales_claim_upsell_day()', 'execute')
    or has_function_privilege('anon', 'public.sales_commit_upsell_day(uuid, uuid, uuid, timestamptz, jsonb)', 'execute')
    or has_function_privilege('authenticated', 'public.sales_schedule_upsell_days()', 'execute') then
  raise exception 'Функции воркера допродаж доступны пользователям';
 end if;
end $$;

commit;
