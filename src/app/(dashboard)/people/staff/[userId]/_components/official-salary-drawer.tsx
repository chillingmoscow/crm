"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { AmountInput } from "@/components/finance/amount-input";
import { MonthPicker } from "@/components/shared/month-picker";
import { formatRub } from "@/components/shared/money";
import { PayrollDetailDialog } from "@/app/(dashboard)/people/payroll/_components/payroll-detail-dialog";
import formStyle from "@/app/(dashboard)/people/payroll/_components/payroll-payment-form.module.css";
import { actionErrorMessage, unwrapAction } from "@/lib/actions/result";
import { monthStart, salaryDocumentName, type OfficialSalaryVersion } from "@/lib/people/official-employment";
import { changeOfficialSalary, type OfficialEmploymentPeriod } from "../../official-actions";
import { OfficialFileField, useOfficialDocumentUpload, type OfficialDocumentTarget } from "./official-file-field";
import { OfficialTaxHint } from "./official-tax-hint";

/**
 * Панель «Изменить оклад»: новый оклад по договору с первого числа месяца и
 * файл допсоглашения. Прошлые месяцы не пересчитываются; тот же месяц —
 * исправление оклада, а не новая версия.
 */
export function OfficialSalaryDrawer({
  employment,
  salaries,
  today,
  documents,
  canAttachFiles,
  onClose,
}: {
  employment: OfficialEmploymentPeriod;
  salaries: OfficialSalaryVersion[];
  today: string;
  documents: OfficialDocumentTarget;
  canAttachFiles: boolean;
  onClose: () => void;
}) {
  const min = monthStart(employment.starts_on);
  const max = employment.ends_on ? monthStart(employment.ends_on) : undefined;
  const clamp = (month: string) => (month < min ? min : max && month > max ? max : month);
  const [validFrom, setValidFrom] = useState(clamp(monthStart(today)));
  const [gross, setGross] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [grossError, setGrossError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const upload = useOfficialDocumentUpload(documents);
  const documentName = salaryDocumentName(validFrom);
  const sameMonth = salaries.find((s) => s.valid_from === validFrom);

  const submit = async () => {
    if (!(gross && gross > 0)) {
      setGrossError("Укажите оклад по договору больше нуля");
      return;
    }
    setGrossError(null);
    setBusy(true);
    setError(null);
    try {
      const documentPath = file ? await upload(file, documentName) : undefined;
      unwrapAction(
        await changeOfficialSalary({
          employment_id: employment.id,
          valid_from: validFrom,
          gross,
          ...(documentPath ? { document_path: documentPath } : {}),
        }),
      );
      toast.success("Оклад изменён");
      onClose();
    } catch (e) {
      setError(actionErrorMessage(e, "Не удалось сохранить. Проверьте подключение и попробуйте ещё раз"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PayrollDetailDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title="Изменить оклад"
      description=""
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? "Сохраняем…" : "Сохранить"}
          </Button>
        </>
      }
    >
      <div className={formStyle.form}>
        <Field
          label="С какого месяца"
          required
          hint={
            sameMonth
              ? `С этого месяца уже действует оклад ${formatRub(sameMonth.gross, { fraction: "auto" })}: он будет заменён`
              : "Прошлые месяцы не пересчитываются"
          }
        >
          {(control) => (
            <MonthPicker
              {...control}
              variant="field"
              prefix=""
              value={validFrom}
              min={min}
              max={max}
              disabled={busy}
              onChange={(month) => setValidFrom(clamp(month))}
            />
          )}
        </Field>
        <Field
          label="Оклад по договору"
          required
          error={grossError ?? undefined}
          hint={gross && gross > 0 ? <OfficialTaxHint gross={gross} /> : undefined}
        >
          {(control) => <AmountInput {...control} value={gross} onChange={setGross} placeholder="80 000" disabled={busy} />}
        </Field>
        {canAttachFiles && (
          <OfficialFileField
            label="Допсоглашение"
            file={file}
            onChange={setFile}
            disabled={busy}
            hint={file ? `Сохранится в «Документах» как «${documentName}»` : undefined}
          />
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </PayrollDetailDialog>
  );
}
