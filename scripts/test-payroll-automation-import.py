"""Import invariants that can otherwise duplicate a medical charge."""
import importlib.util
import copy
import uuid
from pathlib import Path
spec=importlib.util.spec_from_file_location('automation_import',Path(__file__).with_name('prepare-payroll-automation-import.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
legacy_id='legacy-fee'
entry={'id':str(uuid.uuid5(m.NS,'fee:'+legacy_id)),'employee_id':'e','kind':'deduction','amount':-3000,'date':'2026-02-01','deleted_at':'2026-02-02T00:00:00Z','source_ref':'old','reason':'Отсутствие медкнижки'}
person={'id':'legacy-person','name':'Сотрудник','active':'TRUE','qrEmployee':'174','venue':'legacy-venue','positionId':'p','hiredOn':'01.01.2026','birthday':'10.05.1990','gender':'Мужчина','hasMedical':False,'examinedOn':None,'uniformPurchased':None,'uniformAmount':None,'uniformDone':None}
fee={'id':legacy_id,'name':'Сотрудник','venue':'legacy-venue','date':'01.02.2026','month':'2','kind':'Штраф','amount':'3000','deleted':'TRUE'}
source={'legacyVenueId':'legacy-venue','asOf':'2026-10-29','employees':[person],'positions':[{'id':'p','name':'Мастер','medical':'TRUE'}],'medicalFees':[fee]}
server={'employees':[{'id':'e','name':'Другое отображаемое имя','quickresto_id':174,'hired_on':'2026-01-01','active':True}],'medical_adjustments':[entry]}
plan=m.prepare(source,server)
assert plan['people'][0]['input']['missing_fine_state']=='waived'
assert len(plan['people'][0]['effects'])==1
assert plan['people'][0]['evidence']=='quickresto_staff_id'
assert plan['people'][0]['input']['valid_until'] is None, 'Blank exam plus a day counter must not invent an expiry'
changed=copy.deepcopy(server);changed['medical_adjustments'][0]['amount']=-2500
p=m.prepare(source,changed)['people'][0]
assert p['unmatched_fee_ids']==[legacy_id] and not p['input']['legacy_reconciled'], 'A changed native charge needs reconciliation'
renewed=copy.deepcopy(source);renewed['employees'][0].update(hasMedical=True,examinedOn='29.02.2024')
assert m.prepare(renewed,server)['people'][0]['input']['valid_until']=='2025-02-28', 'Glide uses exactly 365 days'
missing=copy.deepcopy(source);missing['medicalFees'][0]['venue']=None
assert not m.prepare(missing,server)['people'][0]['effects'], 'An excluded malformed Fee must not be reimported'
twins=copy.deepcopy(source);twins['employees'].append({**person,'id':'another-person','qrEmployee':None});twins['employees'][0]['qrEmployee']=None
native=copy.deepcopy(server);native['employees'][0]['name']='Сотрудник';native['employees'][0]['quickresto_id']=None
assert not m.prepare(twins,native)['people'], 'Ambiguous name and hire-date match must not pick a stranger'
assert m.sql("x');select 1;--")=="'x'');select 1;--'", 'Source text stays data in the generated SQL'
medical=m.prepare(source,server,medical_only=True)['people'][0]['input']
assert medical['birthday'] is None and medical['gender'] is None and medical['gift_role'] is None, 'Deferred gifts do not copy their extra profile fields'
paid=copy.deepcopy(renewed);paid['employees'][0]['medicalPaid']='TRUE'
assert m.prepare(paid,server)['people'][0]['input']['reimbursement_state']=='recorded', 'AQ is evidence even without an old Fee'
for flag in ('', 'FALSE', False, None):
    unpaid=copy.deepcopy(renewed);unpaid['employees'][0]['medicalPaid']=flag
    assert m.prepare(unpaid,server)['people'][0]['input']['reimbursement_state']=='not_recorded', 'Blank AQ means not awarded'
spec2=importlib.util.spec_from_file_location('compensation_sync',Path(__file__).with_name('prepare-medical-compensation-sync.py'))
sync=importlib.util.module_from_spec(spec2);spec2.loader.exec_module(sync)
row={'id':'old-id','row':2,'name':'Человек','venue':'legacy-venue','qrEmployee':1,'medicalPaid':False,'hasMedical':False,'examinedOn':None}
target={'employees':[{'id':'employee','name':'Новое имя','quickresto_id':1,'legacy_id':'old-id','version':1,'reimbursement_state':'recorded','has_award':True,'medical_state':'missing','examined_on':None,'valid_until':None}]}
result=sync.prepare({'rows':[row],'legacyVenueId':'legacy-venue'},target)
assert not result['changes'] and result['matched'][0]['conflict'], 'An AQ reset cannot reopen an existing award'
for invalid in ({'rows':[row,row],'legacyVenueId':'legacy-venue'},{'rows':[{**row,'venue':'foreign'}],'legacyVenueId':'legacy-venue'}):
    try:
        sync.prepare(invalid,target)
        raise AssertionError('Ambiguous/foreign source accepted')
    except ValueError:
        pass
print('PASS: cancelled cases stay consumed, IDs beat names, changed money is held, 365-day expiry, malformed rows and ambiguous identities')
