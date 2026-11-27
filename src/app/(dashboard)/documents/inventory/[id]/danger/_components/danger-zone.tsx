"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";

import { ProfileDangerAction } from "@/components/shared/profile-danger-zone";
import { DeleteActDialog } from "../../../_components/documents-table-rows";

/**
 * Содержимое вкладки «Опасная зона» карточки акта: удаление акта.
 * Вкладка показывается, только когда удаление доступно (см. layout), поэтому
 * здесь причину запрета не объясняем.
 */
export function DangerZone({
  documentId,
  documentNumber,
  processed,
}: {
  documentId: string;
  documentNumber: string;
  processed: boolean;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="mx-auto w-full min-w-0 max-w-[720px]">
      <ProfileDangerAction
        icon={Trash2}
        title="Удалить акт"
        description={
          processed
            ? "Акт проведён: сначала его проведение в Quick Resto отменится — остатки склада пересчитаются, — потом акт и все его позиции удалятся здесь и в Quick Resto."
            : "Акт и все его позиции удалятся здесь и в Quick Resto."
        }
        actionLabel="Удалить акт"
        onAction={() => setConfirmOpen(true)}
      />
      <DeleteActDialog
        doc={{ id: documentId, document_number: documentNumber, status: processed ? "processed" : "" }}
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onDeleted={() => {
          router.push("/documents/inventory");
          router.refresh();
        }}
      />
    </div>
  );
}
