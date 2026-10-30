import {test} from 'node:test';
import assert from 'node:assert/strict';
import {removeStaffFromQuickResto,type RemoteRow,type TerminationTransport} from './termination-remote.ts';
function fixture({balance=0,failAfter='',silent=false,missing=false}={}){
 const employees:RemoteRow[]=[{id:180,deleted:false}];
 const guests:RemoteRow[]=[{id:4918,deleted:false}];
 const bonus:RemoteRow[]=[{id:5836,deleted:false,accountState:'open',accountBalance:{ledger:balance,available:balance,debitHold:0,creditHold:0}}];
 const links:RemoteRow[]=[{id:166,employee:{id:180},store:1,deleted:false},{id:167,employee:{id:180},store:16,deleted:false},{id:999,employee:{id:999},store:1,deleted:false}];
 const writes:string[]=[],done:Record<string,boolean>={};let fail=failAfter;
 const transport:TerminationTransport={
  rows:async(path,q={})=>{
   if(path==='personnel.employee/select')return structuredClone(employees);
   if(path==='crm.customer/select')return structuredClone(guests);
   if(path==='warehouse.store/select')return [{id:1},{id:16}];
   if(path==='warehouse.store.employee/select')return structuredClone(links.filter(x=>x.store===q.ownerContextId));
   assert.equal(path,'crm.accounting.account/select');assert.equal(q.ownerContextId,4918);
   return structuredClone(bonus);
  },
  remove:async(module,_class,id)=>{
   const row=(module==='personnel.employee'?employees:guests).find(x=>x.id===id);assert.ok(row);
   writes.push(module);if(!silent)row.deleted=true;
   if(fail===module){fail='';throw new Error('lost response after commit');}
  },
  removeChild:async(path,row,q)=>{
   writes.push(path+':'+row.id);
   if(path==='crm.accounting.account/remove'){
    assert.equal(q.ownerContextId,4918);const item=bonus.find(x=>x.id===row.id)!;
    if(missing)bonus.splice(bonus.indexOf(item),1);else item.deleted=true;
   }else{assert.equal(path,'warehouse.store.employee/remove');links.find(x=>x.id===row.id)!.deleted=true;}
   if(fail===path){fail='';throw new Error('lost response after commit');}
  },
  closeBonus:async(row,q)=>{
   assert.equal(q.ownerContextId,4918);writes.push('close:'+row.id);bonus.find(x=>x.id===row.id)!.accountState='closed';
   if(fail==='close'){fail='';throw new Error('lost response after commit');}
  },
 };
 const run=(overrides={})=>removeStaffFromQuickResto({ids:{employeeId:180,guestId:4918,bonusId:5836,...overrides},transport,done,save:async()=>{}});
 return {run,writes,done,links,bonus,employees,guests};
}
test('dismissal verifies employee, both stores and zero bonus before guest; unrelated links survive',async()=>{
 const f=fixture();await f.run();const before=[...f.writes];await f.run();
 assert.deepEqual(f.writes,before);assert.ok(f.done.employee&&f.done.stores&&f.done.bonus&&f.done.guest);
 assert.equal(f.links.find(x=>x.id===999)?.deleted,false);
 assert.equal(f.bonus[0].deleted,true);assert.equal(f.guests[0].deleted,true);
});
test('response lost after employee removal resumes by reading, without replay',async()=>{
 const f=fixture({failAfter:'personnel.employee'});await assert.rejects(f.run(),/lost response/);await f.run();
 assert.equal(f.writes.filter(x=>x==='personnel.employee').length,1);
});
test('response lost after bonus disappears resumes with prior ownership proof',async()=>{
 const f=fixture({failAfter:'crm.accounting.account/remove',missing:true});await assert.rejects(f.run(),/lost response/);await f.run();
 assert.equal(f.writes.filter(x=>x.startsWith('crm.accounting.account/remove')).length,1);assert.ok(f.done.guest);
});
test('HTTP success without changed remote state cannot report success',async()=>{
 const f=fixture({silent:true});await assert.rejects(f.run(),/не подтвердил/);assert.equal(f.done.employee,undefined);assert.equal(f.guests[0].deleted,false);
});
test('positive bonus balance blocks guest deletion and does not debit anything',async()=>{
 const f=fixture({balance:1});await assert.rejects(f.run(),/остаток/);assert.equal(f.guests[0].deleted,false);
 assert.ok(f.done.employee);assert.ok(!f.writes.some(x=>x.startsWith('crm.')));
});
test('unknown bonus owner blocks removal rather than trusting supplied id',async()=>{
 const f=fixture();await assert.rejects(f.run({bonusId:9999}),/владелец/);assert.equal(f.guests[0].deleted,false);
});
test('invalid external id cannot reach a write',async()=>{
 const f=fixture();await assert.rejects(f.run({employeeId:-1}),/Некорректная/);assert.deepEqual(f.writes,[]);
});
test('missing or held bonus balance blocks deletion',async()=>{
 for(const balance of [undefined,{ledger:0,available:0,debitHold:1,creditHold:0}]){
  const f=fixture();f.bonus[0].accountBalance=balance;await assert.rejects(f.run(),/остаток/);assert.equal(f.guests[0].deleted,false);
 }
});
test('lost response after account closure resumes without closing twice',async()=>{
 const f=fixture({failAfter:'close'});await assert.rejects(f.run(),/lost response/);await f.run();
 assert.equal(f.writes.filter(x=>x.startsWith('close:')).length,1);assert.ok(f.done.bonus);
});
