"use client";

import { AlertTriangle, Loader2 } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import {
  actCreationLabel,
  isActCreationStuck,
  type ActCreationJobStatus,
} from "@/lib/inventory/act-creation-job";

/**
 * Статус акта, в который позиции ещё досылаются в фоне. Колонка статуса
 * узкая, поэтому в бейдже — значок и «55 из 313», полная подпись
 * («Создаётся · 55 из 313») — в подсказке и для экранного диктора. Если
 * попытки кончились — красный бейдж с причиной в подсказке; «Повторить» — в
 * меню «⋯» строки.
 */
export function ActCreationStatus({ creation }: { creation: ActCreationJobStatus }) {
  const label = actCreationLabel(creation);
  const count = `${creation.done} из ${creation.total}`;
  if (isActCreationStuck(creation)) {
    return (
      <StatusBadge
        tone="danger"
        icon={<AlertTriangle />}
        tip={`${label}. ${creation.error ?? "Quick Resto перестал принимать позиции."} «Повторить» — в меню «⋯» акта: добавятся только недостающие позиции`}
      >
        <span aria-label={label}>{count}</span>
      </StatusBadge>
    );
  }
  return (
    <StatusBadge
      tone="info"
      icon={<Loader2 className="animate-spin" />}
      tip={`${label}. Позиции добавляются в Quick Resto в фоне; пока акт создаётся, его нельзя назначать, заполнять и удалять`}
    >
      <span aria-label={label}>{count}</span>
    </StatusBadge>
  );
}
