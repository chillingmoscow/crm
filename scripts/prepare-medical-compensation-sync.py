"""Prepare an AQ-only metadata sync. Does not create salary entries or expenses."""
import argparse
import datetime as dt
import json
from pathlib import Path


def prepare(source, target):
    rows = source['rows']
    if len({r['id'] for r in rows}) != len(rows):
        raise ValueError('Duplicate source IDs')
    changes, held, matched = [], [], []
    for e in target['employees']:
        matches = [r for r in rows if e.get('legacy_id') and r['id'] == e['legacy_id']]
        if not matches and e.get('quickresto_id') is not None:
            matches = [r for r in rows if r.get('qrEmployee') == e['quickresto_id']]
        if len(matches) != 1:
            held.append({'name': e['name'], 'reason': 'Нет однозначной связи с источником'})
            continue
        r = matches[0]
        if r['venue'] != source['legacyVenueId']:
            raise ValueError('Foreign source venue')
        if r.get('qrEmployee') is not None and r['qrEmployee'] != e.get('quickresto_id'):
            raise ValueError('Conflicting employee IDs')
        if e.get('version') is None:
            held.append({'name': e['name'], 'reason': 'Нет медицинского источника; требуется отдельный перенос'})
            continue
        if not isinstance(r['medicalPaid'], bool):
            raise ValueError('Compensation flag must be boolean')
        # An already awarded compensation remains consumed, including across renewals.
        status = 'recorded' if r['medicalPaid'] or e['reimbursement_state'] == 'recorded' or e['has_award'] else 'not_recorded'
        expiry = (dt.date.fromisoformat(r['examinedOn']) + dt.timedelta(days=365)).isoformat() if r.get('examinedOn') else None
        matched.append({'name':e['name'], 'row':r['row'], 'status':status, 'document':r['hasMedical'], 'examined_on':r.get('examinedOn'), 'valid_until':expiry, 'document_differs':r['hasMedical'] != (e['medical_state']=='present') or (r['hasMedical'] and (r.get('examinedOn')!=e['examined_on'] or expiry!=e['valid_until'])), 'conflict':not r['medicalPaid'] and status=='recorded'})
        if status != e['reimbursement_state']:
            changes.append({'id':e['id'],'qr':e.get('quickresto_id'),'legacy_id':r['id'],'version':e['version'],'old':e['reimbursement_state'],'new':status,'row':r['row']})
    return {'changes':changes,'matched':matched,'held':held}


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def render_sql(plan, source, target):
    a,v,u = (literal(target[k]) for k in ('account_id','venue_id','owner_id'))
    marker = 'medical-compensation-AQ-' + source['capturedAt']
    payload = literal(json.dumps(plan['changes'], ensure_ascii=False))+'::jsonb'
    return f'''begin;
select set_config('request.jwt.claim.sub',{u},true);
select set_config('app.ctx_ready','0',true);
select pg_advisory_xact_lock(hashtextextended('payroll-automation:'||{v},0));
do $sync$ declare r jsonb;p public.payroll_automation_people;before_hash text;after_hash text;begin
if public.get_active_account_id() is distinct from {a}::uuid or public.get_active_venue_id() is distinct from {v}::uuid then raise exception 'Wrong scope';end if;
select md5(jsonb_build_object('transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t where venue_id={v}),'adjustments',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_adjustments t where venue_id={v}),'accruals',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_accruals t where venue_id={v}),'banks',(select jsonb_agg(to_jsonb(t) order by id) from public.bank_accounts t where account_id={a}))::text) into before_hash;
for r in select value from jsonb_array_elements({payload}) loop
 if not exists(select 1 from public.payroll_employees where id=(r->>'id')::uuid and account_id={a} and venue_id={v} and quickresto_id is not distinct from (r->>'qr')::bigint) then raise exception 'Employee changed';end if;
 if exists(select 1 from public.payroll_events where venue_id={v} and employee_id=(r->>'id')::uuid and details->>'marker'={literal(marker)} and details->>'reimbursement_after'=r->>'new') then continue;end if;
 select * into p from public.payroll_automation_people where employee_id=(r->>'id')::uuid for update;
 if p.version is distinct from (r->>'version')::integer or p.reimbursement_state is distinct from r->>'old' then raise exception 'Source changed';end if;
 update public.payroll_automation_people set reimbursement_state=r->>'new',version=version+1,updated_at=now(),updated_by={u} where employee_id=p.employee_id;
 insert into public.audit_logs(account_id,venue_id,user_id,action_code,entity_type,entity_id,details) values({a},{v},{u},'payroll.automation_person.updated','payroll_automation_person',p.employee_id,jsonb_build_object('employee_name',(select name from public.payroll_employees where id=p.employee_id),'reason','Статус однократной компенсации сверен со столбцом AQ','changes',jsonb_build_array(jsonb_build_object('field','reimbursement_state','old',p.reimbursement_state,'new',r->>'new')),'source',{literal(source['spreadsheetId'])}||':Employees!AQ'||(r->>'row')));
 insert into public.payroll_events(account_id,venue_id,employee_id,entity_id,action,actor_id,details) values({a},{v},p.employee_id,p.employee_id,'automation_source_imported',{u},jsonb_build_object('marker',{literal(marker)},'source_range','Employees!AQ'||(r->>'row'),'spreadsheet_id',{literal(source['spreadsheetId'])},'legacy_employee_id',r->>'legacy_id','reimbursement_before',p.reimbursement_state,'reimbursement_after',r->>'new'));
end loop;
select md5(jsonb_build_object('transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t where venue_id={v}),'adjustments',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_adjustments t where venue_id={v}),'accruals',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_accruals t where venue_id={v}),'banks',(select jsonb_agg(to_jsonb(t) order by id) from public.bank_accounts t where account_id={a}))::text) into after_hash;
if before_hash is distinct from after_hash then raise exception 'Financial data changed';end if;
end $sync$;
commit;
'''

if __name__ == '__main__':
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--source',type=Path,required=True);ap.add_argument('--target',type=Path,required=True)
    ap.add_argument('--report',type=Path,required=True);ap.add_argument('--sql',type=Path,required=True)
    args=ap.parse_args();source=json.loads(args.source.read_text());target=json.loads(args.target.read_text())
    result=prepare(source,target);args.report.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');args.sql.write_text(render_sql(result,source,target))
    print(json.dumps({'matched':len(result['matched']),'changes':len(result['changes']),'held':result['held'],'conflicts':[r for r in result['matched'] if r['conflict']],'document_differences':[r['name'] for r in result['matched'] if r['document_differs']]},ensure_ascii=False))
