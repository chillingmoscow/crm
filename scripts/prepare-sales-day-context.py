"""Prepare immutable Shifts/Salary context; never posts salary or money."""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import re
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from zoneinfo import ZoneInfo

SHIFT_HEADERS = ['Дата','Дата / День недели (Google)','Дата / Месяц / Номер','Дата / Год','Оборот','Чаевые','Питание','Такси','Row ID','Заведение / ID','ФОТ','Кальянная касса','Барная касса']
SALARY_HEADERS = ['Дата / Дата','Дата / День недели (Google)','Оборот','Чаевые за смену','Сотрудники на смене / Всего','Сотрудники на смене / Одной должности','Должность','Сотрудник / ФИО','%','Выход','Процент','Дополнительные продажи','Чаевые','Зарплата / С чаевыми','Зарплата / Чистая','Питание','Заведение / ID','Смена / ID','Row ID','Месяц','Надбавка за стаж','Надбавка за знания','Shisha / Касса','Bar / Касса']
EPOCH = datetime(1899,12,30)
def canonical(value): return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)
def digest(value): return hashlib.sha256(canonical(value).encode()).hexdigest()
def iso_capture(value):
    parsed = datetime.fromisoformat(value.replace('Z','+00:00'))
    if parsed.tzinfo is None: raise ValueError('Дата снимка без часового пояса')
    return parsed.astimezone(timezone.utc).isoformat()
def cell(row,index): return row[index] if index<len(row) else None
def number(value):
    if value is None or value=='': return None
    if isinstance(value,bool) or not isinstance(value,(int,float,str)) or (isinstance(value,str) and not re.fullmatch(r'-?\d+(?:\.\d+)?',value)): raise ValueError('Некорректное число источника')
    d=Decimal(str(value))
    if not d.is_finite() or abs(d)>10**12 or d!=d.quantize(Decimal('.01')): raise ValueError('Проверьте точность суммы источника')
    return int(d) if d==d.to_integral_value() else float(d)

def day(value):
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or value!=int(value): raise ValueError('Неоднозначная дата смены')
    date=(EPOCH+timedelta(days=value)).date()
    if not 2000<=date.year<=2100: raise ValueError('Проверьте дату смены')
    return date.isoformat()
def source_time(value,tz):
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value): raise ValueError('Нет отметки времени комментария')
    wall=EPOCH+timedelta(milliseconds=round(value*86400000))
    if not 2000<=wall.year<=2100: raise ValueError('Проверьте дату комментария')
    zone=ZoneInfo(tz)
    first,second=wall.replace(tzinfo=zone,fold=0),wall.replace(tzinfo=zone,fold=1)
    if first.utcoffset()!=second.utcoffset() or first.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None)!=wall: raise ValueError('Неоднозначное местное время комментария')
    return first.astimezone(timezone.utc).isoformat(timespec='milliseconds'),wall.isoformat(timespec='milliseconds')
def text(value,maximum,label):
    if not isinstance(value,str) or not value.strip() or len(value)>maximum: raise ValueError('Не заполнено поле '+label)
    return value

