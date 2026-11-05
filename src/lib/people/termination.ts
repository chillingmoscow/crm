import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { asLooseDb } from '@/lib/supabase/loose';
import { decryptSecret } from '@/lib/integrations/crypto';
import { getBackOfficeAuth, getConnection, withBackOfficeSession } from '@/app/(dashboard)/inventory/actions-shared';
import { buildQuickRestoBackOfficeOrigin, callQuickRestoBackOfficeData, callQuickRestoBackOfficeRemove, quickRestoFetch } from '@/lib/integrations/quickresto/client';
import { loadTelegramBot } from '@/lib/integrations/telegram-bot';
import { removalComplete } from '@/lib/integrations/telegram-membership';
import { LeaseLostError, leasedUpdate } from './job-lease';
import { hasQuickRestoWork, removeStaffFromQuickResto, type RemoteRow, type TerminationSteps } from './termination-remote';
import { ALL_CHATS, removeFromTelegramChats, telegramStepApplies, terminationReport, unconfirmedChats, type ChatOutcome } from './termination-telegram';
type Job = {id:string;account_id:string;user_id:string;employee_id:number|null;guest_id:number|null;bonus_id:number|null;steps:TerminationSteps;attempts:number;telegram_id:string|null};
type LooseAdmin = ReturnType<typeof asLooseDb>;
/** Telegram failures carry their own text; they must not be rewritten as Quick Resto errors. */
class TelegramStepError extends Error {}
const checked = <T>(r:{data:T|null;error:{message:string}|null}):T => {if(r.error)throw new Error(r.error.message);return r.data as T;};

