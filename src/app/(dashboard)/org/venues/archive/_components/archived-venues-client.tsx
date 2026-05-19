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
import { restoreVenue, deleteVenue, getVenueArchiveImpact, type VenueArchiveImpact } from "../../actions";
import { VENUE_TYPES } from "@/lib/constants";

export type ArchivedVenueRow = {
  id: string;
  name: string;
  type: string;
  address: string | null;
  archived_at: string;
  archived_by_name: string;
};

const VENUE_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  VENUE_TYPES.map((t) => [t.value, t.label]),
);

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

export function ArchivedVenuesClient({ rows }: { rows: ArchivedVenueRow[] }) {
  const router = useRouter();
  const [restorePending, startRestoreTransition] = useTransition();
  const [restoreTarget, setRestoreTarget] = useState<ArchivedVenueRow | null>(null);

  // hard-delete: подгружаем impact лениво (только когда открыли диалог)
  const [deleteTarget, setDeleteTarget] = useState<ArchivedVenueRow | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<VenueArchiveImpact | null>(null);

  const handleOpenDelete = async (row: ArchivedVenueRow) => {
    setDeleteTarget(row);
    setDeleteImpact(null);
    const impact = await getVenueArchiveImpact(row.id);
    setDeleteImpact(impact);
  };

  const handleRestore = (row: ArchivedVenueRow) => {
    startRestoreTransition(async () => {
      const result = await restoreVenue(row.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Заведение «${row.name}» восстановлено`);
      setRestoreTarget(null);
      router.refresh();
    });
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const result = await deleteVenue(deleteTarget.id, {
      confirmName: deleteTarget.name,
    });
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(`Заведение «${deleteTarget.name}» удалено`);
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
              <th className="px-3 py-2 text-left font-medium">Адрес</th>
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
                  {VENUE_TYPE_LABELS[row.type] ?? row.type}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">{row.address ?? "—"}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{formatDate(row.archived_at)}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{row.archived_by_name}</td>
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

      {/* Restore confirmation — простой alert (без name-input) */}
      <AlertDialog open={!!restoreTarget} onOpenChange={(open) => !open && setRestoreTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Восстановить заведение?</AlertDialogTitle>
            <AlertDialogDescription>
              «{restoreTarget?.name}» снова появится во всех списках. Связанные
              данные продолжат работать как раньше.
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

      {/* Hard-delete confirmation — reusable c name-input */}
      {deleteTarget ? (
        <HardDeleteConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(open) => {
            if (!open) {
              setDeleteTarget(null);
              setDeleteImpact(null);
            }
          }}
          entityGenitive="заведение"
          entityName={deleteTarget.name}
          impact={buildDeleteImpact(deleteImpact)}
          restrictedBy={[]}
          onConfirm={handleDelete}
        />
      ) : null}
    </>
  );
}

function buildDeleteImpact(impact: VenueArchiveImpact | null): DeleteImpact[] {
  if (!impact) return [];
  return [
    { label: "Отделов", count: impact.departments, tone: "cascade" },
    { label: "Ролей", count: impact.roles, tone: "cascade" },
    { label: "Членств", count: impact.staff, tone: "cascade" },
    { label: "Приглашений", count: impact.invitations, tone: "cascade" },
    { label: "Залов", count: impact.halls, tone: "cascade" },
    { label: "Документов", count: impact.documents, tone: "unbind" },
    { label: "Транзакций", count: impact.transactions, tone: "unbind" },
    { label: "Складов", count: impact.stores, tone: "unbind" },
    { label: "Банк-счетов", count: impact.bankAccounts, tone: "unbind" },
  ];
}