def prepare(source,legacy_venue,comments=None,source_timezone=None):
    captured=iso_capture(source['captured_at'])
    sheets=source['sheets'];days={};members={};seen_members=set();held=[]
    for name,headers in [('Shifts',SHIFT_HEADERS),('Salary',SALARY_HEADERS)]:
        if sheets[name]['values'][0]!=headers: raise ValueError('Изменились заголовки '+name)
    for index,row in enumerate(sheets['Shifts']['values'][1:],2):
        if not row or all(x is None or x=='' for x in row): continue
        date=day(cell(row,0));ref=text(cell(row,8),200,'ID смены')
        if cell(row,9)!=legacy_venue: raise ValueError('Другое заведение Shifts')
        if Decimal(str(cell(row,2)))!=int(date[5:7]) or Decimal(str(cell(row,3)))!=int(date[:4]): raise ValueError('Месяц/год смены не совпал')
        if ref in days or any(d['business_date']==date for d in days.values()): raise ValueError('Повтор смены или даты')
        metrics={key:number(cell(row,col)) for key,col in [('turnover',4),('tips_total',5),('food',6),('taxi',7),('payroll',10),('hookah',11),('bar',12)]}
        days[ref]={'legacy_ref':ref,'business_date':date,'metrics':metrics,'origin':{'spreadsheet_id':source['spreadsheet_id'],'range':f'Shifts!A{index}:M{index}','raw':dict(zip(SHIFT_HEADERS,row))},'members':[]}
    for index,row in enumerate(sheets['Salary']['values'][1:],2):
        if not row or all(x is None or x=='' for x in row): continue
        if cell(row,16)!=legacy_venue: raise ValueError('Другое заведение Salary')
        date=day(cell(row,0));ref=text(cell(row,18),200,'ID начисления');shift_ref=cell(row,17)
        if ref in seen_members: raise ValueError('Повтор ID начисления Salary')
        seen_members.add(ref)
        if shift_ref not in days or days[shift_ref]['business_date']!=date: raise ValueError('Не совпала связь Salary со сменой')
        member={'legacy_ref':ref,'name':text(cell(row,7),300,'Сотрудник'),'position':text(cell(row,6),200,'Должность'),'salary':number(cell(row,14)),'tips':number(cell(row,12)),'extras':number(cell(row,11)),'origin':{'spreadsheet_id':source['spreadsheet_id'],'range':f'Salary!A{index}:X{index}','raw':dict(zip(SALARY_HEADERS,row))}}
        days[shift_ref]['members'].append(member);members[ref]=member
    result=[]
    for item in days.values():
        item['members'].sort(key=lambda x:x['legacy_ref'])
        result.append({**item,'source_hash':digest(item),'captured_at':captured})
    result.sort(key=lambda x:x['business_date'])
    imported_comments=[];comment_keys=set()
    if comments:
        iso_capture(comments['captured_at'])
        if comments['spreadsheet_id']!=source['spreadsheet_id'] or not source_timezone: raise ValueError('Нет источника часового пояса комментариев')
        for entry in comments['rows']:
            row=entry['values'];ref=cell(row,1)
            if ref not in days or cell(row,5)!=legacy_venue or day(cell(row,0))!=days[ref]['business_date']: raise ValueError('Не совпала связь комментария со сменой')
            author=text(entry.get('authorName'),300,'Автор комментария');author_ref=text(cell(row,3),200,'ID автора')
            created,wall=source_time(cell(row,4),source_timezone);body=text(cell(row,2),4000,'Комментарий')
            key='glide-comment:'+digest({'topic':ref,'author':author_ref,'wall':wall})
            if key in comment_keys: raise ValueError('Неоднозначный повтор комментария')
            comment_keys.add(key)
            snapshot={'captured_at':iso_capture(comments['captured_at']),'spreadsheet_id':source['spreadsheet_id'],'range':f"Comments!A{entry['row']}:G{entry['row']}",'legacy_author_id':author_ref,'author_origin':entry.get('authorOrigin'),'source_timezone':source_timezone,'source_wall_time':wall,'raw':row}
            content={'body':body,'author_name':author,'created_at':created}
            snapshot['hash']=digest(content)
            imported_comments.append({'business_date':days[ref]['business_date'],'source_ref':key,**content,'source_snapshot':snapshot})
    return {'days':result,'comments':imported_comments,'held':held,'counts':{'days':len(result),'members':len(members),'comments':len(imported_comments)}}

