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
};

/** Может ли пользователь править операцию: свою — с update_transaction, любую — с update_any. */
export function canEditTransaction(
  tx: Pick<TransactionRow, "created_by" | "deleted_at">,
  permissions: TransactionPermissions,
  currentUserId: string | null,
): boolean {
  if (tx.deleted_at) return false;
  if (permissions.updateAny) return true;
  return (
    permissions.updateOwn &&
    !!currentUserId &&
    tx.created_by === currentUserId
  );
}
