import type { TransactionRow } from "@/types/finance";

export const TYPE_LABEL: Record<TransactionRow["type"], string> = {
  income: "Приход",
  expense: "Расход",
  transfer: "Перевод",
};

/** «Новый приход» — заголовок панели создания. */
export const NEW_TYPE_TITLE: Record<TransactionRow["type"], string> = {
  income: "Новый приход",
  expense: "Новый расход",
  transfer: "Новый перевод",
};

/** «Создать приход» — главная кнопка панели создания. */
export const CREATE_TYPE_LABEL: Record<TransactionRow["type"], string> = {
  income: "Создать приход",
  expense: "Создать расход",
  transfer: "Создать перевод",
};

export const SOURCE_LABEL: Record<TransactionRow["source"], string> = {
  manual: "Вручную",
  quickresto: "Quick Resto",
  import: "Импорт",
  bank_sync: "Банк",
};

/**
 * Связь, из-за которой операцию нельзя менять в финансах: её создал раздел
 * «Зарплата», и править или отменять её нужно там (база это и так
 * отклонит). Приходит с сервера полем `locked_by`.
 */
export type TransactionLock = "payroll" | "uniform";

export const LOCK_REASON: Record<TransactionLock, string> = {
  payroll: "Это выплата зарплаты. Изменить или отменить её можно в разделе «Зарплата»",
  uniform: "Это покупка формы сотруднику. Изменить или отменить её можно в разделе «Зарплата»",
};

/** Операция вместе с признаком связи (`finance_transaction_lock`). */
export type LockableTransaction = { locked_by?: TransactionLock | null };

/** Строки списка и `getTransaction` несут `locked_by`; остальные — нет. */
export function transactionLock(tx: object): TransactionLock | null {
  const value = (tx as LockableTransaction).locked_by;
  return value === "payroll" || value === "uniform" ? value : null;
}

/** Права пользователя на странице — считаются на сервере. */
export type TransactionPermissions = {
  create: boolean;
  updateOwn: boolean;
  updateAny: boolean;
  delete: boolean;
  export: boolean;
  manageBankAccounts: boolean;
  manageCategories: boolean;
  manageCounterparties: boolean;
  viewAttachments: boolean;
  uploadAttachments: boolean;
  deleteAttachments: boolean;
  /** Видит операции всех заведений, а не только активного. */
  viewAllVenues: boolean;
  /**
   * Видит операции всех юрлиц. Без него список и так ограничен юрлицом
   * активного заведения, поэтому фильтр «Юрлицо» не показывается.
   */
  viewAllLegalEntities: boolean;
};

/**
 * Может ли пользователь править операцию: свою — с update_transaction,
 * любую — с update_any. Удалённую и связанную с зарплатой — никто.
 */
export function canEditTransaction(
  tx: Pick<TransactionRow, "created_by" | "deleted_at"> & LockableTransaction,
  permissions: TransactionPermissions,
  currentUserId: string | null,
): boolean {
  if (tx.deleted_at || transactionLock(tx)) return false;
  if (permissions.updateAny) return true;
  return (
    permissions.updateOwn &&
    !!currentUserId &&
    tx.created_by === currentUserId
  );
}
