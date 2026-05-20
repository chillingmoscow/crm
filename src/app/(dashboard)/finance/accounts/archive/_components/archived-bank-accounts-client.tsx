"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RotateCcw, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  HardDeleteConfirmDialog,
  type DeleteImpact,
  type DeleteRestriction,
} from "@/components/shared/hard-delete-confirm-dialog";
import {
  restoreBankAccount,
  deleteBankAccount,
  getBankAccountArchiveImpact,
  type BankAccountArchiveImpact,
} from "@/lib/finance/bank-accounts";

export type ArchivedBankAccountRow = {
  id: string;
  name: string;
  type: string;
  bank_name: string | null;
  deleted_at: string;
  deleted_by_name: string;
};

const TYPE_LABELS: Record<string, string> = {
  cash: "Касса", checking: "Расчётный счёт", debit_card: "Карта",
  fund: "Фонд", safe: "Сейф",
};

function formatDate(iso: string) {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "medium", timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function ArchivedBankAccountsClient({ rows }: { rows: ArchivedBankAccountRow[] }) {
  const router = useRouter();
  const [restorePending, startRestoreTransition] = useTransition();
  const [restoreTarget, setRestoreTarget] = useState<ArchivedBankAccountRow | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<ArchivedBankAccountRow | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<BankAccountArchiveImpact | null>(null);

  const handleOpenDelete = async (row: ArchivedBankAccountRow) => {
    setDeleteTarget(row);
    setDeleteImpact(null);
    const impact = await getBankAccountArchiveImpact(row.id);
    setDeleteImpact(impact);
  };

  const handleRestore = (row: ArchivedBankAccountRow) => {
    startRestoreTransition(async () => {
      const result = await restoreBankAccount(row.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Счёт «${row.name}» восстановлен`);
      setRestoreTarget(null);
      router.refresh();
    });
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const result = await deleteBankAccount(deleteTarget.id, {
      confirmName: deleteTarget.name,
    });
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(`Счёт «${deleteTarget.name}» удалён`);
    setDeleteTarget(null);
    setDeleteImpact(null);
    router.refresh();
  };

  if (rows.length === 0) {
    return (
      <div className="rounded-md border bg-muted/20 px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">Архив пуст</p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Название</th>
              <th className="px-3 py-2 text-left font-medium">Тип</th>
              <th className="px-3 py-2 text-left font-medium">Банк</th>
              <th className="px-3 py-2 text-left font-medium">Архивировано</th>
              <th className="px-3 py-2 text-left font-medium">Кем</th>
              <th className="px-3 py-2 text-right font-medium">Действия</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="px-3 py-2.5 font-medium">{row.name}</td>
                <td className="px-3 py-2.5 text-muted-foreground">
                  {TYPE_LABELS[row.type] ?? row.type}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">{row.bank_name ?? "—"}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{formatDate(row.deleted_at)}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{row.deleted_by_name}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setRestoreTarget(row)}
                      disabled={restorePending}
                    >
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                      Восстановить
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => handleOpenDelete(row)}
                    >
                      <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
                      Удалить навсегда
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AlertDialog open={!!restoreTarget} onOpenChange={(open) => !open && setRestoreTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Восстановить счёт?</AlertDialogTitle>
            <AlertDialogDescription>
              «{restoreTarget?.name}» снова появится во всех выборах.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restorePending}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (restoreTarget) handleRestore(restoreTarget);
              }}
              disabled={restorePending}
            >
              Восстановить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {deleteTarget ? (
        <HardDeleteConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(open) => {
            if (!open) {
              setDeleteTarget(null);
              setDeleteImpact(null);
            }
          }}
          entityGenitive="счёт"
          entityName={deleteTarget.name}
          impact={[] as DeleteImpact[]}
          restrictedBy={buildRestrictedBy(deleteImpact)}
          onConfirm={handleDelete}
        />
      ) : null}
    </>
  );
}

function buildRestrictedBy(impact: BankAccountArchiveImpact | null): DeleteRestriction[] {
  if (!impact || impact.transactions === 0) return [];
  return [{
    label: "Транзакций",
    count: impact.transactions,
    hint: "Финансовая история блокирует — используйте «Восстановить».",
  }];
}
