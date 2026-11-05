/** Recovering a dismissed employee's previous Quick Resto records. Pure: all I/O goes through the transport. */
export type RemoteRow = Record<string, unknown>;
export type RestoreIds = { employeeId: number | null; guestId: number | null };
export type RestoreSettings = { staffGroupId: number; bonusAccountTypeId: number; storeIds: number[] };
export type RestoreTransport = {
  rows: (path: string, query?: Record<string, string | number>) => Promise<RemoteRow[]>;
  recover: (moduleName: 'personnel.employee' | 'crm.customer', row: RemoteRow) => Promise<void>;
  readGuest: (id: number) => Promise<RemoteRow>;
  updateGuest: (row: RemoteRow) => Promise<void>;
  createStoreLink: (storeId: number, employeeId: number) => Promise<void>;
  createBonus: (guestId: number, accountTypeId: number) => Promise<void>;
};
export type RestoreSteps = Record<string, boolean | number>;

export const NOT_RECOVERABLE = 'Запись Quick Resto не восстанавливается: заведите сотрудника заново через приём';
export const customerClass = 'ru.edgex.quickresto.modules.crm.customer.CrmCustomer';
export const storeClass = 'ru.edgex.quickresto.modules.warehouse.store.Store';
const notFound = (e: unknown) => e instanceof Error && /not\s*found|entityNotFound|не найден|doesn'?t exist|\b404\b/i.test(e.message);
const object = (x: unknown): RemoteRow => (x && typeof x === 'object' ? (x as RemoteRow) : {});

export async function recoverStaffInQuickResto({ids,settings,transport,done,save}: {
  ids: RestoreIds;
  settings: RestoreSettings;
  transport: RestoreTransport;
  done: RestoreSteps;
  save: () => Promise<void>;
}): Promise<{ bonusId: number | null }> {
  for (const id of Object.values(ids)) if (id !== null && (!Number.isSafeInteger(id) || id <= 0))
    throw new Error('Некорректная связь сотрудника с Quick Resto');
  const employees = () => transport.rows('personnel.employee/select', {showDeleted:'true'});
  const guests = () => transport.rows('crm.customer/select', {showDeleted:'true'});
  const find = async (list: () => Promise<RemoteRow[]>, id: number) => (await list()).find(x => Number(x.id) === id);

  // Both records must still exist before either is touched: no half-restored person in Quick Resto.
  const employee = ids.employeeId ? await find(employees, ids.employeeId) : null;
  const guest = ids.guestId ? await find(guests, ids.guestId) : null;
  if ((ids.employeeId && !employee) || (ids.guestId && !guest)) throw new Error(NOT_RECOVERABLE);

  const recover = async (key: string, moduleName: 'personnel.employee' | 'crm.customer', row: RemoteRow, reread: () => Promise<RemoteRow | undefined>) => {
    // A stored success is not evidence of remote state; the read decides.
    if (row.deleted === true) {
      try { await transport.recover(moduleName, row); }
      catch (e) { if (notFound(e)) throw new Error(NOT_RECOVERABLE); throw e; }
      const after = await reread();
      if (!after || after.deleted === true) throw new Error(NOT_RECOVERABLE);
    }
    done[key] = true;
    await save();
  };

  if (ids.employeeId && employee) {
    const employeeId = ids.employeeId;
    await recover('employee', 'personnel.employee', employee, () => find(employees, employeeId));
    // Dismissal removed warehouse access; give back the hire-time stores.
    for (const storeId of settings.storeIds) {
      const query = {ownerContextId:storeId, ownerContextClassName:storeClass};
      const linked = async () => (await transport.rows('warehouse.store.employee/select', query))
        .some(x => Number(object(x.employee).id) === employeeId && x.deleted !== true);
      if (!(await linked())) {
        await transport.createStoreLink(storeId, employeeId);
        if (!(await linked())) throw new Error('Quick Resto не подтвердил доступ к складу ' + storeId);
      }
      done['store_' + storeId] = true;
      await save();
    }
  }

  if (!ids.guestId || !guest) return { bonusId: null };
  const guestId = ids.guestId;
  await recover('guest', 'crm.customer', guest, () => find(guests, guestId));
  const current = await transport.readGuest(guestId);
  if (Number(object(current.customerGroup).id) !== settings.staffGroupId) {
    await transport.updateGuest({...current, customerGroup:{id:settings.staffGroupId}});
    if (Number(object((await transport.readGuest(guestId)).customerGroup).id) !== settings.staffGroupId)
      throw new Error('Quick Resto не подтвердил группу Staff для гостя');
  }
  done.guest_group = true;
  await save();

  // The previous account was closed on dismissal; an open one of the staff type is reused (re-read before create).
  const query = {mode:'bonuses', ownerContextId:guestId, ownerContextClassName:customerClass};
  const openBonus = async () => {
    const open = (await transport.rows('crm.accounting.account/select', query)).filter(x =>
      Number(object(x.accountType).id) === settings.bonusAccountTypeId && x.deleted !== true && x.accountState !== 'closed');
    if (open.length > 1) throw new Error('Найдено несколько бонусных счетов сотрудника. Нужна проверка');
    return open[0] ?? null;
  };
  let bonus = await openBonus();
  if (!bonus) {
    await transport.createBonus(guestId, settings.bonusAccountTypeId);
    bonus = await openBonus();
    if (!bonus || !Number.isSafeInteger(Number(bonus.id))) throw new Error('Quick Resto не подтвердил создание бонусного счёта');
  }
  done.bonus = Number(bonus.id);
  await save();
  return { bonusId: Number(bonus.id) };
}
