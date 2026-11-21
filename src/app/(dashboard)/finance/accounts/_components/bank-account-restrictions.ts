import type { DeleteRestriction } from "@/components/shared/hard-delete-confirm-dialog";
import type { BankAccountArchiveImpact } from "@/lib/finance/bank-accounts";

/** Что мешает удалить счёт навсегда — общая логика карточки и архива. */
export function bankAccountDeleteRestrictions(impact: BankAccountArchiveImpact | null): DeleteRestriction[] {
  if (!impact || impact.transactions === 0) return [];
  return [
    {
      label: "Операции",
      count: impact.transactions,
      hint: "История операций не даёт удалить счёт. Оставьте его в архиве",
    },
  ];
}