export async function processStaffTermination(id?:string) {
 const db=asLooseDb(createAdminClient());
 const job=checked(await db.rpc('staff_claim_termination',{p_id:id??null})) as Job|null;
 if(!job)return false;
 // Every write checks the job is still this attempt: a cancelled or re-claimed job stops here.
 const save = async()=>{await leasedUpdate(db,'staff_terminations',job,{steps:job.steps,lease_until:new Date(Date.now()+300000).toISOString()});};
 const ids={employeeId:job.employee_id,guestId:job.guest_id,bonusId:job.bonus_id};
 try{
  await save(); // still ours before the first destructive step
  // No Quick Resto records: skip that cleanup (and the connection requirement), Telegram still runs.
  if(hasQuickRestoWork(ids)){
  const connection=await getConnection(job.account_id);
  if(!connection)throw new Error('Подключите Quick Resto для завершения увольнения');
  const rows = async(path:string,query:Record<string,string|number>={})=>{
   const all:RemoteRow[]=[];
   for(let start=0;start<20000;start+=200){
    const page=await withBackOfficeSession({connection,admin:db,run:authorization=>callQuickRestoBackOfficeData<{ds?:{object:RemoteRow}[];utilityData?:{totalCount?:number}}>({layerName:connection.login,baseUrl:connection.backoffice_base_url,authorization,path,query:{...query,start,count:200}})});
    if(!Array.isArray(page.ds))throw new Error('Quick Resto вернул неполный список для проверки удаления');
    const items=page.ds.map(x=>x.object);
    if(items.some(x=>!Number.isSafeInteger(x?.id)))throw new Error('Quick Resto вернул некорректные записи');
    all.push(...items);
    const total=Number(page.utilityData?.totalCount);
    if(Number.isFinite(total) ? all.length>=total : items.length<200)return all;
    if(items.length===0)throw new Error('Quick Resto не завершил список для проверки удаления');
   }
   throw new Error('Список Quick Resto слишком большой для безопасной проверки удаления');
  };
  const password=decryptSecret({encrypted:connection.password_encrypted,iv:connection.password_iv,tag:connection.password_tag});
  let debitAuth:Awaited<ReturnType<typeof getBackOfficeAuth>>|null=null;
  await removeStaffFromQuickResto({ids,done:job.steps,save,transport:{rows,
   remove:async(moduleName,className,entityId)=>{
    const url=new URL('/platform/online/api/remove',buildQuickRestoBackOfficeOrigin({layerName:connection.login,baseUrl:connection.backoffice_base_url}));
    url.searchParams.set('moduleName',moduleName);url.searchParams.set('className',className);
    const response=await quickRestoFetch(url.toString(),{method:'POST',headers:{Authorization:'Basic '+Buffer.from(`${connection.login}:${password}`).toString('base64'),'Content-Type':'application/json'},body:JSON.stringify({id:entityId}),redirect:'manual',signal:AbortSignal.timeout(25000)},{retryNetwork:false});
    if(!response.ok)throw new Error(`Quick Resto не подтвердил удаление (HTTP ${response.status})`);
    // The subsequent read is the success signal, not HTTP 200 or an empty body.
   },
   removeChild:async(path,row,query)=>{await withBackOfficeSession({connection,admin:db,run:authorization=>callQuickRestoBackOfficeRemove({layerName:connection.login,baseUrl:connection.backoffice_base_url,authorization,path,query,body:row})});},
   closeBonus:async(row,query)=>{await withBackOfficeSession({connection,admin:db,run:authorization=>callQuickRestoBackOfficeData({layerName:connection.login,baseUrl:connection.backoffice_base_url,authorization,path:'crm.accounting.account/update',query,body:{...row,accountState:'closed'}})});},
   // Auth is obtained before the write-off marker: a login failure must not force a manual write-off.
   prepareDebit:async()=>{debitAuth=await getBackOfficeAuth({connection,admin:db});},
   debitBonus:async(row,amount)=>{
    // Same request as the payroll bonus worker; no auth refresh or retry may wrap this POST.
    const authorization=debitAuth??await getBackOfficeAuth({connection,admin:db});debitAuth=null;
    const result=await callQuickRestoBackOfficeData<unknown>({layerName:connection.login,baseUrl:connection.backoffice_base_url,authorization,
     path:'crm.accounting.account/action',query:{businessDayOffsetInMs:32400000,mode:'bonuses',timeZone:-180},
     body:{actionName:'accountDebit',data:{className:'accountDebitModal',ownerContextIds:[Number(row.id)],amount,timeZone:-180},ids:[Number(row.id)],
      owner:{ownerContextId:Number(job.guest_id),ownerContextClassName:'ru.edgex.quickresto.modules.crm.customer.CrmCustomer'}}});
    if(typeof result!=='object'||result===null||'error' in result||'errors' in result||('success' in result&&result.success===false))
     throw new Error('Quick Resto не подтвердил списание остатка бонусов');
    // The following balance read is the success signal.
   },
  }});
  }
  // Telegram runs after Quick Resto; its failures keep their own text (see catch below). A lost lease stays a lost lease.
  const telegram=async(step:()=>Promise<void>)=>{try{await step();}catch(e){throw e instanceof TelegramStepError||e instanceof LeaseLostError?e:new TelegramStepError('Шаг Telegram не выполнен: '+(e instanceof Error?e.message:'неизвестная ошибка'));}};
  if(!job.steps.telegram){await save();await telegram(()=>removeFromTelegram(db,job,save));job.steps.telegram=true;await save();}
  if(!job.steps.telegram_report){
   let sent=false;await telegram(async()=>{sent=await reportTermination(db,job);});
   job.steps.telegram_report=true;if(!sent)job.steps.telegram_report_skipped=true;await save();
  }
  await leasedUpdate(db,'staff_terminations',job,{state:'complete',completed_at:new Date().toISOString(),error:null,lease_until:null,steps:job.steps});
  return true;
 }catch(error){
  if(error instanceof LeaseLostError)throw error;
  let message=error instanceof Error?error.message:'Не удалось закрыть внешний доступ';
  if(!(error instanceof TelegramStepError)){
  const http=message.match(/(?:ошибку|HTTP)\s*(\d{3})/i)?.[1];
  if(http==='403')message='У подключения CRM недостаточно прав Quick Resto для удаления';
  else if(http==='401')message='Не удалось подтвердить вход в Quick Resto. Проверьте подключение';
  else if(http)message=`Quick Resto отклонил удаление (код ${http}). Проверьте состояние связанных записей`;
  else if(/timed out|fetch failed|ECONN|ENOTFOUND/i.test(message))message='Quick Resto не ответил. Повтор сначала проверит, какие записи уже удалены';
  }
  await leasedUpdate(db,'staff_terminations',job,{state:'error',error:message.slice(0,1500),lease_until:null,steps:job.steps,available_at:new Date(Date.now()+Math.min(3600000,30000*2**job.attempts)).toISOString()});
  throw new Error(message);
 }
}
const eventKey=(job:Job)=>'termination:'+job.id;
async function chatOutcomes(db:LooseAdmin,job:Job){
 const chats=checked(await db.from<{chat_id:string;title:string}[]>('telegram_chats').select('chat_id,title').eq('account_id',job.account_id).is('archived_at',null).order('created_at'));
 const journal=checked(await db.from<{chat_id:string;result:ChatOutcome['result'];detail:string|null}[]>('staff_telegram_actions').select('chat_id,result,detail')
  .eq('account_id',job.account_id).eq('event_key',eventKey(job)).eq('kind','remove'));
 return {chats:chats??[],journal:journal??[]};
}
async function removeFromTelegram(db:LooseAdmin,job:Job,save:()=>Promise<void>){
 const [bot,{chats,journal}]=await Promise.all([loadTelegramBot(db,job.account_id),chatOutcomes(db,job)]);
 const clearAllChatsMarker=async()=>{checked(await db.from('staff_telegram_actions').delete().eq('account_id',job.account_id).eq('event_key',eventKey(job)).eq('chat_id',ALL_CHATS));};
 // No bot and no chats: nothing to remove the person from; the step is not applicable.
 if(!telegramStepApplies({configured:!!bot,chats})){job.steps.telegram_skipped=true;await clearAllChatsMarker();return;}
 delete job.steps.telegram_skipped;
 // Only the ID snapshotted by staff_begin_termination is used (set at dismissal start, refreshed by a
 // manual «Повторить»); the live profile is never read here — the fired person could edit it.
 const record=async(o:ChatOutcome)=>{checked(await db.from('staff_telegram_actions').upsert({account_id:job.account_id,user_id:job.user_id,kind:'remove',
  event_key:eventKey(job),chat_id:o.chat_id,result:o.result,detail:o.detail,created_at:new Date().toISOString()},{onConflict:'account_id,event_key,chat_id'}));};
 const missing=async()=>{throw new Error('Telegram не настроен');};
 const outcomes=await removeFromTelegramChats({configured:!!bot,telegramId:job.telegram_id,chats,previous:journal,transport:{
  getChatMember:bot?bot.getChatMember:missing,banChatMember:bot?bot.banChatMember:missing,unbanChatMember:bot?bot.unbanChatMember:missing,record,save}});
 if(!removalComplete(outcomes.map(o=>o.result)))
  throw new TelegramStepError('Не подтверждено исключение из чатов: '+unconfirmedChats(outcomes)+'. Повтор проверит только эти чаты');
 // A stale "all chats" marker from an earlier blocked attempt no longer describes the result.
 await clearAllChatsMarker();
}
/** Returns false when there is no reports chat: the report is skipped, it never blocks the dismissal. */
async function reportTermination(db:LooseAdmin,job:Job):Promise<boolean>{
 const bot=await loadTelegramBot(db,job.account_id);
 if(!bot?.reportsChatId)return false;
 const [person,{chats,journal}]=await Promise.all([
  db.from<{first_name:string|null;last_name:string|null}>('profiles').select('first_name,last_name').eq('id',job.user_id).maybeSingle().then(checked),
  chatOutcomes(db,job),
 ]);
 const results=new Map(journal.map(r=>[r.chat_id,r]));
 const outcomes:ChatOutcome[]=chats.filter(c=>results.has(c.chat_id)).map(c=>({chat_id:c.chat_id,title:c.title,result:results.get(c.chat_id)!.result,detail:null}));
 const writtenOff=Object.entries(job.steps).filter(([k,v])=>k.startsWith('bonus_writeoff_')&&typeof v==='number').map(([,v])=>v as number);
 const name=[person?.first_name,person?.last_name].filter(Boolean).join(' ')||'Сотрудник';
 const sent=await bot.sendMessage(bot.reportsChatId,terminationReport(name,outcomes,writtenOff,job.telegram_id));
 if(!sent.ok)throw new TelegramStepError('Telegram не принял отчёт об увольнении. Повтор отправит только отчёт');
 return true;
}
export async function processStaffTerminations(){
 try{return {processed:await processStaffTermination()?1:0,errors:0};}
 catch{return {processed:0,errors:1};}
}
