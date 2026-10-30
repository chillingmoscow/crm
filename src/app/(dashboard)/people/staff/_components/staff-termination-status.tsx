"use client";
import {useEffect,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {CheckCircle2,AlertCircle,Loader2} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {retryStaffTermination} from '../actions';
export function StaffTerminationStatus({uvrId,status,doorNumbers=[]}:{uvrId:string;doorNumbers?:number[];status:{state:string;error:string|null;door_revoked:boolean;shared_access:boolean;employee_id:number|null;guest_id:number|null;attempts:number}}){
 const router=useRouter(),[busy,start]=useTransition();
 const complete=status.state==='complete';
 useEffect(()=>{
  if(complete||(status.state==='error'&&status.attempts>=5))return;
  const timer=setInterval(()=>router.refresh(),5000);
  return()=>clearInterval(timer);
 },[complete,status.state,status.attempts,router]);
 const Icon=complete?CheckCircle2:status.state==='error'?AlertCircle:Loader2;
 return <div className="mx-4 mt-4 rounded-xl border bg-card px-4 py-3 md:mx-8" role="status">
  <div className="flex items-start gap-3">
   <Icon className={'mt-0.5 size-4 shrink-0 '+(complete?'text-emerald-600':status.state==='error'?'text-destructive':'animate-spin text-muted-foreground')}/>
   <div className="min-w-0 flex-1 space-y-1 text-sm">
    <p className="font-medium">{complete?(status.shared_access||(!status.employee_id&&!status.guest_id)?'Доступ к этому заведению закрыт':'Доступ закрыт, удаление в Quick Resto подтверждено'):status.state==='error'?'Доступ к заведению закрыт, внешнее удаление требует проверки':'Доступ к заведению закрыт, завершаем удаление в Quick Resto'}</p>
    {status.shared_access&&<p className="text-muted-foreground">Сотрудник работает в другом заведении аккаунта. Общий доступ Quick Resto и код замка сохранены.</p>}
    {status.state==='error'&&status.error&&<p className="break-words text-muted-foreground">{status.error}</p>}
    {status.door_revoked&&<p className="text-muted-foreground">Код замка отозван в CRM. Если он был записан в физический замок, удалите {doorNumbers.length?'пользователя № '+doorNumbers.join(', '):'его'} из замка вручную.</p>}
   </div>
   {!complete&&<Button size="sm" variant="outline" disabled={busy||status.state==='working'} onClick={()=>start(async()=>{const r=await retryStaffTermination(uvrId);if(r.error)toast.error(r.error);else toast.success('Удаление подтверждено');router.refresh();})}>{busy?'Проверяем…':'Продолжить'}</Button>}
  </div>
 </div>;
}
