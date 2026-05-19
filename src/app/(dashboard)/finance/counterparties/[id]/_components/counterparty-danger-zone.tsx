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
} from "@/components/shared/hard-delete-confirm-dialog";
import {
  archiveCounterparty,
  restoreCounterparty,
  deleteCounterparty,
  type CounterpartyArchiveImpact,
} from "@/lib/finance/counterparties";

type Props = {
  counterpartyId: string;
  counterpartyName: string;
  impact: CounterpartyArchiveImpact;
  canHardDelete: boolean;
};

const UNDO_WINDOW_MS = 15_000;

export function CounterpartyDangerZone({
  counterpartyId,
  counterpartyName,
  impact,
  canHardDelete,
}: Props) {
  const router = useRouter();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const archiveImpact = [
    { label: "Транзакций", count: impact.transactions },
    { label: "Документов", count: impact.attachments },
    { label: "Связок «ингредиент → поставщик»", count: impact.ingredient_suppliers },
  ];

  // Hard-delete cascade map (см. docs/CONVENTIONS.md и counterparties FK):
  // counterparty_attachments → CASCADE, ingredient_suppliers → CASCADE,
  // transactions → SET NULL (история сохраняется как «без контрагента»).
  const deleteImpact: DeleteImpact[] = [
    { label: "Документов", count: impact.attachments, tone: "cascade" },
    { label: "Связок с ингредиентами", count: impact.ingredient_suppliers, tone: "cascade" },
    { label: "Транзакций", count: impact.transactions, tone: "unbind" },
  ];

  const handleArchive = async () => {
    const result = await archiveCounterparty(counterpartyId, {
      confirmName: counterpartyName,
    });
    if (result.error) {
      toast.error(result.error);
      return;
    }
    setArchiveOpen(false);

    toast(`Контрагент «${counterpartyName}» в архиве`, {
      duration: UNDO_WINDOW_MS,
      action: {
        label: "Отменить",
        onClick: async () => {
          const r = await restoreCounterparty(counterpartyId);
          if (r.error) {
            toast.error(r.error);
            return;
          }
          toast.success("Восстановлено");
          router.push(`/finance/counterparties/${counterpartyId}`);
          router.refresh();
        },
      },
    });

    router.push("/finance/counterparties");
    router.refresh();
  };

  const handleDelete = async () => {
    const result = await deleteCounterparty(counterpartyId, {
      confirmName: counterpartyName,
    });
    if (result.error) {
      toast.error(result.error);
      return;
    }
    setDeleteOpen(false);
    toast.success(`Контрагент «${counterpartyName}» удалён`);
    router.push("/finance/counterparties");
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
              Архивировать контрагента
            </h3>
            <p className="text-sm text-muted-foreground">
              Скроет контрагента из всех списков и выборов в новых
              транзакциях. История по существующим транзакциям сохранится.
              Действие обратимо — можно восстановить из раздела «Архив».
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
              Полное удаление. Документы и связки с ингредиентами будут
              уничтожены безвозвратно. Транзакции отвяжутся (продолжат
              существовать как «без контрагента»). Восстановить нельзя.
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
        entityGenitive="контрагента"
        entityName={counterpartyName}
        impact={archiveImpact}
        description="Скрыть из всех выборов и списков. История по существующим транзакциям сохранится — связь с контрагентом не теряется. Восстановить можно в любой момент."
        onConfirm={handleArchive}
      />

      <HardDeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        entityGenitive="контрагента"
        entityName={counterpartyName}
        impact={deleteImpact}
        restrictedBy={[]}
        onConfirm={handleDelete}
      />
    </div>
  );
}
