import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { asLooseDb } from '@/lib/supabase/loose';
import { LeaseLostError, leasedUpdate } from './job-lease';
import { hasQuickRestoWork, removeStaffFromQuickResto, type TerminationSteps } from './termination-remote';
import { checked, quickRestoRemovalMessage, quickRestoRemovalTransport, removeFromChatsJournaled, reportRemoval, telegramStep, TelegramStepError, type ChatRemovalJob } from './termination-io';
type Job = {id:string;account_id:string;user_id:string;employee_id:number|null;guest_id:number|null;bonus_id:number|null;steps:TerminationSteps;attempts:number;telegram_id:string|null};

export async function processStaffTermination(id?:string) {
 const db=asLooseDb(createAdminClient());
 const job=checked(await db.rpc('staff_claim_termination',{p_id:id??null})) as Job|null;
 if(!job)return false;
 // Every write checks the job is still this attempt: a cancelled or re-claimed job stops here.
 const save = async()=>{await leasedUpdate(db,'staff_terminations',job,{steps:job.steps,lease_until:new Date(Date.now()+300000).toISOString()});};
 const ids={employeeId:job.employee_id,guestId:job.guest_id,bonusId:job.bonus_id};
 // Only the ID snapshotted by staff_begin_termination is used (set at dismissal start, refreshed by a
 // manual «Повторить»); the live profile is never read here — the fired person could edit it.
 const chats:ChatRemovalJob={accountId:job.account_id,userId:job.user_id,eventKey:'termination:'+job.id,telegramId:job.telegram_id,steps:job.steps};
 const telegram=(step:()=>Promise<void>)=>telegramStep(step,e=>e instanceof LeaseLostError);
 try{
  await save(); // still ours before the first destructive step
  // No Quick Resto records: skip that cleanup (and the connection requirement), Telegram still runs.
  if(hasQuickRestoWork(ids))
   await removeStaffFromQuickResto({ids,done:job.steps,save,transport:await quickRestoRemovalTransport(db,job.account_id)});
  // Telegram runs after Quick Resto; its failures keep their own text (see catch below).
  if(!job.steps.telegram){await save();await telegram(()=>removeFromChatsJournaled(db,chats,save));job.steps.telegram=true;await save();}
  if(!job.steps.telegram_report){
   let sent=false;
   await telegram(async()=>{
    const person=checked(await db.from<{first_name:string|null;last_name:string|null}>('profiles').select('first_name,last_name').eq('id',job.user_id).maybeSingle());
    sent=await reportRemoval(db,chats,[person?.first_name,person?.last_name].filter(Boolean).join(' ')||'Сотрудник');
   });
   job.steps.telegram_report=true;if(!sent)job.steps.telegram_report_skipped=true;await save();
  }
  await leasedUpdate(db,'staff_terminations',job,{state:'complete',completed_at:new Date().toISOString(),error:null,lease_until:null,steps:job.steps});
  return true;
 }catch(error){
  if(error instanceof LeaseLostError)throw error;
  let message=error instanceof Error?error.message:'Не удалось закрыть внешний доступ';
  if(!(error instanceof TelegramStepError))message=quickRestoRemovalMessage(message);
  await leasedUpdate(db,'staff_terminations',job,{state:'error',error:message.slice(0,1500),lease_until:null,steps:job.steps,available_at:new Date(Date.now()+Math.min(3600000,30000*2**job.attempts)).toISOString()});
  throw new Error(message);
 }
}
export async function processStaffTerminations(){
 try{return {processed:await processStaffTermination()?1:0,errors:0};}
 catch{return {processed:0,errors:1};}
}
