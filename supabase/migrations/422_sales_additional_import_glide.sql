-- Допродажи из прежнего учёта (Glide) — в обычные отчёты допродаж.
--
-- Отдельного «Архива Glide» в интерфейсе больше нет. Дни, которые были только
-- в архиве (на проде — 1–28 октября 2026: отчёты Quick Resto начинаются
-- с 29-го), переносятся в sales_additional_reports как готовые отчёты с
-- теми же суммами, без пересчёта. В запросе отчёта — пометка
-- imported_from = 'glide', ссылка на строку архива и время снимка:
-- по ней экран пишет «перенесено из прежнего учёта».
--
-- Таблица архива остаётся как есть: данные не удаляются.
-- День, у которого уже есть отчёт с показателями, не трогается.
-- Зарплата берёт допродажи напрямую из Quick Resto, этот перенос её не меняет.
-- Плановое обновление пересчитывает только последние три дня; ручное
-- «Обновить» за октябрь пересчитает из Quick Resto только дни, на которые
-- уже действовали правила допродаж (с 16 октября), — это ожидаемо.

begin;

with latest as (
  select distinct on (a.venue_id, a.business_date, a.kind) a.*
    from public.sales_additional_archive a
   order by a.venue_id, a.business_date, a.kind, a.captured_at desc, a.id desc
)
insert into public.sales_additional_reports(
  account_id, venue_id, business_date, kind, request, state, metrics,
  period_start, period_end, synced_at, attempts, next_retry_at
)
select
  a.account_id,
  a.venue_id,
  a.business_date,
  a.kind,
  jsonb_build_object(
    'imported_from', 'glide',
    'archive_id', a.id,
    'captured_at', a.captured_at,
    'rule_id', r.id,
    'rules', r.config,
    'timezone', tz.timezone,
    'hour', tz.hour,
    'start', (extract(epoch from ((a.business_date + make_time(tz.hour, 0, 0)) at time zone tz.timezone)) * 1000)::bigint,
    'end', (extract(epoch from (((a.business_date + 1) + make_time(tz.hour, 0, 0)) at time zone tz.timezone)) * 1000)::bigint - 1
  ),
  'ready',
  a.metrics,
  (a.business_date + make_time(tz.hour, 0, 0)) at time zone tz.timezone,
  ((a.business_date + 1) + make_time(tz.hour, 0, 0)) at time zone tz.timezone - interval '1 millisecond',
  a.captured_at,
  0,
  now()
from latest a
cross join lateral (
  select coalesce(s.timezone, 'Europe/Moscow') as timezone,
         coalesce(s.day_start_hour, 9) as hour
    from (select 1) one
    left join public.sales_settings s on s.venue_id = a.venue_id
) tz
-- Правила для отображения количества: действовавшие на дату, а для дней
-- до первой версии — самые ранние.
cross join lateral (
  select x.id, x.config
    from public.sales_additional_rules x
   where x.venue_id = a.venue_id
   order by (x.valid_from <= a.business_date) desc,
            case when x.valid_from <= a.business_date then x.valid_from end desc nulls last,
            x.valid_from, x.created_at desc, x.id desc
   limit 1
) r
on conflict (venue_id, business_date, kind) do update
  set request = excluded.request,
      state = 'ready',
      metrics = excluded.metrics,
      period_start = excluded.period_start,
      period_end = excluded.period_end,
      synced_at = excluded.synced_at,
      last_error = null,
      attempts = 0,
      lease_token = null,
      claimed_at = null,
      next_retry_at = now()
  where public.sales_additional_reports.metrics is null;

-- Каждый день архива теперь есть среди обычных отчётов с показателями
-- (кроме заведений без правил допродаж — им нечем показать количества).
do $check$
declare missing integer;
begin
  select count(*) into missing
    from public.sales_additional_archive a
   where exists (select 1 from public.sales_additional_rules x where x.venue_id = a.venue_id)
     and not exists (
       select 1 from public.sales_additional_reports r
        where r.venue_id = a.venue_id and r.business_date = a.business_date
          and r.kind = a.kind and r.metrics is not null
     );
  if missing > 0 then
    raise exception 'Не перенесено дней допродаж из Glide: %', missing;
  end if;
end
$check$;

commit;
