"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Field } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { updateInventoryDocumentDate } from "@/app/(dashboard)/inventory/_actions/document-date";

type Props = {
  documentId: string;
  documentNumber: string;
  /** Текущий день акта в поясе заведения, `YYYY-MM-DD`. */
  currentDay: string | null;
  /** У акта уже есть введённые количества. */
  hasEnteredAmounts: boolean;
  /** Подсчёт сдан: у акта есть итоги. */
  hasResults: boolean;
  /** Почему дату сейчас менять нельзя: диалог открывается и объясняет. */
  restriction?: string | null;
};

/**
 * «Изменить дату» в шапке секции «Сведения»: выбор дня и подтверждение.
 * Дата уходит в Quick Resto, а он считает расчётный остаток на дату акта —
 * поэтому подтверждение говорит, что расчётные остатки пересчитаются.
 */
export function ActDateEditor({
  documentId,
  documentNumber,
  currentDay,
  hasEnteredAmounts,
  hasResults,
  restriction,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(currentDay ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const openDialog = () => {
    setDay(currentDay ?? "");
    setError(null);
    setOpen(true);
  };

  const save = () => {
    setError(null);
    startSaving(async () => {
      const result = await updateInventoryDocumentDate({ documentId, date: day });
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      if (result.notice) toast.warning(result.notice);
      else toast.success("Дата акта изменена");
      router.refresh();
    });
  };

  const consequence = hasResults
    ? "У акта уже есть итоги: расчётные остатки, разница и суммы недостач и излишков пересчитаются на новую дату. Введённые количества не изменятся."
    : hasEnteredAmounts
      ? "Расчётные остатки всех позиций пересчитаются на новую дату. Введённые количества не изменятся."
      : null;

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={openDialog}>
        <CalendarDays className="size-4" />
        Изменить дату
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Изменить дату акта № ${documentNumber}?`}
        description="Новая дата сохранится в Quick Resto. Quick Resto считает расчётный остаток на дату акта."
        confirmLabel="Изменить дату"
        icon={CalendarDays}
        pendingLabel="Сохраняем…"
        busy={saving}
        confirmDisabled={!day || day === currentDay}
        restriction={restriction ?? undefined}
        error={error}
        onConfirm={save}
      >
        <div className="flex flex-col gap-4">
          <Field label="Дата акта">
            {(control) => (
              <DatePicker
                {...control}
                value={day}
                onChange={(value) => {
                  setDay(value);
                  setError(null);
                }}
                clearable={false}
                disabled={saving || Boolean(restriction)}
                placeholder="Выберите дату"
              />
            )}
          </Field>
          {consequence && !restriction ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              {consequence}
            </p>
          ) : null}
        </div>
      </ConfirmDialog>
    </>
  );
}
