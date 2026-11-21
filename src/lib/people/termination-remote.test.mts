import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hasQuickRestoWork,removeStaffFromQuickResto,type RemoteRow,type TerminationTransport} from './termination-remote.ts';
function fixture({failAfter='',silent=false}={}){
 const employees:RemoteRow[]=[{id:180,deleted:false}];
 const guests:RemoteRow[]=[{id:4918,deleted:false}];
 const links:RemoteRow[]=[{id:166,employee:{id:180},store:1,deleted:false},{id:167,employee:{id:180},store:16,deleted:false},{id:999,employee:{id:999},store:1,deleted:false}];
 const writes:string[]=[],reads:string[]=[],done:Record<string,boolean|number>={};let fail=failAfter;
 const transport:TerminationTransport={
  rows:async(path,q={})=>{
   reads.push(path);
   if(path==='personnel.employee/select')return structuredClone(employees);
   if(path==='crm.customer/select')return structuredClone(guests);
   if(path==='warehouse.store/select')return [{id:1},{id:16}];
   assert.equal(path,'warehouse.store.employee/select');
   return structuredClone(links.filter(x=>x.store===q.ownerContextId));
  },
  remove:async(module,_class,id)=>{
   const row=(module==='personnel.employee'?employees:guests).find(x=>x.id===id);assert.ok(row);
   writes.push(module);if(!silent)row.deleted=true;
   if(fail===module){fail='';throw new Error('lost response after commit');}
  },
  removeChild:async(path,row)=>{
   assert.equal(path,'warehouse.store.employee/remove');
   writes.push(path+':'+row.id);links.find(x=>x.id===row.id)!.deleted=true;
   if(fail===path){fail='';throw new Error('lost response after commit');}
  },
 };
 const run=(overrides={})=>removeStaffFromQuickResto({ids:{employeeId:180,guestId:4918,bonusId:5836,...overrides},transport,done,save:async()=>{}});
 return {run,transport,writes,reads,done,links,employees,guests};
}
test('dismissal removes the employee, both store links and the guest; unrelated links survive; replay writes nothing',async()=>{
 const f=fixture();await f.run();const before=[...f.writes];await f.run();
 assert.deepEqual(f.writes,before);assert.ok(f.done.employee&&f.done.stores&&f.done.guest);
 assert.equal(f.links.find(x=>x.id===999)?.deleted,false);
 assert.equal(f.employees[0].deleted,true);assert.equal(f.guests[0].deleted,true);
});
test('the guest is deleted as is: bonus accounts are neither read nor written off, closed or removed',async()=>{
 const f=fixture();await f.run();
 assert.ok(!f.reads.some(x=>x.startsWith('crm.accounting.account')));
 assert.ok(!f.writes.some(x=>x.includes('accounting')));
 assert.equal(f.guests[0].deleted,true);
});
test('a guest without an employee record is still deleted',async()=>{
 const f=fixture();await f.run({employeeId:null});
 assert.deepEqual(f.writes,['crm.customer']);assert.equal(f.employees[0].deleted,false);
});
test('response lost after employee removal resumes by reading, without replay',async()=>{
 const f=fixture({failAfter:'personnel.employee'});await assert.rejects(f.run(),/lost response/);await f.run();
 assert.equal(f.writes.filter(x=>x==='personnel.employee').length,1);
});
test('response lost after guest removal resumes by reading, without replay',async()=>{
 const f=fixture({failAfter:'crm.customer'});await assert.rejects(f.run(),/lost response/);await f.run();
 assert.equal(f.writes.filter(x=>x==='crm.customer').length,1);assert.ok(f.done.guest);
});
test('HTTP success without changed remote state cannot report success',async()=>{
 const f=fixture({silent:true});await assert.rejects(f.run(),/не подтвердил/);assert.equal(f.done.employee,undefined);assert.equal(f.guests[0].deleted,false);
});
test('invalid external id cannot reach a write',async()=>{
 const f=fixture();await assert.rejects(f.run({employeeId:-1}),/Некорректная/);assert.deepEqual(f.writes,[]);
});
test('person without Quick Resto records has no Quick Resto work, so the dismissal goes straight to Telegram',()=>{
 assert.equal(hasQuickRestoWork({employeeId:null,guestId:null,bonusId:null}),false);
 assert.equal(hasQuickRestoWork({employeeId:180,guestId:null,bonusId:null}),true);
 assert.equal(hasQuickRestoWork({employeeId:null,guestId:4918,bonusId:5836}),true);
});
test('a lost lease stops before the first Quick Resto removal',async()=>{
 const f=fixture();
 await assert.rejects(removeStaffFromQuickResto({ids:{employeeId:180,guestId:4918,bonusId:5836},transport:f.transport,done:f.done,save:async()=>{throw new Error('lease lost');}}),/lease lost/);
 assert.deepEqual(f.writes,[]);
});
