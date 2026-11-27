"use client";

import { AlertTriangle, Loader2 } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import {
  actCreationLabel,
  actCreationProgressText,
  isActCreationStuck,
  type ActCreationJobStatus,
} from "@/lib/inventory/act-creation-job";

/**
 * Статус акта, в который позиции ещё досылаются в фоне. Колонка статуса
 * узкая — в ней только «Создаётся» (или «Не все позиции»), ход
 * («Добавлено 55 из 313 · осталось около 1 мин 30 с») — в подсказке при
 * наведении. На телефоне подсказок нет: ход виден в карточке акта.
 */
export function ActCreationStatus({ creation }: { creation: ActCreationJobStatus }) {
  const progress = actCreationProgressText(creation);
  if (isActCreationStuck(creation)) {
    return (
      <StatusBadge
        tone="danger"
        icon={<AlertTriangle />}
        tip={progress}
        tipSub={`${creation.error ?? "Quick Resto перестал принимать позиции."} «Повторить» — в меню «⋯» акта: добавятся только недостающие`}
      >
        {actCreationLabel(creation)}
      </StatusBadge>
    );
  }
  return (
    <StatusBadge
      tone="info"
      icon={<Loader2 className="animate-spin" />}
      tip={progress}
      tipSub="Позиции добавляются в Quick Resto в фоне. Пока акт создаётся, его нельзя назначать, заполнять и удалять"
    >
      {actCreationLabel(creation)}
    </StatusBadge>
  );
}
