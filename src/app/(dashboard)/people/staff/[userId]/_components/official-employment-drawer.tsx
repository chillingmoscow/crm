"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DatePicker } from "@/components/ui/date-picker";
import { Field } from "@/components/ui/field";
import { AmountInput } from "@/components/finance/amount-input";
import { PayrollDetailDialog } from "@/app/(dashboard)/people/payroll/_components/payroll-detail-dialog";
import formStyle from "@/app/(dashboard)/people/payroll/_components/payroll-payment-form.module.css";
import { actionErrorMessage, unwrapAction } from "@/lib/actions/result";
import { contractDocumentName, officialAmountLabel } from "@/lib/people/official-employment";
import {
  employOfficially,
  updateOfficialEmployment,
  type OfficialEmploymentPeriod,
} from "../../official-actions";
import { OfficialFileField, useOfficialDocumentUpload, type OfficialDocumentTarget } from "./official-file-field";
import { OfficialTaxHint } from "./official-tax-hint";

type Errors = Partial<Record<"starts_on" | "position" | "gross", string>>;

/**
 * Панель «Оформить официально» (новый период) и «Исправить данные»
 * (опечатки в должности, номере и дате договора, дата оформления, файл
 * договора, «Платит агентство» — без новой версии оклада).
 * «Платит агентство»: сотрудник получает сумму в месяц через агентство —
 * без налога, поэтому вместо оклада и подсказки «на руки» — «Получает в месяц».
 */
export function OfficialEmploymentDrawer({
  open = true,
  mode,
  employeeId,
  employment,
  defaultStartsOn,
  documents,
  canAttachFiles,
  onClose,
}: {
  /** Открыта ли панель. Её держат смонтированной, пока она уезжает (docs/motion.md). */
  open?: boolean;
  mode: "employ" | "edit";
  employeeId: string;
  /** Для «Исправить данные» — текущий период. */
  employment?: OfficialEmploymentPeriod;
  defaultStartsOn: string;
  documents: OfficialDocumentTarget;
  canAttachFiles: boolean;
  onClose: () => void;
}) {
  const editing = mode === "edit" && employment ? employment : null;
  const [startsOn, setStartsOn] = useState(editing?.starts_on ?? defaultStartsOn);
  const [position, setPosition] = useState(editing?.position ?? "");
  const [gross, setGross] = useState<number | null>(null);
  const [number, setNumber] = useState(editing?.contract_number ?? "");
  const [contractDate, setContractDate] = useState(editing?.contract_date ?? "");
  const [agency, setAgency] = useState(editing?.agency ?? false);
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const upload = useOfficialDocumentUpload(documents);
  const documentName = contractDocumentName(number, contractDate || null);

  const changes = editing
    ? {
        ...(startsOn !== editing.starts_on ? { starts_on: startsOn } : {}),
        ...(position.trim() !== editing.position ? { position: position.trim() } : {}),
        ...(number.trim() !== (editing.contract_number ?? "") ? { contract_number: number.trim() || null } : {}),
        ...(contractDate !== (editing.contract_date ?? "") ? { contract_date: contractDate || null } : {}),
        ...(agency !== editing.agency ? { agency } : {}),
      }
    : {};
  const dirty = editing ? Object.keys(changes).length > 0 || file !== null : true;

  const submit = async () => {
    const next: Errors = {};
    if (!startsOn) next.starts_on = "Укажите дату оформления";
    if (!position.trim()) next.position = "Укажите должность по договору";
    if (!editing && !(gross && gross > 0))
      next.gross = agency ? "Укажите, сколько сотрудник получает в месяц" : "Укажите оклад по договору больше нуля";
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setError(null);
    try {
      const contractPath = file ? await upload(file, documentName) : undefined;
      if (editing) {
        unwrapAction(
          await updateOfficialEmployment({
            employment_id: editing.id,
            ...changes,
            ...(contractPath ? { contract_path: contractPath } : {}),
          }),
        );
        toast.success("Данные оформления сохранены");
      } else {
        unwrapAction(
          await employOfficially({
            employee_id: employeeId,
            starts_on: startsOn,
            position: position.trim(),
            gross: gross ?? 0,
            agency,
            contract_number: number.trim() || null,
            contract_date: contractDate || null,
            ...(contractPath ? { contract_path: contractPath } : {}),
          }),
        );
        toast.success("Сотрудник оформлен официально");
      }
      onClose();
    } catch (e) {
      setError(actionErrorMessage(e, "Не удалось сохранить. Проверьте подключение и попробуйте ещё раз"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PayrollDetailDialog
      open={open}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={editing ? "Исправить данные" : "Оформить официально"}
      description=""
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={busy || !dirty} onClick={() => void submit()}>
            {busy ? "Сохраняем…" : editing ? "Сохранить" : "Оформить"}
          </Button>
        </>
      }
    >
      <div className={formStyle.form}>
        <Field label="Дата оформления" required error={errors.starts_on}>
          {(control) => (
            <DatePicker {...control} aria-required value={startsOn} onChange={setStartsOn} clearable={false} disabled={busy} />
          )}
        </Field>
        <Field label="Должность по договору" required error={errors.position} hint="Как в договоре. Должность в карточке, ставки и права не меняются">
          {(control) => (
            <Input
              {...control}
              aria-required
              value={position}
              maxLength={200}
              placeholder="Менеджер по работе с клиентами"
              disabled={busy}
              onChange={(e) => setPosition(e.target.value)}
            />
          )}
        </Field>
        <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div className="min-w-0">
            <Label htmlFor="official-agency">Платит агентство</Label>
            <p id="official-agency-hint" className="mt-1 text-xs text-muted-foreground">
              Сотрудник оформлен через аутстафф-агентство и получает деньги от него. Сумма в месяц уменьшает
              долг, а в день официальных выплат закрывается записью «Получено через агентство» — без расхода и
              налога
            </p>
          </div>
          <Switch
            id="official-agency"
            aria-describedby="official-agency-hint"
            checked={agency}
            disabled={busy}
            onCheckedChange={setAgency}
          />
        </div>
        {!editing && (
          <Field
            label={officialAmountLabel(agency)}
            required
            error={errors.gross}
            hint={!agency && gross && gross > 0 ? <OfficialTaxHint gross={gross} /> : undefined}
          >
            {(control) => (
              <AmountInput {...control} value={gross} onChange={setGross} placeholder={agency ? "4 350" : "80 000"} disabled={busy} />
            )}
          </Field>
        )}
        {canAttachFiles && (
          <OfficialFileField
            label="Трудовой договор"
            file={file}
            onChange={setFile}
            attached={Boolean(editing?.contract_path)}
            disabled={busy}
            hint={file ? `Сохранится в «Документах» как «${documentName}»` : undefined}
          />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Номер договора">
            {(control) => (
              <Input {...control} value={number} maxLength={50} placeholder="17" disabled={busy} onChange={(e) => setNumber(e.target.value)} />
            )}
          </Field>
          <Field label="Дата договора">
            {(control) => <DatePicker {...control} value={contractDate} onChange={setContractDate} disabled={busy} />}
          </Field>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </PayrollDetailDialog>
  );
}
