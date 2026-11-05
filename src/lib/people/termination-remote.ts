/** External cleanup has no authority to delete local employment history. */
export type RemoteRow = Record<string, unknown>;
export type TerminationIds = { employeeId: number | null; guestId: number | null; bonusId: number | null };
export type TerminationTransport = {
  rows: (path: string, query?: Record<string, string | number>) => Promise<RemoteRow[]>;
  remove: (moduleName: string, className: string, id: number) => Promise<void>;
  removeChild: (path: string, row: RemoteRow, query: Record<string, string | number>) => Promise<void>;
  closeBonus: (row: RemoteRow, query: Record<string, string | number>) => Promise<void>;
  /** Obtains back-office auth for the next debit, before the write-off marker is stored. */
  prepareDebit?: () => Promise<void>;
  /** A single accountDebit; never retried by the transport (no idempotency key in Quick Resto). */
  debitBonus: (row: RemoteRow, amount: number, query: Record<string, string | number>) => Promise<void>;
};
/** Step markers; a bonus write-off stores its amount (`bonus_writeoff_<id>`). */
export type TerminationSteps = Record<string, boolean | number>;
const customerClass = 'ru.edgex.quickresto.modules.crm.customer.CrmCustomer';
const employeeClass = 'ru.edgex.quickresto.modules.personnel.employee.Employee';
const inactive = (row: RemoteRow | undefined) => !row || row.deleted === true;
const balanceOf = (value: unknown) => {
  if (!value || typeof value !== 'object') return null;
  const balance = value as RemoteRow;
  const read = (k: string) => balance[k] !== null && balance[k] !== '' && Number.isFinite(Number(balance[k])) ? Number(balance[k]) : null;
  const [ledger, available, debitHold, creditHold] = ['ledger', 'available', 'debitHold', 'creditHold'].map(read);
  if (ledger === null || available === null || debitHold === null || creditHold === null) return null;
  return { ledger, available, debitHold, creditHold };
};
const zeroBalance = (value: unknown) => {
  const b = balanceOf(value);
  return !!b && b.ledger === 0 && b.available === 0 && b.debitHold === 0 && b.creditHold === 0;
};
/** Only a plain positive balance without holds may be written off; the amount is the whole of it. */
const writeOffAmount = (row: RemoteRow) => {
  const b = balanceOf(row.accountBalance);
  if (row.accountState !== 'open' || !b || b.debitHold !== 0 || b.creditHold !== 0) return null;
  return b.available > 0 && b.ledger === b.available ? b.available : null;
};

/** A dismissal touches Quick Resto only when the person is linked to an employee or a guest there. */
export const hasQuickRestoWork = (ids: TerminationIds) => ids.employeeId !== null || ids.guestId !== null;

export async function removeStaffFromQuickResto({ids,transport,done,save}: {
  ids: TerminationIds;
  transport: TerminationTransport;
  done: TerminationSteps;
  save: () => Promise<void>;
}) {
  for (const id of Object.values(ids)) if (id !== null && (!Number.isSafeInteger(id) || id <= 0))
    throw new Error('Некорректная связь сотрудника с Quick Resto');
  if (ids.bonusId && !ids.guestId) throw new Error('Бонусный счёт не связан с гостем');
  const step = async (key: string, isRemoved: () => Promise<boolean>, remove: () => Promise<void>) => {
    // Even a stored success is read again: it is not evidence of current remote state.
    if (!(await isRemoved())) {
      // save() also proves the job is still ours; it runs before every destructive write.
      await save();
      await remove();
      if (!(await isRemoved())) throw new Error('Quick Resto не подтвердил удаление: ' + key);
    }
    done[key] = true;
    await save();
  };
  if (ids.employeeId) {
    await step('employee', async () => inactive((await transport.rows('personnel.employee/select', {showDeleted:'true'})).find(x=>Number(x.id)===ids.employeeId)),
      () => transport.remove('personnel.employee', employeeClass, ids.employeeId!));
    // Employee removal does not imply warehouse link removal.
    for (const store of await transport.rows('warehouse.store/select')) {
      const query = {ownerContextId:Number(store.id),ownerContextClassName:'ru.edgex.quickresto.modules.warehouse.store.Store'};
      const links = () => transport.rows('warehouse.store.employee/select', query);
      for (const link of (await links()).filter(x=>Number((x.employee as RemoteRow)?.id)===ids.employeeId && !x.deleted)) {
        await step('store_' + store.id + '_' + link.id,
          async () => inactive((await links()).find(x=>x.id===link.id)),
          () => transport.removeChild('warehouse.store.employee/remove',link,query));
      }
    }
    done.stores = true; await save();
  }
  if (ids.guestId) {
    const query = {mode:'bonuses',ownerContextId:ids.guestId,ownerContextClassName:customerClass};
    const accounts = () => transport.rows('crm.accounting.account/select',query);
    let bonuses = await accounts();
    // A linked account must belong to this exact guest, never search globally by name.
    if (ids.bonusId && !bonuses.some(x=>Number(x.id)===ids.bonusId) && !done['bonus_owner_' + ids.bonusId])
      throw new Error('Не подтверждён владелец бонусного счёта Quick Resto');
    for (const bonus of bonuses) done['bonus_owner_' + bonus.id] = true;
    await save();
    for (const bonus of bonuses.filter(x=>!x.deleted)) {
      if (!zeroBalance(bonus.accountBalance)) {
        const key = 'bonus_writeoff_' + bonus.id;
        // The marker is durable before the POST: a second debit is never sent automatically.
        // A retry relies on the balance read above — zero means the earlier write-off landed.
        if (done[key] !== undefined)
          throw new Error('Списание остатка бонусов не подтверждено: баланс не обнулился. Проверьте бонусный счёт в Quick Resto и обнулите его вручную');
        const amount = writeOffAmount(bonus);
        if (amount === null) throw new Error('На бонусном счёте есть остаток или удержания. Завершите расчёт перед удалением гостя');
        // An auth failure here is retryable: nothing has been sent and no marker is stored yet.
        await transport.prepareDebit?.();
        done[key] = amount;
        await save();
        await transport.debitBonus(bonus, amount, query);
        const after = (await accounts()).find(x=>x.id===bonus.id);
        if (!after || !zeroBalance(after.accountBalance))
          throw new Error('Списание остатка бонусов не подтверждено: баланс не обнулился. Проверьте бонусный счёт в Quick Resto и обнулите его вручную');
        Object.assign(bonus, after);
      }
      if (bonus.accountState !== 'closed') {
        await save();
        await transport.closeBonus(bonus,query);
        const closed=(await accounts()).find(x=>x.id===bonus.id);
        if (!closed || closed.accountState !== 'closed' || !zeroBalance(closed.accountBalance))
          throw new Error('Quick Resto не подтвердил закрытие нулевого бонусного счёта');
        Object.assign(bonus,closed);
      }
      await step('bonus_' + bonus.id,
        async () => inactive((await accounts()).find(x=>x.id===bonus.id)),
        () => transport.removeChild('crm.accounting.account/remove',bonus,query));
    }
    bonuses = await accounts();
    if (bonuses.some(x=>!x.deleted)) throw new Error('Остались активные бонусные счета Quick Resto');
    await step('guest',async () => inactive((await transport.rows('crm.customer/select',{showDeleted:'true'})).find(x=>Number(x.id)===ids.guestId)),
      () => transport.remove('crm.customer',customerClass,ids.guestId!));
    done.bonus = true; await save();
  }
}
