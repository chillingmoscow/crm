-- Допродажи: закрытые дни пересчитываются раньше открытого.
--
-- Воркер брал из очереди самый свежий день. Открытый день встаёт в очередь
-- заново с каждой загрузкой чеков (~15 минут) по каждому подразделению, и
-- закрытый вчерашний день с финальной загрузкой часами ждал своей очереди:
-- на экране он оставался «Предварительно», в зарплату не попадал (27.11.2026:
-- 26-е ждало с 08:50 до полудня). Теперь первыми идут дни, рабочий день
-- которых уже закончился, — их результат окончательный и идёт в зарплату;
-- открытый день — следом. Остальное — тело 394 без изменений.

begin;

create or replace function public.sales_claim_upsell_day() returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $$
declare r public.sales_upsell_days;token uuid := gen_random_uuid();rule public.sales_upsell_rules;job uuid;
begin
 select j.* into r from public.sales_upsell_days j
 join public.sales_upsell_departments u on u.department_id = j.department_id
 join public.departments dep on dep.id = j.department_id and dep.venue_id = j.venue_id and dep.archived_at is null
 join public.sales_settings s on s.venue_id = j.venue_id and s.account_id = j.account_id and s.enabled
 where (j.state in ('pending','error') and j.next_retry_at <= now()) or (j.state = 'running' and j.claimed_at < now() - interval '3 minutes')
 order by (private.sales_day_end(j.venue_id, j.business_date) > now()), j.business_date desc, j.next_retry_at, j.id
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

revoke all on function public.sales_claim_upsell_day() from public, anon, authenticated;
grant execute on function public.sales_claim_upsell_day() to service_role;

do $$
begin
 if has_function_privilege('authenticated', 'public.sales_claim_upsell_day()', 'execute')
    or has_function_privilege('anon', 'public.sales_claim_upsell_day()', 'execute') then
  raise exception 'Функция воркера допродаж доступна пользователям';
 end if;
end $$;

commit;
