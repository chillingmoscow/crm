"""Import source facts, not salary deductions or money. Private inputs stay outside Git."""
import argparse
import hashlib
import json
import math
import re
import uuid
from datetime import datetime,timedelta,timezone
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlparse

HEADERS=['Дата','Наименование','Недостача','Сумма / Всего','Должность / Сотрудник','Удаление / Статус','Удаление / Дата','Удаление / Ответственный','Удаление / Причина','№ акта','Ссылка','Категория','Тип','Заведение / ID','Row ID','Дата / Месяц','Сумма списаний']
def canonical(v):return json.dumps(v,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False)
def digest(v):return hashlib.sha256(canonical(v).encode()).hexdigest()
def capture(v):
 d=datetime.fromisoformat(v.replace('Z','+00:00'))
 if d.tzinfo is None:raise ValueError('Source capture needs timezone')
 return d.astimezone(timezone.utc).isoformat()
def num(v):
 if v in ('',None):return None
 if isinstance(v,bool) or not isinstance(v,(int,float,str)) or isinstance(v,str) and not re.fullmatch(r'-?\d+(?:\.\d+)?',v):return None
 d=Decimal(str(v))
 if not d.is_finite() or abs(d)>10**12:raise ValueError('Invalid source amount')
 return int(d) if d==d.to_integral_value() else float(d)
def text(v):return str(v).strip() if v is not None else ''
def cell(v,i):return v[i] if i<len(v) else None
def prepare(source,target):
 sheet=source['sheets']['Invent'];at=capture(source['captured_at'])
 if sheet['values'][0]!=HEADERS:raise ValueError('Invent headers changed')
 rows=[];seen=set()
 for n,r in enumerate(sheet['values'][1:],2):
  if not r or all(v is None or v=='' for v in r):continue
  if cell(r,13)!=target['legacy_venue_id']:raise ValueError('Foreign source venue')
  ref=text(cell(r,14))
  if not ref or len(ref)>200 or ref in seen:raise ValueError('Missing/duplicate source row ID')
  seen.add(ref);serial=cell(r,0)
  if isinstance(serial,bool) or not isinstance(serial,(int,float)) or not math.isfinite(serial) or serial!=int(serial):raise ValueError('Ambiguous source date')
  date=(datetime(1899,12,30)+timedelta(days=serial)).date()
  if not 2000<=date.year<=2100 or num(cell(r,15))!=date.month:raise ValueError('Source date/month mismatch')
  deleted=cell(r,5)
  if deleted not in (None,'') and not isinstance(deleted,bool):raise ValueError('Unknown deletion flag')
  issues=[];total=num(cell(r,3))
  if total is None:issues.append('В источнике нет корректной суммы')
  href=text(cell(r,10)) or None
  if href:
   u=urlparse(href)
   if u.scheme!='https' or u.username or u.password or not re.fullmatch(r'[-a-z0-9]+\.quickresto\.ru',u.hostname or ''):raise ValueError('Unsafe source link')
  quantity=cell(r,2)
  if isinstance(quantity,(int,float)) and not isinstance(quantity,bool):quantity=format(Decimal(str(quantity)).normalize(),'f')
  else:quantity=text(quantity) or None
  origin={'spreadsheet_id':source['spreadsheet_id'],'range':f'Invent!A{n}:Q{n}','raw':dict(zip(HEADERS,r))}
  item={'business_date':date.isoformat(),'legacy_ref':ref,'name':text(cell(r,1)),'quantity':quantity,'total':total,'correspondent':text(cell(r,4)),'kind':text(cell(r,12)),'document_number':text(cell(r,9)) or None,'document_url':href,'category':text(cell(r,11)) or None,'deleted':bool(deleted),'delete_reason':text(cell(r,8)) or None,'period_total_raw':num(cell(r,16)),'issues':issues,'origin':origin}
  if not item['name'] or not item['correspondent'] or item['kind'] not in ('Списание','Инвентаризация'):raise ValueError('Incomplete Invent row')
  # The repeated period total is reference metadata, never a per-item charge.
  hashed={**item,'origin':{k:v for k,v in origin.items() if k!='raw'}}
  rows.append({**item,'source_hash':digest(hashed),'captured_at':at})
 return {'rows':rows,'config':source['config'],'origin':{'spreadsheet_id':source['spreadsheet_id'],'captured_at':at,'workflow':source['workflow'],'legacy_settings':source['legacy_settings']}}
