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
  archiveLegalEntity,
  restoreLegalEntity,
  deleteLegalEntity,
  type LegalEntityArchiveImpact,
} from "@/lib/org/legal-entities";

type Props = {
  legalEntityId: string;
  legalEntityName: string;
  impact: LegalEntityArchiveImpact;
  /** true только для владельца аккаунта (org.delete_legal_entity). */
  canHardDelete: boolean;
};

const UNDO_WINDOW_MS = 15_000;

export function LegalEntityDangerZone({
  legalEntityId,
  legalEntityName,
  impact,
  canHardDelete,
}: Props) {
  const router = useRouter();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const archiveImpact = [
    { label: "Банк-счетов", count: impact.bankAccounts },
    { label: "Транзакций", count: impact.transactions },
    { label: "Документов", count: impact.attachments },
    { label: "Заведений (по умолчанию)", count: impact.venuesAsDefault },
  ];

  // RESTRICT-блокеры для hard-delete: пока хоть один не-ноль —
  // hard-delete упадёт. Это конструктивная особенность модели (нельзя
  // удалить юрлицо пока есть финансовая привязка). UI показывает
  // блокеры и предлагает «Архивировать».
  const restrictedBy: DeleteRestriction[] = [];
  if (impact.bankAccounts > 0) {
    restrictedBy.push({
      label: "Банк-счетов",
      count: impact.bankAccounts,
      hint: "Удалите или перепривяжите счета к другому юрлицу.",
    });
  }
  if (impact.transactions > 0) {
    restrictedBy.push({
      label: "Транзакций",
      count: impact.transactions,
      hint: "Финансовая история блокирует удаление навсегда — используйте «Архивировать».",
    });
  }
  if (impact.venuesAsDefault > 0) {
    restrictedBy.push({
      label: "Заведений",
      count: impact.venuesAsDefault,
      hint: "Смените юрлицо по умолчанию в карточке каждого заведения.",
    });
  }

  const deleteImpact: DeleteImpact[] = [
    { label: "Документов", count: impact.attachments, tone: "cascade" },
  ];

  const handleArchive = async () => {
    const result = await archiveLegalEntity(legalEntityId, {
      confirmName: legalEntityName,
    });
    if (result.error) {
      toast.error(result.error);
      return;
    }
    setArchiveOpen(false);

    toast(`Юрлицо «${legalEntityName}» в архиве`, {
      duration: UNDO_WINDOW_MS,
      action: {
        label: "Отменить",
        onClick: async () => {
          const r = await restoreLegalEntity(legalEntityId);
          if (r.error) {
            toast.error(r.error);
            return;
          }
          toast.success("Восстановлено");
          router.push(`/org/legal-entities/${legalEntityId}`);
          router.refresh();
        },
      },
    });

    router.push("/org/legal-entities");
    router.refresh();
  };

  const handleDelete = async () => {
    const result = await deleteLegalEntity(legalEntityId, {
      confirmName: legalEntityName,
    });
    if (result.error) {
      toast.error(result.error);
      return;
    }
    setDeleteOpen(false);
    toast.success(`Юрлицо «${legalEntityName}» удалено`);
    router.push("/org/legal-entities");
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
              Архивировать юрлицо
            </h3>
            <p className="text-sm text-muted-foreground">
              Скроет юрлицо из всех выборов в новых счетах, транзакциях и
              заведениях. История по существующим записям сохранится.
              Восстановить можно из раздела «Архив».
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
              Полное удаление возможно только если у юрлица не осталось
              финансовых привязок (банк-счетов, транзакций, заведений).
              В большинстве случаев используйте «Архивировать» — данные
              сохранятся, а юрлицо перестанет появляться в выборах.
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
        entityGenitive="юрлицо"
        entityName={legalEntityName}
        impact={archiveImpact}
        description="Скрыть юрлицо из всех выборов и списков. Существующие банк-счета, транзакции и заведения сохраняют ссылку — история не теряется. Восстановить можно в любой момент."
        onConfirm={handleArchive}
      />

      <HardDeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        entityGenitive="юрлицо"
        entityName={legalEntityName}
        impact={deleteImpact}
        restrictedBy={restrictedBy}
        onConfirm={handleDelete}
      />
    </div>
  );
}
