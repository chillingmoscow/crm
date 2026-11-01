"""Source identity, missing amounts, period totals and SQL quoting; no writes."""
import copy
import importlib.util
import json
import sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('stock_import',Path(__file__).with_name('prepare-stock-writeoff-import.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
source,target=[json.loads(Path(p).read_text()) for p in sys.argv[1:3]]
p=module.prepare(source,target)
assert len(p['rows'])==40 and sum(r['total'] is None for r in p['rows'])==17
assert len({r['legacy_ref'] for r in p['rows']})==40
assert any(r['period_total_raw'] and r['total'] is None for r in p['rows']), 'Repeated aggregate never fills unknown item amount'
def denied(s):
 try:module.prepare(s,target)
 except ValueError:return
 raise AssertionError('Ambiguous source accepted')
s=copy.deepcopy(source);s['sheets']['Invent']['values'].append(s['sheets']['Invent']['values'][1]);denied(s)
s=copy.deepcopy(source);s['sheets']['Invent']['values'][1][13]='foreign';denied(s)
s=copy.deepcopy(source);s['sheets']['Invent']['values'][0][0]='Changed';denied(s)
s=copy.deepcopy(source);s['sheets']['Invent']['values'][1][10]='javascript:alert(1)';denied(s)
s=copy.deepcopy(source);s['sheets']['Invent']['values'][1][10]='https://qr.quickresto.ru@evil.invalid';denied(s)
s=copy.deepcopy(source);s['sheets']['Invent']['values'][1][15]=12;denied(s)
s=copy.deepcopy(source);row=s['sheets']['Invent']['values'][1];row[1]="QA ' $import$ \\ text";row[3]=0
changed=module.prepare(s,target);assert changed['rows'][0]['total']==0
sql=module.sql(changed,target);assert sql.index('create temporary table')<sql.index('do $import$') and "QA '' $import$" in sql
# Equivalent numeric representation does not create a new archive version.
s=copy.deepcopy(source);n=next(i for i,r in enumerate(s['sheets']['Invent']['values'][1:],1) if isinstance(r[3],(int,float)));s['sheets']['Invent']['values'][n][3]=str(s['sheets']['Invent']['values'][n][3]);assert module.prepare(s,target)['rows'][n-1]['source_hash']==p['rows'][n-1]['source_hash']
print('PASS: 40 unique source identities, 17 unknown amounts, repeated aggregate excluded, unsafe link/scope/schema/date rejection, zero vs unknown, normalized hash, dollar/quote-safe SQL')
