"""Prepare a reviewed, source-only import. Does not connect to a database.

Inputs are bounded connector exports and a fresh scoped server snapshot. The SQL
uses existing RPCs and preserves every financial row; legacy effects only mark
already processed medical cases. Private input/output files do not belong in Git.
"""
import argparse
import datetime as dt
import json
import uuid
from decimal import Decimal
from pathlib import Path

NS = uuid.UUID('77ac71e1-4e99-4fe1-83a2-2a689405f499')

def day(value):
    if value in (None, '', '0', 0):
        return None
    text = str(value).strip()
    for fmt in ('%d.%m.%Y', '%Y-%m-%d'):
        try:
            return dt.datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            pass
    raise ValueError('Invalid source calendar date')

def yes(value):
    return str(value).strip().lower() == 'true'

def native_fee(fee, employee, server):
    expected = str(uuid.uuid5(NS, 'fee:' + str(fee['id'])))
    matched = [a for a in server.get('medical_adjustments') or []
               if a['employee_id'] == employee['id'] and
               (a['id'] == expected or a.get('legacy_id') == fee['id'] or str(a.get('source_ref', '')).endswith(':' + str(fee['id'])))]
    if len(matched) == 1:
        a=matched[0]
        if a['kind'] != {'Штраф':'deduction','Премия':'bonus'}.get(fee['kind']) or abs(Decimal(str(a['amount']))) != Decimal(str(fee['amount']).replace(',','.')) or a['date'] != day(fee['date']) or bool(a['deleted_at']) != yes(fee.get('deleted')):
            return None
        return a
    return None

def prepare(source, server, medical_only=False):
    source_ids = [e['id'] for e in source['employees']]
    if len(set(source_ids)) != len(source_ids) or not all(source_ids):
        raise ValueError('Source employee IDs must be present and unique')
    qr = [str(e['qrEmployee']) for e in source['employees'] if e.get('qrEmployee')]
    if len(set(qr)) != len(qr):
        raise ValueError('Ambiguous Quick Resto staff IDs')
    positions = {p['id']: p for p in source['positions']}
    people, holds, archive = [], [], []
    for e in server['employees']:
        matches = [r for r in source['employees'] if r.get('qrEmployee') and
                   str(r['qrEmployee']) == str(e.get('quickresto_id'))]
        evidence = 'quickresto_staff_id'
        if not matches:
            # Some older staff do not have a QR ID in Employees. Require the
            # already imported exact name AND the same confirmed hire date.
            matches = [r for r in source['employees'] if r['name'] == e['name']
                       and e.get('hired_on') and day(r.get('hiredOn')) == e['hired_on']]
            evidence = 'exact_name_and_existing_hire_date'
        if len(matches) != 1:
            if e['active']:
                holds.append({'employee_id': e['id'], 'name': e['name'], 'code': 'employee_unmapped'})
            continue
        r = matches[0]
        if r['venue'] != source['legacyVenueId']:
            raise ValueError('A staff source row belongs to another venue')
        if e.get('hired_on') and day(r.get('hiredOn')) != e['hired_on']:
            holds.append({'employee_id': e['id'], 'name': e['name'], 'code': 'hire_date_conflict'})
            continue
        pos = positions.get(r.get('positionId'))
        if pos is None:
            holds.append({'employee_id': e['id'], 'name': e['name'], 'code': 'position_unmapped', 'active': e['active']})
            continue
        exam = day(r.get('examinedOn'))
        expiry = (dt.date.fromisoformat(exam) + dt.timedelta(days=365)).isoformat() if exam else None
        has_document = bool(r['hasMedical'])
        state = 'present' if has_document and exam else 'unknown' if has_document else 'missing'
        fees = [f for f in source['medicalFees'] if f['name'] == r['name']
                and f.get('venue') == source['legacyVenueId'] and f.get('month')]
        linked = [(f, native_fee(f, e, server)) for f in fees]
        unresolved = [f['id'] for f, a in linked if a is None]
        actual = [a for _, a in linked if a is not None]
        absence = [a for a in actual if a['kind'] == 'deduction' and
                   'отсутств' in a['reason'].lower() and
                   (not e.get('hired_on') or a['date'] >= e['hired_on'])]
        missing_state = 'recorded' if any(not a['deleted_at'] for a in absence) else 'waived' if absence else 'unknown'
        compensation = [a for a in actual if a['kind'] == 'bonus' and 'компенсац' in a['reason'].lower()]
        # A source checkbox alone cannot reintroduce an already deleted reimbursement.
        compensation_state = ('recorded' if yes(r.get('medicalPaid')) or any(not a['deleted_at'] for a in compensation)
                              else 'unknown' if compensation else 'not_recorded')
        required = yes(pos.get('medical'))  # n8n requires exactly TRUE; blank is disabled.
        payload = {
            'hired_on': day(r.get('hiredOn')), 'birthday': None if medical_only else day(r.get('birthday')),
            'gender': None if medical_only else {'Мужчина': 'male', 'Женщина': 'female'}.get(r.get('gender')),
            'gift_role': None if medical_only else pos['name'], 'medical_required': required, 'medical_state': state,
            'examined_on': exam, 'valid_until': expiry, 'reimbursement_state': compensation_state,
            'missing_fine_state': missing_state, 'expiry_fine_state': 'not_recorded' if expiry and expiry > source['asOf'] else 'unknown',
            'new_medical_case': False,
            'legacy_reconciled': not unresolved and (not required or
                state == 'missing' and missing_state != 'unknown' or
                state == 'present' and compensation_state == 'recorded' and bool(expiry)),
        }
        effects = []
        if absence:
            effects.append({'rule': 'medical_missing', 'source': 'employment_id', 'entry': sorted(absence, key=lambda x: (x['date'], x['id']))[0]})
        live_comp = [a for a in compensation if not a['deleted_at']]
        if live_comp and state == 'present':
            effects.append({'rule': 'medical_reimbursement', 'source': 'medical_case_id', 'entry': sorted(live_comp, key=lambda x: (x['date'], x['id']))[-1]})
        people.append({'employee_id': e['id'], 'name': e['name'], 'legacy_id': r['id'],
                       'evidence': evidence, 'input': payload, 'effects': effects,
                       'source_fee_ids': [f['id'] for f in fees], 'source_medical': {'document_reported':r['hasMedical'],'examined_on_raw':r.get('examinedOn'),'remaining_days_raw':r.get('expiry'),'reimbursement_flag_raw':r.get('medicalPaid')}, 'unmatched_fee_ids': unresolved})
        if r.get('uniformPurchased') or r.get('uniformAmount'):
            archive.append({'employee_id': e['id'], 'legacy_employee_id': r['id'],
                            'purchased_on': day(r.get('uniformPurchased')), 'amount': r.get('uniformAmount'),
                            'legacy_parts_created': yes(r.get('uniformDone'))})
    return {'as_of': source['asOf'], 'people': people, 'holds': holds, 'uniform_archive': archive}

