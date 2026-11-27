import 'server-only';
// I/O shared by the dismissal of a staff member and of a casual worker:
// Quick Resto removal transport, chat removal with the journal, the report.
import { decryptSecret } from '@/lib/integrations/crypto';
import { getConnection, withBackOfficeSession } from '@/app/(dashboard)/inventory/actions-shared';
import { buildQuickRestoBackOfficeOrigin, callQuickRestoBackOfficeData, callQuickRestoBackOfficeRemove, quickRestoFetch } from '@/lib/integrations/quickresto/client';
import { loadTelegramBot } from '@/lib/integrations/telegram-bot';
import { removalComplete } from '@/lib/integrations/telegram-membership';
import { revokeStaffChatInvites } from './chat-invites-revoke';
import type { asLooseDb } from '@/lib/supabase/loose';
import type { RemoteRow, TerminationSteps, TerminationTransport } from './termination-remote';
import { ALL_CHATS, removeFromTelegramChats, telegramStepApplies, terminationReport, unconfirmedChats, type ChatOutcome } from './termination-telegram';

export type LooseAdmin = ReturnType<typeof asLooseDb>;
/** Telegram failures carry their own text; they must not be rewritten as Quick Resto errors. */
export class TelegramStepError extends Error {}
export const checked = <T>(r:{data:T|null;error:{message:string}|null}):T => {if(r.error)throw new Error(r.error.message);return r.data as T;};

/** Quick Resto transport for removeStaffFromQuickResto. */
export async function quickRestoRemovalTransport(db:LooseAdmin,accountId:string):Promise<TerminationTransport>{
 const connection=await getConnection(accountId);
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
 return {rows,
  remove:async(moduleName,className,entityId)=>{
   const url=new URL('/platform/online/api/remove',buildQuickRestoBackOfficeOrigin({layerName:connection.login,baseUrl:connection.backoffice_base_url}));
   url.searchParams.set('moduleName',moduleName);url.searchParams.set('className',className);
   const response=await quickRestoFetch(url.toString(),{method:'POST',headers:{Authorization:'Basic '+Buffer.from(`${connection.login}:${password}`).toString('base64'),'Content-Type':'application/json'},body:JSON.stringify({id:entityId}),redirect:'manual',signal:AbortSignal.timeout(25000)},{retryNetwork:false});
   if(!response.ok)throw new Error(`Quick Resto не подтвердил удаление (HTTP ${response.status})`);
   // The subsequent read is the success signal, not HTTP 200 or an empty body.
  },
  removeChild:async(path,row,query)=>{await withBackOfficeSession({connection,admin:db,run:authorization=>callQuickRestoBackOfficeRemove({layerName:connection.login,baseUrl:connection.backoffice_base_url,authorization,path,query,body:row})});},
 };
}

/** User-facing text for a failed Quick Resto removal step. */
export function quickRestoRemovalMessage(message:string){
 const http=message.match(/(?:ошибку|HTTP)\s*(\d{3})/i)?.[1];
 if(http==='403')return 'У подключения CRM недостаточно прав Quick Resto для удаления';
 if(http==='401')return 'Не удалось подтвердить вход в Quick Resto. Проверьте подключение';
 if(http)return `Quick Resto отклонил удаление (код ${http}). Проверьте состояние связанных записей`;
 if(/timed out|fetch failed|ECONN|ENOTFOUND/i.test(message))return 'Quick Resto не ответил. Повтор сначала проверит, какие записи уже удалены';
 return message;
}

/** Runs a Telegram step so that its failure keeps its own text. A lost lease stays a lost lease. */
export async function telegramStep(step:()=>Promise<void>,passThrough:(e:unknown)=>boolean){
 try{await step();}
 catch(e){throw e instanceof TelegramStepError||passThrough(e)?e:new TelegramStepError('Шаг Telegram не выполнен: '+(e instanceof Error?e.message:'неизвестная ошибка'));}
}

export type ChatRemovalJob = {
 accountId:string;
 /** Journal identity: the profile id of a staff member, the payroll record id of a casual worker. */
 userId:string;
 eventKey:string;
 /** The ID snapshotted on the job, never the live profile. */
 telegramId:string|null;
 steps:TerminationSteps;
};

