import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { asLooseDb } from '@/lib/supabase/loose';
import { decryptSecret } from '@/lib/integrations/crypto';
import { getConnection, withBackOfficeSession } from '@/app/(dashboard)/inventory/actions-shared';
import { buildQuickRestoBackOfficeOrigin, callQuickRestoBackOfficeData, callQuickRestoBackOfficeRemove, quickRestoFetch } from '@/lib/integrations/quickresto/client';
import { removeStaffFromQuickResto, type RemoteRow } from './termination-remote';
type Job = {id:string;account_id:string;employee_id:number|null;guest_id:number|null;bonus_id:number|null;steps:Record<string,boolean>;attempts:number};
const checked = <T>(r:{data:T|null;error:{message:string}|null}):T => {if(r.error)throw new Error(r.error.message);return r.data as T;};

export async function processStaffTermination(id?:string) {
 const db=asLooseDb(createAdminClient());
 const job=checked(await db.rpc('staff_claim_termination',{p_id:id??null})) as Job|null;
 if(!job)return false;
 const save = async()=>{checked(await db.from('staff_terminations').update({steps:job.steps,lease_until:new Date(Date.now()+300000).toISOString()}).eq('id',job.id));};
 try{
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
  await removeStaffFromQuickResto({ids:{employeeId:job.employee_id,guestId:job.guest_id,bonusId:job.bonus_id},done:job.steps,save,transport:{rows,
   remove:async(moduleName,className,entityId)=>{
    const url=new URL('/platform/online/api/remove',buildQuickRestoBackOfficeOrigin({layerName:connection.login,baseUrl:connection.backoffice_base_url}));
    url.searchParams.set('moduleName',moduleName);url.searchParams.set('className',className);
    const response=await quickRestoFetch(url.toString(),{method:'POST',headers:{Authorization:'Basic '+Buffer.from(`${connection.login}:${password}`).toString('base64'),'Content-Type':'application/json'},body:JSON.stringify({id:entityId}),redirect:'manual',signal:AbortSignal.timeout(25000)},{retryNetwork:false});
    if(!response.ok)throw new Error(`Quick Resto не подтвердил удаление (HTTP ${response.status})`);
    // The subsequent read is the success signal, not HTTP 200 or an empty body.
   },
   removeChild:async(path,row,query)=>{await withBackOfficeSession({connection,admin:db,run:authorization=>callQuickRestoBackOfficeRemove({layerName:connection.login,baseUrl:connection.backoffice_base_url,authorization,path,query,body:row})});},
   closeBonus:async(row,query)=>{await withBackOfficeSession({connection,admin:db,run:authorization=>callQuickRestoBackOfficeData({layerName:connection.login,baseUrl:connection.backoffice_base_url,authorization,path:'crm.accounting.account/update',query,body:{...row,accountState:'closed'}})});},
  }});
  checked(await db.from('staff_terminations').update({state:'complete',completed_at:new Date().toISOString(),error:null,lease_until:null,steps:job.steps}).eq('id',job.id));
  return true;
 }catch(error){
  let message=error instanceof Error?error.message:'Не удалось закрыть внешний доступ';
  const http=message.match(/(?:ошибку|HTTP)\s*(\d{3})/i)?.[1];
  if(http==='403')message='У подключения CRM недостаточно прав Quick Resto для удаления';
  else if(http==='401')message='Не удалось подтвердить вход в Quick Resto. Проверьте подключение';
  else if(http)message=`Quick Resto отклонил удаление (код ${http}). Проверьте состояние связанных записей`;
  else if(/timed out|fetch failed|ECONN|ENOTFOUND/i.test(message))message='Quick Resto не ответил. Повтор сначала проверит, какие записи уже удалены';
  checked(await db.from('staff_terminations').update({state:'error',error:message.slice(0,1500),lease_until:null,steps:job.steps,available_at:new Date(Date.now()+Math.min(3600000,30000*2**job.attempts)).toISOString()}).eq('id',job.id));
  throw new Error(message);
 }
}
export async function processStaffTerminations(){
 try{return {processed:await processStaffTermination()?1:0,errors:0};}
 catch{return {processed:0,errors:1};}
}
