import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';import ts from 'typescript';
const dir=await mkdtemp(join(tmpdir(),'bonus-execution-'));
try{
 for(const [name,path] of [['executor','src/lib/payroll/bonus-executor.ts'],['journal','src/lib/payroll/payment-journal.ts']])await writeFile(join(dir,name+'.mjs'),ts.transpileModule(await readFile(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText);
 const {executeBonusOperation}=await import(pathToFileURL(join(dir,'executor.mjs'))),{paymentSettlement}=await import(pathToFileURL(join(dir,'journal.mjs')));
 const job={id:'job',lease_token:'lease',amount:800,direction:'debit'};
 const run=async({balance=1000,after=200,timeout=false,begin=true,lostCommit=false}={})=>{
 let sends=0,reads=0,finished=false;const calls=[];
 const db={rpc:async(fn,args)=>{calls.push([fn,args]);if(fn==='payroll_begin_bonus_send')return {data:begin};if(fn==='payroll_finish_bonus_operation'){if(finished)return {};if(args.p_confirmed){finished=true;if(lostCommit)return {error:{message:'lost response'}};}return {};}}};
 const r=await executeBonusOperation(db,job,{read:async()=>++reads===1?balance:after,send:async()=>{sends++;if(timeout)throw new Error('ambiguous timeout');return 'receipt-1';}});return {r,sends,reads,calls,finished};};
 let r=await run();assert.equal(r.sends,1);assert.equal(r.finished,true);assert.equal(r.r.review,false);
 r=await run({timeout:true});assert.equal(r.sends,1);assert.equal(r.r.review,true);assert.equal(r.calls.at(-1)[1].p_confirmed,false,'Unknown provider outcome must go to review');
 r=await run({lostCommit:true});assert.equal(r.sends,1,'Lost database commit never resends provider operation');assert.equal(r.finished,true);
 r=await run({after:199});assert.equal(r.r.review,true,'Unexpected balance must not be called settled');
 r=await run({balance:100,begin:false});assert.equal(r.sends,0,'Full money fallback sends no partial debit');
 r=await run({balance:NaN});assert.equal(r.sends,0);assert.equal(r.r.review,true);
 assert.deepEqual(paymentSettlement([{amount:25785,settled_amount:29638}],25785),{settledAmount:29638,taxAmount:3853});
 assert.deepEqual(paymentSettlement([{amount:23925,settled_amount:27500}],23925),{settledAmount:27500,taxAmount:3575});
 assert.deepEqual(paymentSettlement([{amount:5000,settled_amount:5000},{amount:23925,settled_amount:27500}],28925),{settledAmount:32500,taxAmount:3575});
 assert.deepEqual(paymentSettlement([{amount:5000,settled_amount:5000}],28925),{},'Partial permission-scoped allocations do not invent total tax');
 assert.deepEqual(paymentSettlement([],10000),{});assert.deepEqual(paymentSettlement([{amount:100,settled_amount:90}],100),{});
 console.log('PASS: single provider send, lost responses, unexpected balances, all-or-money, and real cash/tax settlement examples');
}finally{await rm(dir,{recursive:true,force:true});}
