"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ArchiveConfirmDialog } from "@/components/shared/archive-confirm-dialog";
import {
  HardDeleteConfirmDialog,
  type DeleteImpact,
  type DeleteRestriction,
} from "@/components/shared/hard-delete-confirm-dialog";
import {
  archiveBankAccount,
  restoreBankAccount,
  deleteBankAccount,
  type BankAccountArchiveImpact,
} from "@/lib/finance/bank-accounts";

type Props = {
  bankAccountId: string;
  bankAccountName: string;
  impact: BankAccountArchiveImpact;
  canHardDelete: boolean;
};

const UNDO_WINDOW_MS = 15_000;

export function BankAccountDangerZone({
  bankAccountId,
  bankAccountName,
  impact,
  canHardDelete,
}: Props) {
  const router = useRouter();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const archiveImpact = [{ label: "Транзакций", count: impact.transactions }];

  // RESTRICT-блокер: транзакции. Если есть — hard-delete упадёт.
  const restrictedBy: DeleteRestriction[] = [];
  if (impact.transactions > 0) {
    restrictedBy.push({
      label: "Транзакций",
      count: impact.transactions,
      hint: "Финансовая история блокирует удаление навсегда — используйте «Архивировать».",
    });
  }

  const deleteImpact: DeleteImpact[] = [];

  const handleArchive = async () => {
    const result = await archiveBankAccount(bankAccountId, {
      confirmName: bankAccountName,
    });
    if (result.error) {
      toast.error(result.error);
      return;
    }
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
          toast.success("Восстановлено");
          router.push(`/finance/accounts/${bankAccountId}`);
          router.refresh();
        },
      },
    });

    router.push("/finance/accounts");
    router.refresh();
  };

  const handleDelete = async () => {
    const result = await deleteBankAccount(bankAccountId, {
      confirmName: bankAccountName,
    });
    if (result.error) {
      toast.error(result.error);
      return;
    }
    setDeleteOpen(false);
    toast.success(`Счёт «${bankAccountName}» удалён`);
    router.push("/finance/accounts");
    router.refresh();
  };

  return (
    <div className="mt-10 space-y-6 border-t pt-8">
      <h2 className="text-base font-medium">Опасная зона</h2>

      <div className="rounded-md border bg-muted/20 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <Archive className="h-4 w-4 text-muted-foreground" />
              Архивировать счёт
            </h3>
            <p className="text-sm text-muted-foreground">
              Скроет счёт из всех выборов в новых транзакциях. История по
              существующим транзакциям сохранится. Восстановите, чтобы вернуть
              в работу.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setArchiveOpen(true)}
            className="shrink-0"
          >
            <Archive className="mr-1.5 h-4 w-4" />
            Архивировать
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="flex items-center gap-2 text-sm font-medium text-destructive">
              <AlertTriangle className="h-4 w-4" />
              Удалить навсегда
            </h3>
            <p className="text-sm text-muted-foreground">
              Полное удаление возможно только если по счёту нет транзакций.
              В большинстве случаев используйте «Архивировать».
            </p>
            {!canHardDelete ? (
              <p className="text-xs text-muted-foreground">
                Доступно только владельцу аккаунта.
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={!canHardDelete}
            onClick={() => setDeleteOpen(true)}
            className="shrink-0"
          >
            <AlertTriangle className="mr-1.5 h-4 w-4" />
            Удалить навсегда
          </Button>
        </div>
      </div>

      <ArchiveConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        entityGenitive="счёт"
        entityName={bankAccountName}
        impact={archiveImpact}
        description="Скрыть счёт из всех выборов. Существующие транзакции сохраняют ссылку — история не теряется."
        onConfirm={handleArchive}
      />

      <HardDeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        entityGenitive="счёт"
        entityName={bankAccountName}
        impact={deleteImpact}
        restrictedBy={restrictedBy}
        onConfirm={handleDelete}
      />
    </div>
  );
}
