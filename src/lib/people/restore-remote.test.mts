import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NOT_RECOVERABLE,RECOVER_FAILED,recoverStaffInQuickResto,restoreErrorMessage,type RemoteRow,type RestoreTransport} from './restore-remote.ts';

const settings={staffGroupId:8,bonusAccountTypeId:1,storeIds:[1,16]};
function fixture({employee=true,guest=true,lostRecover='',silentRecover='',recoverError='',openBonus=false,links=false}:{
 employee?:boolean;guest?:boolean;lostRecover?:string;silentRecover?:string;recoverError?:string;openBonus?:boolean;links?:boolean;
}={}){
 const employees:RemoteRow[]=employee?[{id:180,deleted:true,pin:'4821'}]:[];
 const guests:RemoteRow[]=guest?[{id:4918,deleted:true,customerGroup:{id:3}}]:[];
 const bonus:RemoteRow[]=[{id:5836,deleted:true,accountState:'closed',accountType:{id:1}}];
 if(openBonus)bonus.push({id:5900,deleted:false,accountState:'open',accountType:{id:1}});
 const storeLinks:RemoteRow[]=links?[{id:166,employee:{id:180},store:1,deleted:false},{id:167,employee:{id:180},store:16,deleted:false}]:[];
 const writes:string[]=[],done:Record<string,boolean|number>={};
 let lost=lostRecover;
 const transport:RestoreTransport={
  rows:async(path,q={})=>{
   if(path==='personnel.employee/select'){assert.equal(q.showDeleted,'true');return structuredClone(employees);}
   if(path==='crm.customer/select'){assert.equal(q.showDeleted,'true');return structuredClone(guests);}
   if(path==='warehouse.store.employee/select')return structuredClone(storeLinks.filter(x=>x.store===q.ownerContextId));
   assert.equal(path,'crm.accounting.account/select');assert.equal(q.ownerContextId,4918);
   return structuredClone(bonus);
  },
  recover:async(module,row)=>{
   writes.push('recover:'+module);
   if(recoverError===module)throw new Error('Quick Resto: entityNotFound (HTTP 404)');
   const list=module==='personnel.employee'?employees:guests;
   const item=list.find(x=>x.id===row.id);assert.ok(item);
   if(silentRecover!==module)item.deleted=false;
   if(lost===module){lost='';throw new Error('fetch failed');}
  },
  readGuest:async id=>{assert.equal(id,4918);return structuredClone(guests[0]);},
  updateGuest:async row=>{writes.push('group:'+(row.customerGroup as RemoteRow).id);guests[0].customerGroup={id:(row.customerGroup as RemoteRow).id};},
  createStoreLink:async(storeId,employeeId)=>{writes.push('store:'+storeId);storeLinks.push({id:200+storeId,employee:{id:employeeId},store:storeId,deleted:false});},
  createBonus:async(guestId,typeId)=>{assert.equal(guestId,4918);writes.push('bonus');bonus.push({id:6001,deleted:false,accountState:'open',accountType:{id:typeId}});},
 };
 return {transport,writes,done,employees,guests,save:async()=>{}};
}
const ids={employeeId:180,guestId:4918};

test('recovers the previous employee and guest, restores Staff group and opens a new bonus account',async()=>{
 const f=fixture();
 const result=await recoverStaffInQuickResto({ids,settings,transport:f.transport,done:f.done,save:f.save});
 assert.deepEqual(result,{bonusId:6001});
 assert.deepEqual(f.writes,['recover:crm.customer','group:8','bonus','recover:personnel.employee','store:1','store:16']);
 assert.equal(f.employees[0].deleted,false);assert.equal(f.employees[0].pin,'4821');
 assert.equal(f.done.employee,true);assert.equal(f.done.guest,true);assert.equal(f.done.bonus,6001);
});

test('a repeated run re-reads state and writes nothing new',async()=>{
 const f=fixture();
 await recoverStaffInQuickResto({ids,settings,transport:f.transport,done:f.done,save:f.save});
 f.writes.length=0;
 assert.deepEqual(await recoverStaffInQuickResto({ids,settings,transport:f.transport,done:f.done,save:f.save}),{bonusId:6001});
 assert.deepEqual(f.writes,[]);
});

test('a lost recover response is not repeated: the next read shows it landed',async()=>{
 const f=fixture({lostRecover:'crm.customer'});
 await assert.rejects(recoverStaffInQuickResto({ids,settings,transport:f.transport,done:f.done,save:f.save}),/fetch failed/);
 f.writes.length=0;
 await recoverStaffInQuickResto({ids,settings,transport:f.transport,done:f.done,save:f.save});
 assert.deepEqual(f.writes,['group:8','bonus','recover:personnel.employee','store:1','store:16']);
});

test('an erased employee stops the restore before anything is recovered',async()=>{
 const f=fixture({employee:false});
 await assert.rejects(recoverStaffInQuickResto({ids,settings,transport:f.transport,done:f.done,save:f.save}),{message:NOT_RECOVERABLE});
 assert.deepEqual(f.writes,[]);
 assert.equal(f.guests[0].deleted,true);
});

