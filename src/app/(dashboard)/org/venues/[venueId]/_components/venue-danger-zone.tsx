"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, Trash2 } from "lucide-react";

import { ArchiveConfirmDialog } from "@/components/shared/archive-confirm-dialog";
import {
  HardDeleteConfirmDialog,
  type DeleteImpact,
} from "@/components/shared/hard-delete-confirm-dialog";
import { ProfileDangerAction } from "@/components/shared/profile-danger-zone";
import { archiveVenue, restoreVenue, deleteVenue, type VenueArchiveImpact } from "../../actions";

const UNDO_WINDOW_MS = 15_000;

/**
 * Что удалится вместе с заведением и что отвяжется. Источник — миграции
 * 196–198 и FK на venues: цепочка приведена к CASCADE / SET NULL, поэтому
 * блокеров удаления сейчас нет.
 */
export function venueDeleteImpact(impact: VenueArchiveImpact): DeleteImpact[] {
  return [
    { label: "Подразделения", count: impact.departments, tone: "cascade" },
    { label: "Должности", count: impact.roles, tone: "cascade" },
    { label: "Назначения сотрудников", count: impact.staff, tone: "cascade" },
    { label: "Приглашения", count: impact.invitations, tone: "cascade" },
    { label: "Залы", count: impact.halls, tone: "cascade" },
    { label: "Документы", count: impact.documents, tone: "unbind" },
    { label: "Операции", count: impact.transactions, tone: "unbind" },
    { label: "Склады", count: impact.stores, tone: "unbind" },
    { label: "Банковские счета", count: impact.bankAccounts, tone: "unbind" },
  ];
}

/** «Опасная зона» заведения — только владельцу аккаунта. */
export function VenueDangerZone({
  venueId,
  venueName,
  impact,
  canHardDelete,
}: {
  venueId: string;
  venueName: string;
  impact: VenueArchiveImpact;
  canHardDelete: boolean;
}) {
  const router = useRouter();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleArchive = async () => {
    const result = await archiveVenue(venueId, { confirmName: venueName });
    if (result.error) return { error: result.error };
    setArchiveOpen(false);
    toast(`Заведение «${venueName}» в архиве`, {
      duration: UNDO_WINDOW_MS,
      action: {
        label: "Отменить",
        onClick: async () => {
          const r = await restoreVenue(venueId);
          if (r.error) {
            toast.error(r.error);
            return;
          }
          toast.success(`Заведение «${venueName}» восстановлено`);
          router.push(`/org/venues/${venueId}`);
          router.refresh();
        },
      },
    });
    router.push("/org/venues");
    router.refresh();
  };

  const handleDelete = async () => {
    const result = await deleteVenue(venueId, { confirmName: venueName });
    if (result.error) return { error: result.error };
    setDeleteOpen(false);
    toast.success(`Заведение «${venueName}» удалено`);
    router.push("/org/venues");
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <ProfileDangerAction
        icon={Archive}
        title="Архивировать заведение"
        description="Заведение пропадёт из списков и переключателя заведений. Документы, операции и склады сохранятся. Вернуть можно из архива заведений"
        actionLabel="Архивировать"
        onAction={() => setArchiveOpen(true)}
      />
      {canHardDelete ? (
        <ProfileDangerAction
          icon={Trash2}
          title="Удалить навсегда"
          description="Подразделения, должности, назначения сотрудников, приглашения и залы удалятся. Документы, операции и склады останутся без заведения. Восстановить нельзя"
          actionLabel="Удалить"
          onAction={() => setDeleteOpen(true)}
        />
      ) : null}

      <ArchiveConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        entityGenitive="заведение"
        entityName={venueName}
        impact={[
          { label: "Документы", count: impact.documents },
          { label: "Операции", count: impact.transactions },
          { label: "Назначения сотрудников", count: impact.staff },
          { label: "Подразделения", count: impact.departments },
          { label: "Должности", count: impact.roles },
          { label: "Приглашения", count: impact.invitations },
          { label: "Залы", count: impact.halls },
          { label: "Склады", count: impact.stores },
        ]}
        description="Это не удаление: заведение пропадёт из списков и переключателя, сотрудники не смогут в него переключиться, а документы, операции и склады сохранятся. Вернуть можно из архива заведений в любой момент"
        onConfirm={handleArchive}
      />
      <HardDeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        entityGenitive="заведение"
        entityName={venueName}
        impact={venueDeleteImpact(impact)}
        restrictedBy={[]}
        onConfirm={handleDelete}
      />
    </div>
  );
}
