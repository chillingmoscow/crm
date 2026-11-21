"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, Trash2 } from "lucide-react";

import { ArchiveConfirmDialog } from "@/components/shared/archive-confirm-dialog";
import { HardDeleteConfirmDialog } from "@/components/shared/hard-delete-confirm-dialog";
import { ProfileDangerAction } from "@/components/shared/profile-danger-zone";
import {
  archiveBankAccount,
  deleteBankAccount,
  restoreBankAccount,
  type BankAccountArchiveImpact,
} from "@/lib/finance/bank-accounts";
import { bankAccountDeleteRestrictions } from "../../_components/bank-account-restrictions";

const UNDO_WINDOW_MS = 15_000;

/**
 * «Опасная зона» счёта: архив (обратимо) и удаление навсегда. Показывается
 * только владельцу аккаунта — сервер проверяет его же.
 */
export function BankAccountDangerZone({
  bankAccountId,
  bankAccountName,
  impact,
  canHardDelete,
}: {
  bankAccountId: string;
  bankAccountName: string;
  impact: BankAccountArchiveImpact;
  canHardDelete: boolean;
}) {
  const router = useRouter();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleArchive = async () => {
    const result = await archiveBankAccount(bankAccountId, { confirmName: bankAccountName });
    if (result.error) return { error: result.error };
    setArchiveOpen(false);
    toast(`Счёт «${bankAccountName}» в архиве`, {
      duration: UNDO_WINDOW_MS,
      action: {
        label: "Отменить",
        onClick: async () => {
          const r = await restoreBankAccount(bankAccountId);
          if (r.error) {
            toast.error(r.error);
            return;
          }
          toast.success(`Счёт «${bankAccountName}» снова в работе`);
          router.push(`/finance/accounts/${bankAccountId}`);
          router.refresh();
        },
      },
    });
    router.push("/finance/accounts");
    router.refresh();
  };

  const handleDelete = async () => {
    const result = await deleteBankAccount(bankAccountId, { confirmName: bankAccountName });
    if (result.error) return { error: result.error };
    setDeleteOpen(false);
    toast.success(`Счёт «${bankAccountName}» удалён`);
    router.push("/finance/accounts");
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <ProfileDangerAction
        icon={Archive}
        title="Архивировать счёт"
        description="Счёт пропадёт из выбора в новых операциях. Прежние операции и баланс сохранятся. Вернуть можно из архива счетов"
        actionLabel="Архивировать"
        onAction={() => setArchiveOpen(true)}
      />
      {canHardDelete ? (
        <ProfileDangerAction
          icon={Trash2}
          title="Удалить навсегда"
          description="Только для счёта без операций, например созданного по ошибке. В остальных случаях отправьте его в архив"
          actionLabel="Удалить"
          onAction={() => setDeleteOpen(true)}
        />
      ) : null}

      <ArchiveConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        entityGenitive="счёт"
        entityName={bankAccountName}
        impact={[{ label: "Операции", count: impact.transactions }]}
        description="Это не удаление: счёт пропадёт из выбора в новых операциях, а прежние операции и баланс сохранятся. Вернуть счёт можно из архива в любой момент"
        onConfirm={handleArchive}
      />
      <HardDeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        entityGenitive="счёт"
        entityName={bankAccountName}
        impact={[]}
        restrictedBy={bankAccountDeleteRestrictions(impact)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
