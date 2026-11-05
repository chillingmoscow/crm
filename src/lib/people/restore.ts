import 'server-only';
import { createHash, randomInt } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { asLooseDb } from '@/lib/supabase/loose';
import { decryptSecret, encryptSecret } from '@/lib/integrations/crypto';
import { getConnection, withBackOfficeSession } from '@/app/(dashboard)/inventory/actions-shared';
import { buildQuickRestoBackOfficeOrigin, callQuickRestoBackOfficeData, quickRestoFetch } from '@/lib/integrations/quickresto/client';
import { LeaseLostError, leasedUpdate } from './job-lease';
import { customerClass, NOT_RECOVERABLE, recoverStaffInQuickResto, restoreErrorMessage, storeClass, type RemoteRow, type RestoreSteps } from './restore-remote';

type Job = {
  id: string; account_id: string; venue_id: string; user_id: string; role_id: string | null;
  employee_id: number | null; guest_id: number | null; door_needed: boolean; steps: RestoreSteps; attempts: number;
};
type Settings = { store_ids: number[]; master_store_ids: number[]; staff_group_id: number; bonus_account_type_id: number };
const employeeClass = 'ru.edgex.quickresto.modules.personnel.employee.Employee';
const checked = <T>(r:{data:T|null;error:{message:string}|null}):T => {if(r.error)throw new Error(r.error.message);return r.data as T;};
const object = (x: unknown): RemoteRow => (x && typeof x === 'object' ? (x as RemoteRow) : {});

/** Claims one restore (or the given one), runs its steps and finishes it. Returns false when nothing was claimed. */
export async function processStaffRestore(id?: string) {
  const db = asLooseDb(createAdminClient());
  const job = checked(await db.rpc('staff_claim_restore', {p_id: id ?? null})) as Job | null;
  if (!job) return false;
  // Every write checks the job is still this attempt: a cancelled or re-claimed restore stops here.
  const save = async () => {await leasedUpdate(db,'staff_restorations',job,{steps:job.steps,lease_until:new Date(Date.now()+300000).toISOString()});};
  try {
    await save();
    let bonusId: number | null = null;
    if (job.employee_id !== null || job.guest_id !== null) bonusId = await recoverInQuickResto(db, job, save);
    if (job.door_needed) await reserveDoor(db, job);
    checked(await db.rpc('staff_finish_restore', {p_restore: job.id, p_bonus: bonusId, p_attempts: job.attempts}));
    return true;
  } catch (error) {
    if (error instanceof LeaseLostError) throw error;
    let message = error instanceof Error ? error.message : 'Не удалось вернуть сотрудника';
    const permanent = message === NOT_RECOVERABLE;
    if (!permanent) {
      const http = message.match(/(?:ошибку|HTTP)\s*(\d{3})/i)?.[1];
      if (http === '403') message = 'У подключения CRM недостаточно прав Quick Resto для восстановления';
      else if (http === '401') message = 'Не удалось подтвердить вход в Quick Resto. Проверьте подключение';
      else if (http) message = `Quick Resto отклонил восстановление (код ${http}). Повтор сначала проверит, что уже восстановлено`;
      else if (/timed out|fetch failed|ECONN|ENOTFOUND/i.test(message)) message = 'Quick Resto не ответил. Повтор сначала проверит, что уже восстановлено';
    }
    message = restoreErrorMessage(message, job.steps);
    await leasedUpdate(db, 'staff_restorations', job, {
      state:'error', error:message.slice(0,1500), lease_until:null, steps:job.steps,
      // An erased record will not come back: stop automatic retries, keep the manual one.
      ...(permanent ? {attempts:5} : {}),
      available_at:new Date(Date.now()+Math.min(3600000,30000*2**job.attempts)).toISOString(),
    });
    throw new Error(message);
  }
}

