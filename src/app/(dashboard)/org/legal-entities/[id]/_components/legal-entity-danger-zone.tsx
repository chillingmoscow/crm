"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, Trash2 } from "lucide-react";

import { ArchiveConfirmDialog } from "@/components/shared/archive-confirm-dialog";
import {
  HardDeleteConfirmDialog,
  type DeleteImpact,
  type DeleteRestriction,
} from "@/components/shared/hard-delete-confirm-dialog";
import { ProfileDangerAction } from "@/components/shared/profile-danger-zone";
import {
  archiveLegalEntity,
  restoreLegalEntity,
  deleteLegalEntity,
  type LegalEntityArchiveImpact,
} from "@/lib/org/legal-entities";

const UNDO_WINDOW_MS = 15_000;

/** Что мешает удалить юрлицо навсегда — общая логика карточки и архива. */
export function legalEntityDeleteRestrictions(
  impact: LegalEntityArchiveImpact,
): DeleteRestriction[] {
  const out: DeleteRestriction[] = [];
  if (impact.bankAccounts > 0)
    out.push({
      label: "Банковские счета",
      count: impact.bankAccounts,
      hint: "Удалите счета или перенесите их на другое юрлицо",
    });
  if (impact.transactions > 0)
    out.push({
      label: "Операции",
      count: impact.transactions,
      hint: "История операций не даёт удалить юрлицо. Оставьте его в архиве",
    });
  if (impact.venuesAsDefault > 0)
    out.push({
      label: "Заведения",
      count: impact.venuesAsDefault,
      hint: "Отвяжите заведения на вкладке «Заведения»",
    });
  return out;
}

export function legalEntityDeleteImpact(impact: LegalEntityArchiveImpact): DeleteImpact[] {
  return [{ label: "Документы", count: impact.attachments, tone: "cascade" }];
}

/**
 * «Опасная зона» юрлица: архив (обратимо) и удаление навсегда. Показывается
 * только владельцу аккаунта — сервер проверяет его же.
 */
export function LegalEntityDangerZone({
  legalEntityId,
  legalEntityName,
  impact,
  canHardDelete,
}: {
  legalEntityId: string;
  legalEntityName: string;
  impact: LegalEntityArchiveImpact;
  canHardDelete: boolean;
}) {
  const router = useRouter();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleArchive = async () => {
    const result = await archiveLegalEntity(legalEntityId, { confirmName: legalEntityName });
    if (result.error) return { error: result.error };
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
          toast.success(`Юрлицо «${legalEntityName}» восстановлено`);
          router.push(`/org/legal-entities/${legalEntityId}`);
          router.refresh();
        },
      },
    });
    router.push("/org/legal-entities");
    router.refresh();
  };

  const handleDelete = async () => {
    const result = await deleteLegalEntity(legalEntityId, { confirmName: legalEntityName });
    if (result.error) return { error: result.error };
    setDeleteOpen(false);
    toast.success(`Юрлицо «${legalEntityName}» удалено`);
    router.push("/org/legal-entities");
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <ProfileDangerAction
        icon={Archive}
        title="Архивировать юрлицо"
        description="Юрлицо пропадёт из выборов в новых счетах, операциях и заведениях. Счета, операции и документы сохранятся. Вернуть можно из архива юрлиц"
        actionLabel="Архивировать"
        onAction={() => setArchiveOpen(true)}
      />
      {canHardDelete ? (
        <ProfileDangerAction
          icon={Trash2}
          title="Удалить навсегда"
          description="Только для юрлица без счетов, операций и заведений, например созданного по ошибке. В остальных случаях отправьте его в архив"
          actionLabel="Удалить"
          onAction={() => setDeleteOpen(true)}
        />
      ) : null}

      <ArchiveConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        entityGenitive="юрлицо"
        entityName={legalEntityName}
        impact={[
          { label: "Банковские счета", count: impact.bankAccounts },
          { label: "Операции", count: impact.transactions },
          { label: "Документы", count: impact.attachments },
          { label: "Заведения", count: impact.venuesAsDefault },
        ]}
        description="Это не удаление: юрлицо пропадёт из выборов, а счета, операции и заведения сохранят ссылку на него. Вернуть можно из архива юрлиц в любой момент"
        onConfirm={handleArchive}
      />
      <HardDeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        entityGenitive="юрлицо"
        entityName={legalEntityName}
        impact={legalEntityDeleteImpact(impact)}
        restrictedBy={legalEntityDeleteRestrictions(impact)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
