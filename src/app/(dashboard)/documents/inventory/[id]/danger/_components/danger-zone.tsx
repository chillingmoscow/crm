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
}: {
  documentId: string;
  documentNumber: string;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="mx-auto w-full min-w-0 max-w-[720px]">
      <ProfileDangerAction
        icon={Trash2}
        title="Удалить акт"
        description="Удалятся акт и все его позиции. Акт из Quick Resto вернётся при следующей синхронизации, если не удалить его и там."
        actionLabel="Удалить акт"
        onAction={() => setConfirmOpen(true)}
      />
      <DeleteActDialog
        doc={{ id: documentId, document_number: documentNumber }}
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