async function recoverInQuickResto(db: ReturnType<typeof asLooseDb>, job: Job, save: () => Promise<void>) {
  const settings = checked(await db.from<Settings>('candidate_employment_settings')
    .select('store_ids,master_store_ids,staff_group_id,bonus_account_type_id')
    .eq('account_id', job.account_id).eq('venue_id', job.venue_id).maybeSingle());
  if (!settings) throw new Error('Заполните настройки приёма для заведения: группа Staff, бонусный счёт, склады');
  const role = job.role_id
    ? checked(await db.from<{name:string}>('roles').select('name').eq('id', job.role_id).maybeSingle())
    : null;
  // Same warehouse access as at hire.
  const storeIds = [...new Set([...settings.store_ids, ...(/мастер/i.test(role?.name ?? '') ? settings.master_store_ids : [])])].map(Number);
  const connection = await getConnection(job.account_id);
  if (!connection) throw new Error('Подключите Quick Resto для возврата сотрудника');
  const session = <T>(path: string, query: Record<string, string | number> = {}, body?: unknown) =>
    withBackOfficeSession({connection, admin:db, run:authorization => callQuickRestoBackOfficeData<T>({
      layerName:connection.login, baseUrl:connection.backoffice_base_url, authorization, path, query, body})});
  const rows = async (path: string, query: Record<string, string | number> = {}) => {
    const all: RemoteRow[] = [];
    for (let start = 0; start < 20000; start += 200) {
      const page = await session<{ds?:{object:RemoteRow}[];utilityData?:{totalCount?:number}}>(path, {...query, start, count:200});
      if (!Array.isArray(page.ds)) throw new Error('Quick Resto вернул неполный список для проверки возврата');
      const items = page.ds.map(x => x.object);
      if (items.some(x => !Number.isSafeInteger(x?.id))) throw new Error('Quick Resto вернул некорректные записи');
      all.push(...items);
      const total = Number(page.utilityData?.totalCount);
      if (Number.isFinite(total) ? all.length >= total : items.length < 200) return all;
      if (items.length === 0) throw new Error('Quick Resto не завершил список для проверки возврата');
    }
    throw new Error('Список Quick Resto слишком большой для безопасной проверки возврата');
  };
  const password = decryptSecret({encrypted:connection.password_encrypted, iv:connection.password_iv, tag:connection.password_tag});
  const readGuest = async (guestId: number) => {
    const url = new URL('/platform/online/api/read', buildQuickRestoBackOfficeOrigin({layerName:connection.login, baseUrl:connection.backoffice_base_url}));
    url.searchParams.set('moduleName', 'crm.customer');
    url.searchParams.set('className', customerClass);
    url.searchParams.set('objectId', String(guestId));
    const response = await quickRestoFetch(url.toString(), {method:'GET', redirect:'manual', signal:AbortSignal.timeout(20000),
      headers:{'Content-Type':'application/json', Authorization:'Basic '+Buffer.from(`${connection.login}:${password}`).toString('base64')}});
    if (!response.ok) throw new Error(`Не удалось проверить гостя Quick Resto (HTTP ${response.status})`);
    const value = object(await response.json());
    const row = Number.isSafeInteger(object(value.data).id) ? object(value.data) : value;
    if (Number(row.id) !== guestId) throw new Error('Quick Resto вернул другого гостя');
    return row;
  };
  const { bonusId } = await recoverStaffInQuickResto({
    ids:{employeeId:job.employee_id, guestId:job.guest_id},
    settings:{staffGroupId:Number(settings.staff_group_id), bonusAccountTypeId:Number(settings.bonus_account_type_id), storeIds},
    done:job.steps, save,
    transport:{
      rows, readGuest,
      // Same request as the former n8n restore; the following read is the success signal.
      recover:async (moduleName, row) => {await session(`${moduleName}/recover`, {businessDayOffsetInMs:32400000, timeZone:-180}, {data:[row], ids:[Number(row.id)]});},
      updateGuest:async row => {await session('crm.customer/update', {}, row);},
      createStoreLink:async (storeId, employeeId) => {
        await session('warehouse.store.employee/create', {ownerContextId:storeId, ownerContextClassName:storeClass}, {
          employee:{id:employeeId, className:employeeClass}, deleted:false, permanent:false,
          className:'ru.edgex.quickresto.modules.warehouse.store.employee.StoreEmployeeLink'});
      },
      createBonus:async (guestId, accountTypeId) => {
        await session('crm.accounting.account/create', {mode:'bonuses', ownerContextId:guestId, ownerContextClassName:customerClass}, {
          version:0, accountState:'open', title:'Депозитный счет', hidden:false, deleted:false, permanent:false,
          accountBalance:{ledger:0, available:0, debitHold:0, creditHold:0},
          className:'ru.edgex.quickresto.modules.crm.accounting.account.CustomerAccount',
          accountType:{id:accountTypeId, className:'ru.edgex.quickresto.modules.crm.accounting.account.type.CustomerAccountType'}});
      },
    },
  });
  return bonusId;
}

/** A new office code from the pool, as at hire; repeated calls return the code already issued. */
async function reserveDoor(db: ReturnType<typeof asLooseDb>, job: Job) {
  encryptSecret('configuration-check');
  for (let attempt = 0; attempt < 100; attempt++) {
    const code = String(randomInt(100000, 1000000));
    const r = await db.rpc('staff_restore_reserve_door', {
      p_restore:job.id, p_attempts:job.attempts, p_number:randomInt(100, 1000),
      p_hash:createHash('sha256').update(code).digest('hex'), p_secret:encryptSecret(code),
    });
    if (!r.error) return;
    if (!/duplicate key|уникальн/i.test(r.error.message)) throw new Error(r.error.message);
  }
  throw new Error('Не удалось подобрать свободные данные замка');
}

export async function processStaffRestores() {
  try { return {processed: await processStaffRestore() ? 1 : 0, errors: 0}; }
  catch { return {processed: 0, errors: 1}; }
}
