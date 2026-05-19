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
} from "@/components/shared/hard-delete-confirm-dialog";
import {
  restoreCounterparty,
  deleteCounterparty,
  getCounterpartyArchiveImpact,
  type CounterpartyArchiveImpact,
} from "@/lib/finance/counterparties";

export type ArchivedCounterpartyRow = {
  id: string;
  name: string;
  inn: string | null;
  deleted_at: string;
  deleted_by_name: string;
};

function formatDate(iso: string) {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function ArchivedCounterpartiesClient({ rows }: { rows: ArchivedCounterpartyRow[] }) {
  const router = useRouter();
  const [restorePending, startRestoreTransition] = useTransition();
  const [restoreTarget, setRestoreTarget] = useState<ArchivedCounterpartyRow | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<ArchivedCounterpartyRow | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<CounterpartyArchiveImpact | null>(null);

  const handleOpenDelete = async (row: ArchivedCounterpartyRow) => {
    setDeleteTarget(row);
    setDeleteImpact(null);
    const impact = await getCounterpartyArchiveImpact(row.id);
    setDeleteImpact(impact);
  };

  const handleRestore = (row: ArchivedCounterpartyRow) => {
    startRestoreTransition(async () => {
      const result = await restoreCounterparty(row.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Контрагент «${row.name}» восстановлен`);
      setRestoreTarget(null);
      router.refresh();
    });
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const result = await deleteCounterparty(deleteTarget.id, {
      confirmName: deleteTarget.name,
    });
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(`Контрагент «${deleteTarget.name}» удалён`);
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
              <th className="px-3 py-2 text-left font-medium">ИНН</th>
              <th className="px-3 py-2 text-left font-medium">Архивировано</th>
              <th className="px-3 py-2 text-left font-medium">Кем</th>
              <th className="px-3 py-2 text-right font-medium">Действия</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t">
                <td className="px-3 py-2.5 font-medium">{row.name}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{row.inn ?? "—"}</td>
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
            <AlertDialogTitle>Восстановить контрагента?</AlertDialogTitle>
            <AlertDialogDescription>
              «{restoreTarget?.name}» снова появится во всех выборах и списках.
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
          entityGenitive="контрагента"
          entityName={deleteTarget.name}
          impact={buildDeleteImpact(deleteImpact)}
          restrictedBy={[]}
          onConfirm={handleDelete}
        />
      ) : null}
    </>
  );
}

function buildDeleteImpact(impact: CounterpartyArchiveImpact | null): DeleteImpact[] {
  if (!impact) return [];
  return [
    { label: "Документов", count: impact.attachments, tone: "cascade" },
    { label: "Связок с ингредиентами", count: impact.ingredient_suppliers, tone: "cascade" },
    { label: "Транзакций", count: impact.transactions, tone: "unbind" },
  ];
}
