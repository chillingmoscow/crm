/** External cleanup has no authority to delete local employment history. */
export type RemoteRow = Record<string, unknown>;
export type TerminationIds = { employeeId: number | null; guestId: number | null; bonusId: number | null };
export type TerminationTransport = {
  rows: (path: string, query?: Record<string, string | number>) => Promise<RemoteRow[]>;
  remove: (moduleName: string, className: string, id: number) => Promise<void>;
  removeChild: (path: string, row: RemoteRow, query: Record<string, string | number>) => Promise<void>;
};
/** Step markers. Older jobs may still carry `bonus_writeoff_<id>` amounts from the removed write-off. */
export type TerminationSteps = Record<string, boolean | number>;
const customerClass = 'ru.edgex.quickresto.modules.crm.customer.CrmCustomer';
const employeeClass = 'ru.edgex.quickresto.modules.personnel.employee.Employee';
const inactive = (row: RemoteRow | undefined) => !row || row.deleted === true;
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
  // Same as the previous n8n flow: the guest is deleted as is. Bonus accounts are not written off,
  // closed or removed; a later restore reuses the open staff account.
  if (ids.guestId) {
    await step('guest',async () => inactive((await transport.rows('crm.customer/select',{showDeleted:'true'})).find(x=>Number(x.id)===ids.guestId)),
      () => transport.remove('crm.customer',customerClass,ids.guestId!));
  }
}
