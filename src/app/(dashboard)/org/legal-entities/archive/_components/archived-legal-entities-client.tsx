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
  restoreLegalEntity,
  deleteLegalEntity,
  getLegalEntityArchiveImpact,
  type LegalEntityArchiveImpact,
} from "@/lib/org/legal-entities";

export type ArchivedLegalEntityRow = {
  id: string;
  name: string;
  legal_form: string;
  inn: string | null;
  archived_at: string;
  archived_by_name: string;
};

const LEGAL_FORM_LABELS: Record<string, string> = {
  IP: "ИП", OOO: "ООО", AO: "АО", PAO: "ПАО", NKO: "НКО", OTHER: "Иное",
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

export function ArchivedLegalEntitiesClient({ rows }: { rows: ArchivedLegalEntityRow[] }) {
  const router = useRouter();
  const [restorePending, startRestoreTransition] = useTransition();
  const [restoreTarget, setRestoreTarget] = useState<ArchivedLegalEntityRow | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<ArchivedLegalEntityRow | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<LegalEntityArchiveImpact | null>(null);

  const handleOpenDelete = async (row: ArchivedLegalEntityRow) => {
    setDeleteTarget(row);
    setDeleteImpact(null);
    const impact = await getLegalEntityArchiveImpact(row.id);
    setDeleteImpact(impact);
  };

  const handleRestore = (row: ArchivedLegalEntityRow) => {
    startRestoreTransition(async () => {
      const result = await restoreLegalEntity(row.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Юрлицо «${row.name}» восстановлено`);
      setRestoreTarget(null);
      router.refresh();
    });
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const result = await deleteLegalEntity(deleteTarget.id, {
      confirmName: deleteTarget.name,
    });
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(`Юрлицо «${deleteTarget.name}» удалено`);
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
              <th className="px-3 py-2 text-left font-medium">Форма</th>
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
                <td className="px-3 py-2.5 text-muted-foreground">
                  {LEGAL_FORM_LABELS[row.legal_form] ?? row.legal_form}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">{row.inn ?? "—"}</td>
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

      <AlertDialog open={!!restoreTarget} onOpenChange={(open) => !open && setRestoreTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Восстановить юрлицо?</AlertDialogTitle>
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
          entityGenitive="юрлицо"
          entityName={deleteTarget.name}
          impact={buildDeleteImpact(deleteImpact)}
          restrictedBy={buildRestrictedBy(deleteImpact)}
          onConfirm={handleDelete}
        />
      ) : null}
    </>
  );
}

function buildDeleteImpact(impact: LegalEntityArchiveImpact | null): DeleteImpact[] {
  if (!impact) return [];
  return [
    { label: "Документов", count: impact.attachments, tone: "cascade" },
  ];
}

function buildRestrictedBy(impact: LegalEntityArchiveImpact | null): DeleteRestriction[] {
  if (!impact) return [];
  const out: DeleteRestriction[] = [];
  if (impact.bankAccounts > 0) {
    out.push({
      label: "Банк-счетов",
      count: impact.bankAccounts,
      hint: "Удалите или перепривяжите счета к другому юрлицу.",
    });
  }
  if (impact.transactions > 0) {
    out.push({
      label: "Транзакций",
      count: impact.transactions,
      hint: "Финансовая история блокирует — используйте «Восстановить» и продолжайте архивировать.",
    });
  }
  if (impact.venuesAsDefault > 0) {
    out.push({
      label: "Заведений",
      count: impact.venuesAsDefault,
      hint: "Смените юрлицо по умолчанию в карточке каждого заведения.",
    });
  }
  return out;
}