async function chatOutcomes(db:LooseAdmin,accountId:string,eventKey:string){
 const chats=checked(await db.from<{chat_id:string;title:string}[]>('telegram_chats').select('chat_id,title').eq('account_id',accountId).is('archived_at',null).order('created_at'));
 const journal=checked(await db.from<{chat_id:string;result:ChatOutcome['result'];detail:string|null}[]>('staff_telegram_actions').select('chat_id,result,detail')
  .eq('account_id',accountId).eq('event_key',eventKey).eq('kind','remove'));
 return {chats:chats??[],journal:journal??[]};
}

/** Removes the person from every organization chat; throws TelegramStepError until every chat is confirmed. */
export async function removeFromChatsJournaled(db:LooseAdmin,job:ChatRemovalJob,save:()=>Promise<void>){
 const [bot,{chats,journal}]=await Promise.all([loadTelegramBot(db,job.accountId),chatOutcomes(db,job.accountId,job.eventKey)]);
 const clearAllChatsMarker=async()=>{checked(await db.from('staff_telegram_actions').delete().eq('account_id',job.accountId).eq('event_key',job.eventKey).eq('chat_id',ALL_CHATS));};
 // No bot and no chats: nothing to remove the person from; the step is not applicable.
 if(!telegramStepApplies({configured:!!bot,chats})){job.steps.telegram_skipped=true;await clearAllChatsMarker();return;}
 delete job.steps.telegram_skipped;
 // Unused invite links stay valid after a dismissal: revoke them first, so the
 // person cannot join a chat right after being removed from it.
 if(bot&&!job.steps.invite_links){await revokeStaffChatInvites(db,bot,job.accountId,job.userId);job.steps.invite_links=true;await save();}
 const record=async(o:ChatOutcome)=>{checked(await db.from('staff_telegram_actions').upsert({account_id:job.accountId,user_id:job.userId,kind:'remove',
  event_key:job.eventKey,chat_id:o.chat_id,result:o.result,detail:o.detail,created_at:new Date().toISOString()},{onConflict:'account_id,event_key,chat_id'}));};
 const missing=async()=>{throw new Error('Telegram не настроен');};
 const outcomes=await removeFromTelegramChats({configured:!!bot,telegramId:job.telegramId,chats,previous:journal,transport:{
  getChatMember:bot?bot.getChatMember:missing,banChatMember:bot?bot.banChatMember:missing,unbanChatMember:bot?bot.unbanChatMember:missing,record,save}});
 if(!removalComplete(outcomes.map(o=>o.result)))
  throw new TelegramStepError('Не подтверждено исключение из чатов: '+unconfirmedChats(outcomes)+'. Повтор проверит только эти чаты');
 // A stale "all chats" marker from an earlier blocked attempt no longer describes the result.
 await clearAllChatsMarker();
}

/** Returns false when there is no reports chat: the report is skipped, it never blocks the dismissal. */
export async function reportRemoval(db:LooseAdmin,job:ChatRemovalJob,name:string){
 const bot=await loadTelegramBot(db,job.accountId);
 if(!bot?.reportsChatId)return false;
 const {chats,journal}=await chatOutcomes(db,job.accountId,job.eventKey);
 const results=new Map(journal.map(r=>[r.chat_id,r]));
 const outcomes:ChatOutcome[]=chats.filter(c=>results.has(c.chat_id)).map(c=>({chat_id:c.chat_id,title:c.title,result:results.get(c.chat_id)!.result,detail:null}));
 const writtenOff=Object.entries(job.steps).filter(([k,v])=>k.startsWith('bonus_writeoff_')&&typeof v==='number').map(([,v])=>v as number);
 const sent=await bot.sendMessage(bot.reportsChatId,terminationReport(name,outcomes,writtenOff,job.telegramId));
 if(!sent.ok)throw new TelegramStepError('Telegram не принял отчёт об увольнении. Повтор отправит только отчёт');
 return true;
}
