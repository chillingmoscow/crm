#!/usr/bin/env python3
"""Prepare immutable Statistics snapshots; never modify sales, payroll or money."""
import argparse
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import uuid

HEADERS = ["Дата / Номер месяца", "Дата / Год", "Заведение / ID", "Оборот за месяц / Полный",
 *[f"Оборот по дням недели / {d}" for d in ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"]],
 "Чаевые / Полный", "Питание", "Такси", "ФОТ", "Среднее за смену", "Комментарий", "Продажи / Мастера", "Средний чек",
 "Постоянные гости / Количество", "Постоянные гости / Деньги", "Постоянные гости / %", "Алкоголь / Деньги", "Алкоголь / %",
 "Кальяны / Деньги", "Кальяны / %", "Бар / Деньги", "Бар / %", "Парковка"]
FIELDS = {3:"turnover",11:"tips_total",12:"food",13:"taxi",14:"payroll",15:"perShift",17:"mastersSales",18:"averageCheck",
 19:"regularGuests",20:"regularRevenue",21:"regularShare",22:"alcoholRevenue",23:"alcoholShare",24:"hookah",25:"hookahShare",26:"bar",27:"barShare",28:"parking"}

def prepare(source, legacy_venue):
    if source['headers'] != HEADERS or source['sheet'] != 'Statistics' or source['range'] != 'A1:AC50':
        raise ValueError('Unexpected source headers/range; verify the complete source first')
    dt.datetime.fromisoformat(source['captured_at'].replace('Z','+00:00'))
    rows, months = [], set()
    for index, raw in enumerate(source['rows'], 2):
        if not raw or not any(v is not None and v != '' for v in raw):
            continue
        raw = raw + [None] * (len(HEADERS)-len(raw))
        if raw[2] != legacy_venue:
            raise ValueError(f'Foreign source venue in row {index}')
        if type(raw[0]) is not int or type(raw[1]) is not int or not 2000 <= raw[1] <= 2100:
            raise ValueError(f'Invalid month/year in row {index}')
        month = dt.date(raw[1], raw[0], 1).isoformat()
        if month in months: raise ValueError('Duplicate source month')
        months.add(month)
        warnings = []
        def numeric(column):
            value = raw[column]
            if value is None or value == '': return None
            if type(value) not in (int,float) or not math.isfinite(value):
                warnings.append({'column':HEADERS[column],'raw':value})
                return None
            return value
        metrics = {key:numeric(col) for col,key in FIELDS.items()}
        weekdays = [numeric(i) for i in range(4,11)]
        origin = {'spreadsheet_id':source['spreadsheet_id'],'range':f'Statistics!A{index}:AC{index}',
                  'legacy_venue_id':legacy_venue,'raw_values':raw,'warnings':warnings,
                  'method':'Legacy Glide snapshot; original totals and shares; working-day boundary unverified'}
        content = {'month':month,'metrics':metrics,'weekday_turnover':weekdays,'note':str(raw[16] or ''),'origin':origin}
        content['source_hash'] = hashlib.sha256(json.dumps(content,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
        content['captured_at'] = source['captured_at']
        rows.append(content)
    if not rows: raise ValueError('Empty source snapshot')
    return rows

def literal(value): return "'" + str(value).replace("'", "''") + "'"

def render_sql(rows, target):
    a,v,u = [literal(str(uuid.UUID(target[k]))) for k in ('account_id','venue_id','owner_id')]
    payload = literal(json.dumps(rows,ensure_ascii=False,allow_nan=False)) + '::jsonb'
    digest = f"md5(jsonb_build_object('sales',(select jsonb_agg(to_jsonb(t) order by id) from public.sales_days t where venue_id={v}),'reports',(select jsonb_agg(to_jsonb(t) order by id) from public.sales_month_reports t where venue_id={v}),'transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t where venue_id={v}),'accruals',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_accruals t where venue_id={v}),'adjustments',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_adjustments t where venue_id={v}),'banks',(select jsonb_agg(to_jsonb(t) order by id) from public.bank_accounts t where account_id={a}))::text)"
    return f'''begin;
select set_config('request.jwt.claim.sub',{u},true);
select set_config('app.ctx_ready','0',true);
select pg_advisory_xact_lock(hashtextextended('statistics-archive:'||{v},0));
-- Keep source text outside the PL/pgSQL dollar-quoted body, even if a comment
-- contains the same dollar tag or SQL-looking text.
create temporary table _statistics_archive_input(payload jsonb) on commit drop;
insert into _statistics_archive_input(payload) values({payload});
do $import$ declare r jsonb;old public.sales_statistics_archive;n integer:=0;before_hash text;after_hash text;begin
if public.get_active_account_id() is distinct from {a}::uuid or public.get_active_venue_id() is distinct from {v}::uuid or not public.is_account_owner({a}::uuid) then raise exception 'Wrong owner/scope';end if;
select {digest} into before_hash;
for r in select value from jsonb_array_elements((select payload from pg_temp._statistics_archive_input)) loop
 select * into old from public.sales_statistics_archive where venue_id={v} and month=(r->>'month')::date order by captured_at desc limit 1;
 if found and old.source_hash=r->>'source_hash' then continue;end if;
 if found and old.captured_at>=(r->>'captured_at')::timestamptz then raise exception 'Newer or conflicting snapshot already exists';end if;
 insert into public.sales_statistics_archive(account_id,venue_id,month,metrics,weekday_turnover,note,origin,source_hash,captured_at,imported_by)
 values({a},{v},(r->>'month')::date,r->'metrics',r->'weekday_turnover',r->>'note',r->'origin',r->>'source_hash',(r->>'captured_at')::timestamptz,{u});n:=n+1;
end loop;
if n>0 then insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details)
 values({a},{v},{u},'sales.statistics.archive_imported','venue',{v},jsonb_build_object('months',n,'source','Fees / Statistics','captured_at',(select payload->0->>'captured_at' from pg_temp._statistics_archive_input)));end if;
select {digest} into after_hash;
if before_hash is distinct from after_hash then raise exception 'Sales or financial data changed';end if;
raise notice 'Imported % archive snapshots; sales and financial data unchanged',n;
end $import$;
commit;
'''

if __name__ == '__main__':
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--source',type=Path,required=True);ap.add_argument('--target',type=Path,required=True)
    ap.add_argument('--sql',type=Path,required=True);ap.add_argument('--report',type=Path,required=True)
    args=ap.parse_args();source=json.loads(args.source.read_text());target=json.loads(args.target.read_text())
    rows=prepare(source,target['legacy_venue_id']);args.sql.write_text(render_sql(rows,target))
    report={'months':len(rows),'from':min(r['month'] for r in rows),'through':max(r['month'] for r in rows),
            'warnings':[{'month':r['month'],'fields':r['origin']['warnings']} for r in rows if r['origin']['warnings']]}
    args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False))