def sql(value):
    if value is None:
        return 'null'
    return "'" + str(value).replace("'", "''") + "'"

def sql_json(value):
    return sql(json.dumps(value, ensure_ascii=False, separators=(',', ':'))) + '::jsonb'

def render_sql(plan, server, account, venue, owner, marker):
    # Source-only writes: no INSERT/UPDATE against adjustments, accruals,
    # payments, transactions, QR accounts or authentication tables.
    parts = ['begin;', "select set_config('request.jwt.claim.sub',"+sql(owner)+",true);",
             "select set_config('app.ctx_ready','0',true);",
             "select pg_advisory_xact_lock(hashtextextended('payroll-automation:'||"+sql(venue)+",0));",
             'do $import$ declare current_person public.payroll_automation_people; key text; source uuid; before_hash text; after_hash text;begin',
             "if exists(select 1 from public.payroll_events where venue_id="+sql(venue)+" and details->>'marker'="+sql(marker)+") then raise notice 'Already applied';return;end if;",
             "if public.get_active_account_id() is distinct from "+sql(account)+"::uuid or public.get_active_venue_id() is distinct from "+sql(venue)+"::uuid then raise exception 'Wrong active account or venue';end if;",
             "select md5(jsonb_build_object('transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t where venue_id="+sql(venue)+"),'accruals',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_accruals t where venue_id="+sql(venue)+"),'adjustments',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_adjustments t where venue_id="+sql(venue)+"))::text) into before_hash;"]
    original = {e['id']: e for e in server['employees']}
    for p in plan['people']:
        ident = sql(p['employee_id'])
        e = original[p['employee_id']]
        parts.append('if not exists(select 1 from public.payroll_employees where id='+ident+' and account_id='+sql(account)+' and venue_id='+sql(venue)+' and active='+str(bool(e['active'])).lower()+' and quickresto_id is not distinct from '+(sql(e['quickresto_id'])+'::bigint' if e.get('quickresto_id') is not None else 'null')+' and role_id is not distinct from '+sql(e.get('role_id'))+'::uuid and local_user_id is not distinct from '+sql(e.get('local_user_id'))+'::uuid and hired_on is not distinct from '+sql(e.get('hired_on'))+'::date) then raise exception \'Employee source changed\';end if;')
        parts += ['select * into current_person from public.payroll_automation_people where employee_id='+ident+' for update;',
                  "if current_person.employee_id is not null and (current_person.medical_state<>'unknown' or current_person.legacy_reconciled or current_person.hired_on is not null or current_person.birthday is not null) then raise exception 'Existing reviewed source requires reconciliation';end if;",
                  'perform public.payroll_save_automation_person('+ident+',coalesce(current_person.version,0),'+sql_json(p['input'])+');']
        for effect in p['effects']:
            a = effect['entry']
            amount=Decimal(str(a['amount']))
            if not amount.is_finite() or abs(amount)>1000000 or amount!=amount.quantize(Decimal('0.01')): raise ValueError('Invalid native financial amount')
            parts.append('if not exists(select 1 from public.payroll_adjustments where id='+sql(a['id'])+' and employee_id='+ident+' and venue_id='+sql(venue)+' and account_id='+sql(account)+' and amount='+str(a['amount'])+' and kind='+sql(a['kind'])+' and business_date='+sql(a['date'])+'::date and deleted_at is not distinct from '+sql(a['deleted_at'])+'::timestamptz) then raise exception \'Legacy financial event changed\';end if;')
            parts += ['select '+effect['source']+' into source from public.payroll_automation_people where employee_id='+ident+';',
                      'key:='+sql('payroll:'+venue+':'+p['employee_id']+':'+effect['rule']+':')+"||source::text||':once';",
                      'insert into public.payroll_automation_effects(event_key,account_id,venue_id,employee_id,decision,adjustment_id,state,source_ref,created_by) values(key,'+sql(account)+','+sql(venue)+','+ident+",jsonb_build_object('key',key,'venueId',"+sql(venue)+",'employeeId',"+ident+",'sourceId',source,'ruleVersion',0,'businessDate',"+sql(a['date'])+",'rule',"+sql(effect['rule'])+",'kind',"+sql(a['kind'])+",'medium','money','amount',"+str(abs(amount))+",'reason',"+sql(a['reason'])+'),'+sql(a['id'])+",'legacy',"+sql('existing-adjustment:'+a['id'])+','+sql(owner)+') on conflict(event_key) do nothing;']
        details = {'marker': marker, 'legacy_employee_id': p['legacy_id'], 'matching_evidence': p['evidence'], 'source_medical':p['source_medical'], 'legacy_fee_ids': p['source_fee_ids'], 'unmatched_fee_ids': p['unmatched_fee_ids'], 'uniform_source': next((u for u in plan['uniform_archive'] if u['employee_id'] == p['employee_id']),None)}
        parts.append('insert into public.payroll_events(account_id,venue_id,employee_id,entity_id,action,actor_id,details) values('+sql(account)+','+sql(venue)+','+ident+','+ident+",'automation_source_imported',"+sql(owner)+','+sql_json(details)+');')
    parts += ["select md5(jsonb_build_object('transactions',(select jsonb_agg(to_jsonb(t) order by id) from public.transactions t where venue_id="+sql(venue)+"),'accruals',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_accruals t where venue_id="+sql(venue)+"),'adjustments',(select jsonb_agg(to_jsonb(t) order by id) from public.payroll_adjustments t where venue_id="+sql(venue)+"))::text) into after_hash;",
              "if before_hash is distinct from after_hash then raise exception 'Source import changed financial data';end if;",
              'end $import$;', 'commit;']
    return '\n'.join(parts)+'\n'

if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--source', type=Path, required=True)
    ap.add_argument('--server', type=Path, required=True)
    ap.add_argument('--as-of', required=True)
    ap.add_argument('--report', type=Path, required=True)
    ap.add_argument('--sql', type=Path)
    ap.add_argument('--account')
    ap.add_argument('--venue')
    ap.add_argument('--owner')
    ap.add_argument('--medical-only', action='store_true', help='Do not import birthday, gender or gift role')
    args = ap.parse_args()
    src, target = json.loads(args.source.read_text()), json.loads(args.server.read_text())
    src['asOf'] = dt.date.fromisoformat(args.as_of).isoformat()
    report = prepare(src, target, args.medical_only)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    if args.sql:
        assert all((args.account, args.venue, args.owner)), 'SQL target identity is required'
        args.sql.write_text(render_sql(report, target, args.account, args.venue, args.owner, 'automation-sources-'+args.as_of))
    print(json.dumps({'people': len(report['people']), 'held_employees': report['holds'], 'uniform_archive': len(report['uniform_archive']), 'reconciled_effects': sum(len(p['effects']) for p in report['people']), 'unmatched_fees': sum(len(p['unmatched_fee_ids']) for p in report['people'])}, ensure_ascii=False))
