// Source correction, refunds, late taxi partitions and manual decision protection.
// No network, credentials, database or money writes.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const dir=await mkdtemp(join(tmpdir(),'native-finance-'));
try {
 for(const [name,path] of [['native-plan','src/lib/finance/native-plan.ts'],['settlement','src/lib/sales/settlement.ts'],['cash-movements','src/lib/sales/cash-movements.ts'],['time','src/lib/sales/time.ts']]) {
  let s=ts.transpileModule(await readFile(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  s=s.replace(/from ["']zod["']/g,`from ${JSON.stringify(import.meta.resolve('zod'))}`)
   .replace(/from ["']@\/lib\/sales\/(settlement|cash-movements|time)["']/g,(_,n)=>`from "./${n}.mjs"`)
   .replace(/from ["']\.\/time["']/g,'from "./time.mjs"');
  await writeFile(join(dir,name+'.mjs'),s);
 }
 const {prepareNativeFinance:build}=await import(pathToFileURL(join(dir,'native-plan.mjs')));
 const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
 const account=uid(1),venue=uid(2),cash=uid(3),safe=uid(4),operating=uid(5),income=uid(6),expense=uid(7),date='2026-10-30';
 const base={accountId:account,venueId:venue,date,source:{id:uid(10),version:1,hash:'verified'},rule:{id:uid(11),version:1},ledger:[],aliases:[]};
 const receipt={id:1,createdAt:Date.parse(date+'T12:00:00Z'),payerId:2,excluded:null,cost:20,payments:[{id:-1,typeId:1,amountCents:10000}]};
 const settlement={...structuredClone(base),kind:'settlement',source:{...base.source,facts:[receipt]},rule:{...base.rule,config:{venueId:venue,timezone:'Europe/Moscow',dayStartHour:9,revenueCategoryId:income,methods:[{paymentTypeId:1,bankAccountId:cash,excluded:null,feePercent:0,feeAccounting:'net'}],personal:{payerId:2,bankAccountId:safe,incomeCategoryId:income,expenseCategoryId:expense}}}};
 let counter=100;
 function simulate(s,plan) {
  assert.deepEqual(plan.blockers,[]);
  const next=structuredClone(s);
  for(const c of plan.commands) {
   let row=next.ledger.find(t=>c.transactionIds.includes(t.id));
   if(c.mode==='create') {
    row={id:uid(counter++),venueId:venue,sourceKey:c.key,date:c.date,type:c.type,bankAccountId:c.bankAccountId,toBankAccountId:c.toBankAccountId,categoryId:c.categoryId,amountCents:c.amountCents,description:c.description,sourceIds:[],deleted:false,planned:false,raw:{currency:'RUB'}};next.ledger.push(row);
   } else if(['update','restore'].includes(c.mode)) Object.assign(row,{date:c.date,type:c.type,bankAccountId:c.bankAccountId,toBankAccountId:c.toBankAccountId,categoryId:c.categoryId,amountCents:c.amountCents,description:c.description,deleted:false});
   else if(c.mode==='cancel') row.deleted=true;
   let alias=next.aliases.find(a=>a.key===c.key);
   if(!alias) {alias={key:c.key,transactionIds:[row.id],autoCancelled:false};next.aliases.push(alias);}
   alias.original=structuredClone(c);alias.baseline=[structuredClone(row)];
   if(c.mode!=='cancelled') alias.autoCancelled=c.mode==='cancel';
  }
  return next;
 }
 const initial=build(settlement);
 assert.deepEqual(initial.commands.map(c=>c.amountCents).sort((a,b)=>a-b),[2000,2000,10000]);
 assert(initial.commands.every(c=>c.mode==='create'));
 const posted=simulate(settlement,initial);
 assert(build(posted).commands.every(c=>c.mode==='link'));
 const changed=structuredClone(posted);changed.source.facts[0].payments[0].amountCents=12500;
 const correction=build(changed);
 assert.deepEqual(correction.blockers,[]);
 assert.equal(correction.commands.filter(c=>c.mode==='update').length,1);
 assert.equal(correction.commands.find(c=>c.mode==='update').amountCents,12500);
 for(const patch of [{amountCents:10001},{description:'Решение управляющего'},{deleted:true},{raw:{currency:'USD'}}]) {
  const manual=structuredClone(changed);Object.assign(manual.ledger.find(t=>t.type==='income'&&t.bankAccountId===cash),patch);
  assert(build(manual).blockers.some(s=>s.includes('ручная правка')));
 }
 const refunded=structuredClone(posted);Object.assign(refunded.source.facts[0],{excluded:'returned',payments:[],cost:null});
 const cancellation=build(refunded);
 assert.deepEqual(cancellation.blockers,[]);assert.equal(cancellation.commands.filter(c=>c.mode==='cancel').length,3);
 const cancelled=simulate(refunded,cancellation);
 assert(build(cancelled).commands.every(c=>c.mode==='cancelled'));
 cancelled.source.facts=structuredClone(settlement.source.facts);
 const restored=build(cancelled);assert.deepEqual(restored.blockers,[]);assert(restored.commands.every(c=>c.mode==='restore'));
 const missing=structuredClone(posted);missing.ledger=[];missing.aliases[0].transactionIds=[null];assert(build(missing).blockers.length>0);
 const duplicate=structuredClone(settlement);duplicate.ledger=[{...posted.ledger[0],sourceKey:null,description:'Ручная операция'}];assert(build(duplicate).blockers.length>0);

 const cashRules={cashAccountId:cash,safeAccountId:safe,operatingAccountId:operating,incomeCategoryId:income,taxiCategoryId:expense,tipsCategoryId:expense,safePattern:'инкас|инк.*ация',taxiPattern:'такси',tipsPattern:'ча[йеюёвы]',lookbackDays:30,intervalMinutes:60,autoRead:false,overrides:[]};
 const item=(id,amountCents)=>({id,date,amountCents,type:'cashOut',shiftId:1,openedAt:date+'T09:00:00Z',occurredAt:date+'T20:00:00Z',arrivedAt:date+'T21:00:00Z',comment:'Такси'});
 const movements={...structuredClone(base),kind:'movements',source:{...base.source,items:[item(1,1000),item(2,2000)]},rule:{...base.rule,config:cashRules}};
 const first=build(movements);assert.deepEqual(first.blockers,[]);assert.equal(first.commands.length,3);assert(first.commands.every(c=>!('label' in c)));
 const cashPosted=simulate(movements,first);
 assert(build(cashPosted).commands.every(c=>c.mode==='link'));
 const late=structuredClone(cashPosted);late.source.items.push(item(3,500));
 const latePlan=build(late);
 assert.deepEqual(latePlan.blockers,[]);assert.equal(latePlan.commands.filter(c=>c.mode==='create').length,2);
 const taxiDelta=latePlan.commands.find(c=>c.type==='expense'&&c.mode==='create');
 assert.equal(taxiDelta.amountCents,500);assert.deepEqual(taxiDelta.sourceIds,[3]);
 const taxiChanged=structuredClone(cashPosted);taxiChanged.source.items[0].amountCents=1100;
 const changedPlan=build(taxiChanged);assert.deepEqual(changedPlan.blockers,[]);assert.equal(changedPlan.commands.filter(c=>c.mode==='update').length,2);
 const manualTaxi=structuredClone(taxiChanged);manualTaxi.ledger.find(t=>t.type==='expense').description='Другая причина';assert(build(manualTaxi).blockers.length>0);
 const ambiguous=structuredClone(late);ambiguous.ledger.push({...cashPosted.ledger.find(t=>t.type==='expense'),id:uid(999),sourceKey:null,description:'Такси вручную',sourceIds:[],amountCents:500});assert(build(ambiguous).blockers.length>0);
 const reduced=structuredClone(cashPosted);reduced.source.items=reduced.source.items.slice(1);
 const regroup=build(reduced);assert.deepEqual(regroup.blockers,[]);assert.equal(regroup.commands.filter(c=>c.mode==='cancel').length,2);assert.equal(regroup.commands.find(c=>c.mode==='create').amountCents,2000);
 const regrouped=simulate(reduced,regroup);regrouped.source.items=structuredClone(movements.source.items);
 const returnedTaxi=build(regrouped);assert.deepEqual(returnedTaxi.blockers,[]);assert.equal(returnedTaxi.commands.filter(c=>c.mode==='create'&&c.type==='expense').length,1);assert.equal(returnedTaxi.commands.find(c=>c.mode==='create'&&c.type==='expense').amountCents,1000);
 const moved=structuredClone(reduced);moved.source.locations={'1':'2026-10-31','2':date};assert(build(moved).blockers.some(s=>s.includes('Изменилась дата')));
 console.log('PASS: native corrections/refunds/restores, manual amount/description/currency/cancellation guards, missing bindings, exact taxi partitions and late arrivals');
} finally {await rm(dir,{recursive:true,force:true});}
