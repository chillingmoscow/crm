"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { TimeInput, normalizeTimeInput } from "@/components/ui/time-input";
import { Field } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { updateInventoryDocumentDate } from "@/app/(dashboard)/inventory/_actions/document-date";

type Props = {
  documentId: string;
  documentNumber: string;
  /** Текущий день акта в поясе заведения, `YYYY-MM-DD`. */
  currentDay: string | null;
  /** Текущее время акта в поясе заведения, `HH:mm`. */
  currentTime: string | null;
  /** У акта уже есть введённые количества. */
  hasEnteredAmounts: boolean;
  /** Подсчёт сдан: у акта есть итоги. */
  hasResults: boolean;
  /** Почему дату сейчас менять нельзя: диалог открывается и объясняет. */
  restriction?: string | null;
};

/**
 * «Изменить дату» в шапке секции «Сведения»: выбор дня и времени акта и
 * подтверждение. Они уходят в Quick Resto, а он считает расчётный остаток на
 * момент акта — поэтому подтверждение говорит, что расчётные остатки
 * пересчитаются.
 */
export function ActDateEditor({
  documentId,
  documentNumber,
  currentDay,
  currentTime,
  hasEnteredAmounts,
  hasResults,
  restriction,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(currentDay ?? "");
  const [time, setTime] = useState(currentTime ?? "12:00");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const openDialog = () => {
    setDay(currentDay ?? "");
    setTime(currentTime ?? "12:00");
    setError(null);
    setOpen(true);
  };

  // Время вводится с клавиатуры («930», «9:30») и приводится к ЧЧ:ММ при
  // уходе из поля; кнопка работает и до этого — по нормализованному значению.
  const normalizedTime = normalizeTimeInput(time) || null;

  const save = () => {
    if (!normalizedTime) return;
    setError(null);
    startSaving(async () => {
      const result = await updateInventoryDocumentDate({ documentId, date: day, time: normalizedTime });
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      if (result.notice) toast.warning(result.notice);
      else toast.success("Дата и время акта изменены");
      router.refresh();
    });
  };

  const consequence = hasResults
    ? "У акта уже есть итоги: расчётные остатки, разница и суммы недостач и излишков пересчитаются на новые дату и время. Введённые количества не изменятся."
    : hasEnteredAmounts
      ? "Расчётные остатки всех позиций пересчитаются на новые дату и время. Введённые количества не изменятся."
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
        description="Новые дата и время сохранятся в Quick Resto. Quick Resto считает расчётный остаток на этот момент: что пришло и списано позже, в остаток не попадёт."
        confirmLabel="Сохранить"
        pendingLabel="Сохраняем…"
        busy={saving}
        confirmDisabled={!day || !normalizedTime || (day === currentDay && normalizedTime === currentTime)}
        restriction={restriction ?? undefined}
        error={error}
        onConfirm={save}
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-3">
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
            <Field label="Время">
              {(control) => (
                <TimeInput
                  {...control}
                  value={time}
                  onChange={(value) => {
                    setTime(value);
                    setError(null);
                  }}
                  disabled={saving || Boolean(restriction)}
                />
              )}
            </Field>
          </div>
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