def literal(v):return "'"+str(v).replace("'","''")+"'"
def sql(plan,target):
 a,v,u=[literal(str(uuid.UUID(target[k]))) for k in ('account_id','venue_id','owner_id')]
 protected=f"md5(jsonb_build_object('transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t where venue_id={v}),'accruals',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_accruals t where venue_id={v}),'adjustments',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_adjustments t where venue_id={v}),'banks',(select jsonb_agg(to_jsonb(t) order by id) from public.bank_accounts t where account_id={a}),'notifications',(select jsonb_agg(to_jsonb(t) order by id) from public.notifications t where venue_id={v}))::text)"
 return f"""begin;
set local standard_conforming_strings=on;
select set_config('request.jwt.claim.sub',{u},true),set_config('app.ctx_ready','0',true);
select pg_advisory_xact_lock(hashtextextended('stock-archive:'||{v},0));
create temporary table _stock_import(payload jsonb) on commit drop;
insert into _stock_import values({literal(canonical(plan))}::jsonb);
do $import$ declare p jsonb;r jsonb;old public.stock_writeoff_archive;s public.stock_writeoff_sources;before_hash text;n integer:=0;created boolean:=false;begin
 if public.get_active_account_id() is distinct from {a}::uuid or public.get_active_venue_id() is distinct from {v}::uuid or not public.is_account_owner({a}::uuid) then raise exception 'Wrong owner/scope';end if;
 select payload into p from pg_temp._stock_import;select {protected} into before_hash;
 select * into s from public.stock_writeoff_sources where venue_id={v};
 if found and (s.account_id is distinct from {a}::uuid or s.config is distinct from p->'config') then raise exception 'Current source differs; review before replacing';end if;
 if not found then insert into public.stock_writeoff_sources(account_id,venue_id,config,origin) values({a},{v},p->'config',p->'origin');created:=true;end if;
 for r in select value from jsonb_array_elements(p->'rows') loop
  select * into old from public.stock_writeoff_archive where venue_id={v} and legacy_ref=r->>'legacy_ref' order by captured_at desc,id desc limit 1;
  if found and old.source_hash=r->>'source_hash' then continue;end if;
  if found and old.captured_at>=(r->>'captured_at')::timestamptz then raise exception 'Newer/conflicting source snapshot exists';end if;
  insert into public.stock_writeoff_archive(account_id,venue_id,business_date,legacy_ref,name,quantity,total,correspondent,kind,document_number,document_url,category,deleted,delete_reason,period_total_raw,issues,origin,source_hash,captured_at,imported_by)
  values({a},{v},(r->>'business_date')::date,r->>'legacy_ref',r->>'name',r->>'quantity',(r->>'total')::numeric,r->>'correspondent',r->>'kind',r->>'document_number',r->>'document_url',r->>'category',(r->>'deleted')::boolean,r->>'delete_reason',(r->>'period_total_raw')::numeric,r->'issues',r->'origin',r->>'source_hash',(r->>'captured_at')::timestamptz,{u});n:=n+1;
 end loop;
 if n>0 or created then insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details) values({a},{v},{u},'stock.writeoffs.archive_imported','stock_writeoff_source',{v},jsonb_build_object('rows',n,'source','Fees / Invent'));end if;
 if before_hash is distinct from {protected} then raise exception 'Import changed finance/payroll/notifications';end if;
 raise notice 'Imported % archive rows; source created %; money/payroll/notifications unchanged',n,created;
end $import$;
commit;
"""
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--target',required=True);p.add_argument('--sql',required=True);p.add_argument('--report',required=True);args=p.parse_args()
 source=json.loads(Path(args.source).read_text());target=json.loads(Path(args.target).read_text());plan=prepare(source,target);out=Path(args.sql);out.write_text(sql(plan,target));out.chmod(0o600)
 report={'rows':len(plan['rows']),'unknown_amounts':sum(r['total'] is None for r in plan['rows']),'from':min(r['business_date'] for r in plan['rows']),'through':max(r['business_date'] for r in plan['rows'])};Path(args.report).write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False))
