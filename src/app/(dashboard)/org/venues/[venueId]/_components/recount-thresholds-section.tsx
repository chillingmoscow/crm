"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/finance/amount-input";
import { ProfileSection } from "@/components/shared/profile-section";
import { useSaveSection } from "@/components/shared/save-bar";
import { updateVenueRecountThresholds } from "../../actions";

const DEFAULT_SUM = 500;
const DEFAULT_PERCENT = 10;

function parsePercent(text: string): number | null {
  const normalized = text.replace(",", ".").trim();
  if (!normalized) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * Пороги авто-маркера пересчёта (миграция 209): строка «Итогов» акта
 * помечается к пересчёту, если расхождение больше любого из порогов.
 * Сохраняется общей полосой карточки.
 */
export function RecountThresholdsSection({
  venueId,
  initialSum,
  initialPercent,
  canEdit,
  currency,
}: {
  venueId: string;
  initialSum: number | null;
  initialPercent: number | null;
  canEdit: boolean;
  currency: string;
}) {
  const router = useRouter();
  const savedSum = initialSum ?? DEFAULT_SUM;
  const savedPercent = initialPercent ?? DEFAULT_PERCENT;
  const [saved, setSaved] = useState({ sum: savedSum, percent: savedPercent });
  const [sum, setSum] = useState<number | null>(savedSum);
  const [percentText, setPercentText] = useState(String(savedPercent).replace(".", ","));
  const [saving, setSaving] = useState(false);
  const [refreshing, startRefresh] = useTransition();

  const percent = parsePercent(percentText);
  const dirty = canEdit && (sum !== saved.sum || percent !== saved.percent);
  const sumError = sum === null ? "Укажите порог по сумме" : null;
  const percentError =
    percent === null
      ? "Укажите порог по проценту"
      : percent < 0 || percent > 100
        ? "Порог по проценту должен быть от 0 до 100"
        : null;

  const saveBar = useSaveSection({
    dirty,
    saving: saving || refreshing,
    blocked: dirty ? sumError ?? percentError : null,
    reset: () => {
      setSum(saved.sum);
      setPercentText(String(saved.percent).replace(".", ","));
    },
    save: async () => {
      if (sum === null || percent === null || sumError || percentError) return false;
      setSaving(true);
      try {
        const { error } = await updateVenueRecountThresholds(venueId, { sum, percent });
        if (error) {
          toast.error(`Не удалось сохранить пороги пересчёта: ${error}`);
          return false;
        }
        setSaved({ sum, percent });
        toast.success("Пороги пересчёта сохранены");
        startRefresh(() => router.refresh());
        return true;
      } finally {
        setSaving(false);
      }
    },
  });

  return (
    <ProfileSection
      title="Пересчёт после инвентаризации"
      description="Строка акта помечается к пересчёту, если расхождение больше любого из порогов"
      locked={
        canEdit
          ? undefined
          : { tone: "locked", message: "Менять пороги могут те, кто управляет заведениями" }
      }
    >
      {saveBar}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="recount-sum" label="Порог по сумме" required error={dirty ? sumError : null}>
          {(control) => (
            <AmountInput
              id={control.id}
              aria-label="Порог по сумме"
              value={sum}
              onChange={setSum}
              currency={currency}
              disabled={!canEdit}
            />
          )}
        </Field>
        <Field
          id="recount-percent"
          label="Порог по проценту, %"
          required
          error={dirty ? percentError : null}
        >
          {(control) => (
            <Input
              {...control}
              inputMode="decimal"
              value={percentText}
              onChange={(e) => setPercentText(e.target.value.replace(/[^\d.,]/g, ""))}
              disabled={!canEdit}
            />
          )}
        </Field>
      </div>
    </ProfileSection>
  );
}
