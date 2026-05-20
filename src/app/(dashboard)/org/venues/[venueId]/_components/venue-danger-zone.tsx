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
import { archiveVenue, restoreVenue, deleteVenue, type VenueArchiveImpact } from "../../actions";

type Props = {
  venueId: string;
  venueName: string;
  /** Pre-loaded из RSC: счётчики связанных сущностей. */
  impact: VenueArchiveImpact;
  /** true только для владельца аккаунта (org.delete_venue). */
  canHardDelete: boolean;
};

const UNDO_WINDOW_MS = 15_000;

export function VenueDangerZone({
  venueId,
  venueName,
  impact,
  canHardDelete,
}: Props) {
  const router = useRouter();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Что сохранится в архиве (всё, что отображаем — это связанные данные,
  // которые остаются в БД и доступны при восстановлении).
  const archiveImpact = [
    { label: "Документов", count: impact.documents },
    { label: "Транзакций", count: impact.transactions },
    { label: "Привязок сотрудников", count: impact.staff },
    { label: "Отделов", count: impact.departments },
    { label: "Ролей", count: impact.roles },
    { label: "Приглашений", count: impact.invitations },
    { label: "Залов", count: impact.halls },
    { label: "Складов", count: impact.stores },
  ];

  // Для hard-delete: что каскадом / что отвяжется. Источник — миграции
  // 197/198 + текущая FK-карта на venues.
  const deleteImpact: DeleteImpact[] = [
    { label: "Отделов",         count: impact.departments, tone: "cascade" },
    { label: "Ролей",           count: impact.roles,       tone: "cascade" },
    { label: "Привязок сотрудников", count: impact.staff,  tone: "cascade" },
    { label: "Приглашений",     count: impact.invitations, tone: "cascade" },
    { label: "Залов",           count: impact.halls,       tone: "cascade" },
    { label: "Документов",      count: impact.documents,   tone: "unbind" },
    { label: "Транзакций",      count: impact.transactions, tone: "unbind" },
    { label: "Складов",         count: impact.stores,      tone: "unbind" },
    { label: "Банк-счетов",     count: impact.bankAccounts, tone: "unbind" },
  ];

  // RESTRICT-блокеры в текущей схеме отсутствуют (миграции 196/197/198
  // привели цепочку к чистому CASCADE/SET NULL). Защита оставлена на
  // случай будущих FK с RESTRICT.
  const restrictedBy: DeleteRestriction[] = [];

  const handleArchive = async () => {
    const result = await archiveVenue(venueId, { confirmName: venueName });
    if (result.error) {
      toast.error(result.error);
      return;
    }
    setArchiveOpen(false);

    // Undo-toast: 15 секунд кнопка «Отменить» вызывает restoreVenue.
    toast(
      `Заведение «${venueName}» в архиве`,
      {
        duration: UNDO_WINDOW_MS,
        action: {
          label: "Отменить",
          onClick: async () => {
            const r = await restoreVenue(venueId);
            if (r.error) {
              toast.error(r.error);
              return;
            }
            toast.success("Восстановлено");
            // Возвращаем пользователя на карточку
            router.push(`/org/venues/${venueId}`);
            router.refresh();
          },
        },
      }
    );

    router.push("/org/venues");
    router.refresh();
  };

  const handleDelete = async () => {
    const result = await deleteVenue(venueId, { confirmName: venueName });
    if (result.error) {
      toast.error(result.error);
      return;
    }
    setDeleteOpen(false);
    toast.success(`Заведение «${venueName}» удалено`);
    router.push("/org/venues");
    router.refresh();
  };

  return (
    <div className="mt-10 space-y-6 border-t pt-8">
      <h2 className="text-base font-medium">Опасная зона</h2>

      {/* Archive ──────────────────────────────────────────────── */}
      <div className="rounded-md border bg-muted/20 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <Archive className="h-4 w-4 text-muted-foreground" />
              Архивировать заведение
            </h3>
            <p className="text-sm text-muted-foreground">
              Скроет заведение из всех списков и переключателей. Связанные
              данные (документы, транзакции, склады) сохранятся. Действие
              обратимо — можно восстановить из раздела «Архив».
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

      {/* Hard-delete ──────────────────────────────────────────── */}
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="flex items-center gap-2 text-sm font-medium text-destructive">
              <AlertTriangle className="h-4 w-4" />
              Удалить навсегда
            </h3>
            <p className="text-sm text-muted-foreground">
              Полное удаление. Отделы, роли, привязки сотрудников,
              приглашения и залы будут уничтожены безвозвратно. Документы,
              транзакции и склады отвяжутся (продолжат существовать как
              «без заведения»). Восстановить нельзя.
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
        entityGenitive="заведение"
        entityName={venueName}
        impact={archiveImpact}
        onConfirm={handleArchive}
      />

      <HardDeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        entityGenitive="заведение"
        entityName={venueName}
        impact={deleteImpact}
        restrictedBy={restrictedBy}
        onConfirm={handleDelete}
      />
    </div>
  );
}