def literal(value): return "'"+str(value).replace("'","''")+"'"
def uuid_literal(value): return literal(str(uuid.UUID(value)))
def sql(plan,target):
    a,v,u=[uuid_literal(target[k]) for k in ('account_id','venue_id','owner_id')]
    payload=literal(canonical(plan))+'::jsonb'
    protected=f"md5(jsonb_build_object('sales',(select jsonb_agg(to_jsonb(t) order by id) from public.sales_days t where venue_id={v}),'transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t where venue_id={v}),'accruals',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_accruals t where venue_id={v}),'adjustments',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_adjustments t where venue_id={v}),'banks',(select jsonb_agg(to_jsonb(t) order by id) from public.bank_accounts t where account_id={a}),'notifications',(select jsonb_agg(to_jsonb(t) order by id) from public.notifications t where venue_id={v}))::text)"
    return f"""begin;
set local standard_conforming_strings=on;
select set_config('request.jwt.claim.sub',{u},true),set_config('app.ctx_ready','0',true);
select pg_advisory_xact_lock(hashtextextended('sales-day-archive:'||{v},0));
create temporary table _sales_day_context_input(payload jsonb) on commit drop;
insert into _sales_day_context_input values({payload});
do $import$ declare p jsonb;r jsonb;m jsonb;old public.sales_day_archive;c public.sales_day_comments;x uuid;before_hash text;actor text;before_comment jsonb;n integer:=0;nm integer:=0;nc integer:=0;begin
 if public.get_active_account_id() is distinct from {a}::uuid or public.get_active_venue_id() is distinct from {v}::uuid or not public.is_account_owner({a}::uuid) then raise exception 'Wrong owner/scope';end if;
 select payload into p from pg_temp._sales_day_context_input;select {protected} into before_hash;
 select coalesce(nullif(trim(concat_ws(' ',first_name,last_name)),''),'Пользователь') into actor from public.profiles where id={u};
 for r in select value from jsonb_array_elements(p->'days') loop
  select * into old from public.sales_day_archive where venue_id={v} and business_date=(r->>'business_date')::date order by captured_at desc,id desc limit 1;
  if found and old.source_hash=r->>'source_hash' then continue;end if;
  if found and old.captured_at>=(r->>'captured_at')::timestamptz then raise exception 'Newer/conflicting day snapshot exists';end if;
  insert into public.sales_day_archive(account_id,venue_id,business_date,legacy_ref,metrics,origin,source_hash,captured_at,imported_by) values({a},{v},(r->>'business_date')::date,r->>'legacy_ref',r->'metrics',r->'origin',r->>'source_hash',(r->>'captured_at')::timestamptz,{u}) returning id into x;n:=n+1;
  for m in select value from jsonb_array_elements(r->'members') loop
   insert into public.payroll_day_archive_members(account_id,venue_id,day_archive_id,legacy_ref,name,position,salary,tips,extras,origin) values({a},{v},x,m->>'legacy_ref',m->>'name',m->>'position',(m->>'salary')::numeric,(m->>'tips')::numeric,(m->>'extras')::numeric,m->'origin');nm:=nm+1;
  end loop;
 end loop;
 for r in select value from jsonb_array_elements(p->'comments') loop
  select * into c from public.sales_day_comments where venue_id={v} and source_ref=r->>'source_ref' for update;
  if found then
   if c.origin<>'glide' then raise exception 'Comment source conflicts with native record';end if;
   if c.business_date is distinct from (r->>'business_date')::date then raise exception 'Comment source day changed';end if;
   if c.source_snapshot->>'hash'=r->'source_snapshot'->>'hash' then continue;end if;
   if (c.source_snapshot->>'captured_at')::timestamptz>=(r->'source_snapshot'->>'captured_at')::timestamptz then raise exception 'Newer/conflicting comment snapshot exists';end if;
   before_comment:=jsonb_build_object('body',c.body,'author_name',c.author_name,'created_at',c.created_at);
   update public.sales_day_comments set body=r->>'body',author_name=r->>'author_name',created_at=(r->>'created_at')::timestamptz,updated_at=now(),version=version+1,source_snapshot=r->'source_snapshot' where id=c.id returning * into c;
   perform private.sales_comment_event(c,'source_updated',jsonb_build_object('source',r->'source_snapshot','before',before_comment,'after',jsonb_build_object('body',c.body,'author_name',c.author_name,'created_at',c.created_at)),{u},actor);
  else
   insert into public.sales_day_comments(account_id,venue_id,business_date,author_name,body,origin,source_ref,source_snapshot,created_at) values({a},{v},(r->>'business_date')::date,r->>'author_name',r->>'body','glide',r->>'source_ref',r->'source_snapshot',(r->>'created_at')::timestamptz) returning * into c;
   perform private.sales_comment_event(c,'imported',jsonb_build_object('source',r->'source_snapshot'),{u},actor);
  end if;nc:=nc+1;
 end loop;
 if n>0 or nc>0 then insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details) values({a},{v},{u},'sales.day_archive.imported','venue',{v},jsonb_build_object('days',n,'members',nm,'comments',nc,'source','Fees / Shifts, Salary, Comments'));end if;
 if before_hash is distinct from {protected} then raise exception 'Import changed finance/payroll/notifications';end if;
 raise notice 'Imported % days, % members, % comments; finance/payroll/notifications unchanged',n,nm,nc;
end $import$;
commit;
"""
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--source',required=True);parser.add_argument('--target',required=True);parser.add_argument('--comments');parser.add_argument('--source-timezone');parser.add_argument('--sql',required=True);parser.add_argument('--report',required=True);args=parser.parse_args()
    source=json.loads(Path(args.source).read_text());target=json.loads(Path(args.target).read_text());comments=json.loads(Path(args.comments).read_text()) if args.comments else None
    plan=prepare(source,target['legacy_venue_id'],comments,args.source_timezone)
    Path(args.sql).write_text(sql(plan,target));Path(args.sql).chmod(0o600)
    report={**plan['counts'],'from':plan['days'][0]['business_date'],'through':plan['days'][-1]['business_date'],'held':plan['held']}
    Path(args.report).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False))