test('an erased guest stops the restore before the employee is recovered',async()=>{
 const f=fixture({guest:false});
 await assert.rejects(recoverStaffInQuickResto({ids,settings,transport:f.transport,done:f.done,save:f.save}),{message:NOT_RECOVERABLE});
 assert.deepEqual(f.writes,[]);
 assert.equal(f.employees[0].deleted,true);
});

test('a record that stays deleted after an accepted recover is a retryable error, not erased',async()=>{
 const f=fixture({silentRecover:'personnel.employee'});
 await assert.rejects(recoverStaffInQuickResto({ids,settings,transport:f.transport,done:f.done,save:f.save}),{message:RECOVER_FAILED});
 assert.equal(f.done.employee,undefined);
});

test('Quick Resto "not found" on recover of a listed record is retryable, not terminal',async()=>{
 const f=fixture({recoverError:'personnel.employee'});
 await assert.rejects(recoverStaffInQuickResto({ids,settings,transport:f.transport,done:f.done,save:f.save}),{message:RECOVER_FAILED});
});

test('an open bonus account of the staff type is reused, existing store links are kept',async()=>{
 const f=fixture({openBonus:true,links:true});
 assert.deepEqual(await recoverStaffInQuickResto({ids,settings,transport:f.transport,done:f.done,save:f.save}),{bonusId:5900});
 assert.ok(!f.writes.includes('bonus'));assert.ok(!f.writes.some(w=>w.startsWith('store:')));
});

test('without Quick Resto ids nothing is touched',async()=>{
 const f=fixture();
 assert.deepEqual(await recoverStaffInQuickResto({ids:{employeeId:null,guestId:null},settings,transport:f.transport,done:f.done,save:f.save}),{bonusId:null});
 assert.deepEqual(f.writes,[]);
});

test('rejects malformed ids',async()=>{
 const f=fixture();
 await assert.rejects(recoverStaffInQuickResto({ids:{employeeId:-1,guestId:null},settings,transport:f.transport,done:f.done,save:f.save}),/Некорректная связь/);
});

test('a failed guest recover leaves the employee deleted in Quick Resto',async()=>{
 const f=fixture({recoverError:'crm.customer'});
 await assert.rejects(recoverStaffInQuickResto({ids,settings,transport:f.transport,done:f.done,save:f.save}),{message:RECOVER_FAILED});
 assert.deepEqual(f.writes,['recover:crm.customer']);
 assert.equal(f.employees[0].deleted,true);
});

test('a failed employee recover after the guest is an error, not a success, and points to cancelling',async()=>{
 const f=fixture({silentRecover:'personnel.employee'});
 await assert.rejects(recoverStaffInQuickResto({ids,settings,transport:f.transport,done:f.done,save:f.save}),{message:RECOVER_FAILED});
 assert.equal(f.done.guest,true);assert.equal(f.done.employee,undefined);
 assert.match(restoreErrorMessage('fetch failed',f.done),/«Отменить возврат»/);
});

test('a lost lease after the pre-reads stops before the first Quick Resto write',async()=>{
 const f=fixture();
 await assert.rejects(recoverStaffInQuickResto({ids,settings,transport:f.transport,done:f.done,save:async()=>{throw new Error('lease lost');}}),/lease lost/);
 assert.deepEqual(f.writes,[]);
});

test('a retry after RECOVER_FAILED recovers normally once Quick Resto cooperates',async()=>{
 const f=fixture({recoverError:'personnel.employee'});
 await assert.rejects(recoverStaffInQuickResto({ids,settings,transport:f.transport,done:f.done,save:f.save}),{message:RECOVER_FAILED});
 const transport={...f.transport,recover:async(m:'personnel.employee'|'crm.customer',row:RemoteRow)=>{f.writes.push('recover:'+m);(m==='personnel.employee'?f.employees:f.guests).find(x=>x.id===row.id)!.deleted=false;}};
 f.writes.length=0;
 assert.deepEqual(await recoverStaffInQuickResto({ids,settings,transport,done:f.done,save:f.save}),{bonusId:6001});
 assert.deepEqual(f.writes,['recover:personnel.employee','store:1','store:16']);
});

test('a record that vanishes from the deleted list after recover is erased (terminal)',async()=>{
 const f=fixture();
 const transport={...f.transport,recover:async(m:'personnel.employee'|'crm.customer')=>{if(m==='crm.customer')f.guests.length=0;}};
 await assert.rejects(recoverStaffInQuickResto({ids,settings,transport,done:f.done,save:f.save}),{message:NOT_RECOVERABLE});
});

test('error text points to «Отменить возврат» only when something was already returned',()=>{
 assert.equal(restoreErrorMessage('Quick Resto не ответил',{}),'Quick Resto не ответил');
 assert.match(restoreErrorMessage('Quick Resto не ответил',{guest:true}),/Часть записей уже возвращена.*«Отменить возврат»/);
 assert.match(restoreErrorMessage(NOT_RECOVERABLE,{guest:true,guest_group:true}),/«Отменить возврат»/);
 assert.equal(restoreErrorMessage(RECOVER_FAILED,{}),RECOVER_FAILED);
});
