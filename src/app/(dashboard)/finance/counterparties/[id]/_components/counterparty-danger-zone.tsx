"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, Trash2 } from "lucide-react";

import { ArchiveConfirmDialog } from "@/components/shared/archive-confirm-dialog";
import { HardDeleteConfirmDialog } from "@/components/shared/hard-delete-confirm-dialog";
import { ProfileDangerAction } from "@/components/shared/profile-danger-zone";
import {
  archiveCounterparty,
  deleteCounterparty,
  restoreCounterparty,
  type CounterpartyArchiveImpact,
} from "@/lib/finance/counterparties";
import { counterpartyDeleteImpact } from "../../_components/counterparties-client";

const UNDO_WINDOW_MS = 15_000;

/**
 * «Опасная зона» контрагента: архив (обратимо) и удаление навсегда.
 * Показывается только владельцу аккаунта — сервер проверяет его же.
 */
export function CounterpartyDangerZone({
  counterpartyId,
  counterpartyName,
  impact,
  canHardDelete,
}: {
  counterpartyId: string;
  counterpartyName: string;
  impact: CounterpartyArchiveImpact;
  canHardDelete: boolean;
}) {
  const router = useRouter();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleArchive = async () => {
    const result = await archiveCounterparty(counterpartyId, { confirmName: counterpartyName });
    if (result.error) return { error: result.error };
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
          toast.success(`Контрагент «${counterpartyName}» возвращён из архива`);
          router.push(`/finance/counterparties/${counterpartyId}`);
          router.refresh();
        },
      },
    });
    router.push("/finance/counterparties");
    router.refresh();
  };

  const handleDelete = async () => {
    const result = await deleteCounterparty(counterpartyId, { confirmName: counterpartyName });
    if (result.error) return { error: result.error };
    setDeleteOpen(false);
    toast.success(`Контрагент «${counterpartyName}» удалён`);
    router.push("/finance/counterparties");
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <ProfileDangerAction
        icon={Archive}
        title="Отправить в архив"
        description="Контрагент пропадёт из списка и из выбора в новых операциях. Операции и документы сохранятся. Вернуть можно из архива контрагентов"
        actionLabel="В архив"
        onAction={() => setArchiveOpen(true)}
      />
      {canHardDelete ? (
        <ProfileDangerAction
          icon={Trash2}
          title="Удалить навсегда"
          description="Для контрагента, заведённого по ошибке. Документы, сертификаты и связи с номенклатурой удалятся, операции останутся без контрагента. В остальных случаях отправьте его в архив"
          actionLabel="Удалить"
          onAction={() => setDeleteOpen(true)}
        />
      ) : null}

      <ArchiveConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        entityGenitive="контрагента"
        entityName={counterpartyName}
        impact={[
          { label: "Операции", count: impact.transactions },
          { label: "Документы", count: impact.attachments },
          { label: "Сертификаты и лицензии", count: impact.certificates },
          { label: "Связи с номенклатурой", count: impact.ingredient_suppliers },
        ]}
        description="Это не удаление: контрагент пропадёт из выбора, а операции, документы и связи с номенклатурой сохранятся. Вернуть можно из архива контрагентов в любой момент"
        onConfirm={handleArchive}
      />
      <HardDeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        entityGenitive="контрагента"
        entityName={counterpartyName}
        impact={counterpartyDeleteImpact(impact)}
        restrictedBy={[]}
        onConfirm={handleDelete}
      />
    </div>
  );
}
