"use client";

import { useState } from "react";
import { toast } from "sonner";
import { DatePicker } from "@/components/ui/date-picker";
import { Field } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { actionErrorMessage, unwrapAction } from "@/lib/actions/result";
import { endOfficialEmployment, type OfficialEmploymentPeriod } from "../../official-actions";

/**
 * «Уволить официально» — дата официального увольнения. Одно поле, поэтому
 * диалог по центру, а не боковая панель (DS, «Боковая панель»). Для уже
 * уволенного — исправление даты.
 */
export function OfficialEndDialog({
  employment,
  employeeName,
  today,
  onClose,
}: {
  employment: OfficialEmploymentPeriod;
  employeeName: string;
  today: string;
  onClose: () => void;
}) {
  const ended = Boolean(employment.ends_on);
  const [endsOn, setEndsOn] = useState(
    employment.ends_on ?? (today < employment.starts_on ? employment.starts_on : today),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      unwrapAction(await endOfficialEmployment({ employment_id: employment.id, ends_on: endsOn }));
      toast.success(ended ? "Дата официального увольнения сохранена" : "Сотрудник уволен официально");
      onClose();
    } catch (e) {
      setError(actionErrorMessage(e, "Не удалось сохранить. Проверьте подключение и попробуйте ещё раз"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Уволить «${employeeName}» официально?`}
      description="Оклад по договору начисляется по эту дату. Месяц увольнения не выплачивается автоматически: сумма за него уточняется, карточка появится в «На разбор»."
      confirmLabel={ended ? "Сохранить дату" : "Уволить официально"}
      pendingLabel="Сохраняем…"
      destructive={!ended}
      busy={busy}
      confirmDisabled={!endsOn}
      error={error}
      onConfirm={() => void confirm()}
    >
      <Field label="Дата официального увольнения" required>
        {(control) => (
          <DatePicker
            {...control}
            aria-required
            value={endsOn}
            onChange={setEndsOn}
            clearable={false}
            fromDate={new Date(`${employment.starts_on}T00:00:00`)}
            disabled={busy}
          />
        )}
      </Field>
    </ConfirmDialog>
  );
}
