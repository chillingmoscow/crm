"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { recordIndividualPayments, recordOfficialPayment } from "@/app/(dashboard)/people/payroll/actions";
import { unwrapAction } from "@/lib/actions/result";
import type { PayrollData } from "@/lib/payroll/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Field } from "@/components/ui/field";
import { AmountInput } from "@/components/finance/amount-input";
import { officialGrossFromNet } from "@/lib/payroll/official";
import {
  canRecordOfficialPayment,
  checkingBanks,
  officialAmountsError,
  officialBankFor,
  officialPaymentOption,
  officialTaxOf,
} from "@/lib/payroll/official-payment";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PayrollEmployeePicker } from "@/app/(dashboard)/people/payroll/_components/payroll-employee-picker";
import { DatePicker } from "@/components/ui/date-picker";
import { zonedParts } from "@/lib/sales/time";
import { PayrollMonthPicker } from "@/app/(dashboard)/people/payroll/_components/payroll-month-picker";
import { Money } from "@/components/shared/money";
import { PayrollEmployeeCell } from "./payroll-employee-cell";
import s from "./payroll-payment-form.module.css";

export function PayrollPaymentForm({
  data,
  month,
  onDone,
  onCancel,
  initialEmployeeId,
}: {
  /** Закрыть панель без записи: кнопка «Отмена» в подвале. */
  onCancel?: () => void;
  initialEmployeeId?: string;
  data: PayrollData;
  month: string;
  onDone: () => Promise<void>;
}) {
  const formId = useId();
  const [bank, setBank] = useState(data.banks[0]?.id ?? "");
  const [amounts, setAmounts] = useState<Record<string, string>>(() => initialEmployeeId ? {[initialEmployeeId]: ""} : {});
  const [months, setMonths] = useState<Record<string, string>>({});
  const [paymentDate, setPaymentDate] = useState(
    () => zonedParts(new Date(), data.timezone).date,
  );
  const [note, setNote] = useState("");
  // «Официальная часть»: сумма на руки и оклад с налогом. Оклад досчитывается
  // от суммы на руки, пока его не поправили вручную.
  const [official, setOfficial] = useState(false);
  const [officialNetValue, setOfficialNetValue] = useState<number | null>(null);
  const [officialGrossValue, setOfficialGrossValue] = useState<number | null>(null);
  const [grossEdited, setGrossEdited] = useState(false);
  const [prefilledFor, setPrefilledFor] = useState("");
  // Счёт, выбранный для официальной выплаты вручную; null — берём счёт из
  // настроек официальной зарплаты. Отдельно от обычного счёта, который
  // форма ставит первым из списка.
  const [officialBankPick, setOfficialBankPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [footerTarget, setFooterTarget] = useState<HTMLElement | null>(null);
  const request = useRef<{ key: string; date: string; payload: string } | null>(
    null,
  );
  useEffect(
    () => setFooterTarget(document.getElementById("payroll-payment-footer")),
    [],
  );
  const employees = [...data.employees]
    .filter(
      (e) =>
        e.active ||
        data.accruals.some(
          (a) =>
            a.employee_id === e.id &&
            a.business_date.startsWith(month.slice(0, 7)),
        ),
    )
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const selected = employees.filter((e) => Object.hasOwn(amounts, e.id));
  const amount = selected.reduce(
    (sum, e) => sum + (Number(amounts[e.id]) || 0),
    0,
  );
  const officialMonth = selected.length === 1 ? (months[selected[0].id] ?? month) : month;
  const officialOption = canRecordOfficialPayment(data.permissions)
    ? officialPaymentOption({
        employeeIds: selected.map((e) => e.id),
        month: officialMonth,
        employments: data.officialEmployments ?? [],
        expected: data.officialExpected ?? [],
        payments: data.payments,
        allocations: data.allocations,
      })
    : ({ available: false } as const);
  const officialOn = official && officialOption.available && !officialOption.blocked;
  // Новый сотрудник или месяц — суммы подставляются заново (ожидаемая часть
  // месяца или удалённая выплата за него).
  const prefillKey = officialOption.available ? `${officialOption.employmentId}|${officialMonth}` : "";
  if (official && prefillKey && prefilledFor !== prefillKey && officialOption.available) {
    setPrefilledFor(prefillKey);
    setOfficialNetValue(officialOption.net);
    setOfficialGrossValue(officialOption.gross);
    setGrossEdited(false);
  }
  const officialChecking = checkingBanks(data.banks);
  const bankValue = officialOn
    ? officialBankFor(data.banks, officialBankPick, data.settings?.official_bank_account_id)
    : bank;
  const officialError = officialAmountsError(officialNetValue, officialGrossValue);
  const officialTax = officialTaxOf(officialNetValue, officialGrossValue);
  const total = officialOn ? (officialNetValue ?? 0) : amount;
  const valid = officialOn
    ? !officialError && !!selected[0]?.role_id
    : selected.length > 0 &&
      selected.every((e) => Number(amounts[e.id]) > 0 && e.role_id);
  async function submitOfficial() {
    if (!officialOption.available || officialNetValue === null || officialGrossValue === null) return;
    setBusy(true);
    try {
      unwrapAction(
        await recordOfficialPayment({
          employment_id: officialOption.employmentId,
          month: `${officialMonth.slice(0, 7)}-01`,
          gross: officialGrossValue,
          net: officialNetValue,
          bank_account_id: bankValue,
          date: `${paymentDate}T00:00:00.000Z`,
        }),
      );
      toast.success("Официальная выплата проведена");
      await onDone();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Не удалось провести официальную выплату",
      );
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !valid || !bankValue || !paymentDate) return;
    // База не принимает повтор официальной выплаты за месяц, поэтому ключ
    // запроса ей не нужен: двойное нажатие получит отказ.
    if (officialOn) return submitOfficial();
    const payload = {
      bank_account_id: bank,
      // Match the date-only convention of the financial transaction form.
      date: `${paymentDate}T00:00:00.000Z`,
      note,
      recipients: selected.map((e) => ({
        employee_id: e.id,
        month: months[e.id] ?? month,
        amount: Number(amounts[e.id]),
      })),
    };
    const snapshot = JSON.stringify(payload);
    if (!request.current || request.current.payload !== snapshot)
      request.current = {
        key: crypto.randomUUID(),
        date: payload.date,
        payload: snapshot,
      };
    setBusy(true);
    try {
      unwrapAction(await recordIndividualPayments({
        ...payload,
        request_key: request.current.key,
        date: request.current.date,
      }));
      toast.success(
        selected.length === 1
          ? "Выплата записана"
          : `Записано выплат: ${selected.length}`,
      );
      await onDone();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Не удалось записать выплату",
      );
    } finally {
      setBusy(false);
    }
  }
  const footer = (
    <div className={s.footer}>
      <div className={s.totalRow}>
        <div aria-live="polite">
          <span>Итого</span>
          <strong>
            <Money value={total} fraction={!Number.isInteger(total)} />
          </strong>
        </div>
        <div className="flex items-center gap-2">
        {onCancel && (
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            Отмена
          </Button>
        )}
        <Button
          type="submit"
          form={formId}
          disabled={busy || !valid || !bankValue || !paymentDate}
        >
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {busy
            ? "Сохраняем…"
            : selected.length > 1
              ? "Записать выплаты"
              : "Записать выплату"}
        </Button>
        </div>
      </div>
      <p className={s.footerMeta}>
        {officialOn
          ? "Расход в финансах создаётся на сумму на руки. В Adesk официальная выплата не отправляется."
          : "Каждому сотруднику создаётся отдельная транзакция в финансах."}
      </p>
    </div>
  );
  return (
    <>
      <form id={formId} className={s.form} onSubmit={submit}>
        <div className={s.fields}>
          <div className={s.accountField}>
            <Label htmlFor={`${formId}-bank`}>Счёт списания</Label>
            <Select
              required
              value={bankValue}
              onValueChange={officialOn ? setOfficialBankPick : setBank}
              disabled={busy}
            >
              <SelectTrigger
                id={`${formId}-bank`}
                className={s.select}
                aria-describedby={officialOn && !officialChecking.length ? `${formId}-bank-error` : undefined}
                aria-invalid={officialOn && !officialChecking.length ? true : undefined}
              >
                <SelectValue placeholder="Выберите счёт" />
              </SelectTrigger>
              <SelectContent>
                {(officialOn ? officialChecking : data.banks).map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {officialOn && !officialChecking.length && (
              <p id={`${formId}-bank-error`} className="text-xs text-destructive">
                Нет расчётного счёта: официальную выплату проводят только с него
              </p>
            )}
          </div>
          <div>
            <Label htmlFor={`${formId}-date`}>Дата выплаты</Label>
            <DatePicker
              id={`${formId}-date`}
              value={paymentDate}
              onChange={setPaymentDate}
              clearable={false}
              disabled={busy}
            />
          </div>
        </div>
        <section
          className={s.recipients}
          aria-labelledby={`${formId}-recipients`}
        >
          <div className={s.recipientHeading}>
            <h3 id={`${formId}-recipients`}>
              Кому выплачиваем{" "}
              {selected.length > 0 && <span>{selected.length}</span>}
            </h3>
          </div>
          <PayrollEmployeePicker employees={employees} selectedIds={Object.keys(amounts)} multiple disabled={busy} onChange={(ids) => setAmounts((previous) => Object.fromEntries(ids.map((id) => [id, previous[id] ?? ""])))} />
          {selected.length > 0 && (
            <div className={s.selectedPeople}>
              {selected.map((e) => (
                <div key={e.id} className={s.person}>
                  {/* Получатель — общий `EmployeeIdentity` (фото, имя, должность),
                      как в выборе сотрудника и в таблицах «Зарплаты». */}
                  <div className={s.identity}>
                    <PayrollEmployeeCell
                      name={e.name}
                      role={e.role_name}
                      avatarUrl={e.avatar_url}
                    />
                    <PayrollMonthPicker
                      value={months[e.id] ?? month}
                      onChange={(value) =>
                        setMonths((prev) => ({ ...prev, [e.id]: value }))
                      }
                      min={
                        (data.settings?.starts_on ?? "2026-09-01").slice(0, 7) +
                        "-01"
                      }
                      employee={e.name}
                      disabled={busy}
                    />
                    {!e.role_id && (
                      <small className="text-destructive">
                        Укажите должность сотрудника
                      </small>
                    )}
                  </div>
                  {!officialOn && <div className={s.amountInput}>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      step="0.01"
                      max="1000000000"
                      required
                      aria-label={`Выплата ${e.name}`}
                      disabled={busy}
                      value={amounts[e.id]}
                      placeholder="0"
                      onChange={(event) =>
                        setAmounts((prev) => ({
                          ...prev,
                          [e.id]: event.target.value,
                        }))
                      }
                    />
                    <span>₽</span>
                  </div>}
                  <button
                    type="button"
                    disabled={busy}
                    className={`${s.removePerson} touch-target`}
                    aria-label={`Убрать ${e.name}`}
                    onClick={() =>
                      setAmounts((prev) => {
                        const next = { ...prev };
                        delete next[e.id];
                        return next;
                      })
                    }
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {officialOption.available && (
            <div className="mt-4 flex items-start justify-between gap-4 rounded-lg border p-3">
              <div className="min-w-0">
                <Label htmlFor={`${formId}-official`}>Официальная часть</Label>
                <p id={`${formId}-official-hint`} className="mt-1 text-xs text-muted-foreground">
                  {officialOption.blocked ??
                    "Выплата бухгалтерии по договору: только с расчётного счёта, закрывает оклад с налогом"}
                </p>
              </div>
              <Switch
                id={`${formId}-official`}
                aria-describedby={`${formId}-official-hint`}
                checked={officialOn}
                disabled={busy || !!officialOption.blocked}
                onCheckedChange={setOfficial}
              />
            </div>
          )}
          {officialOn && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="На руки" required>
                {(control) => (
                  <AmountInput
                    {...control}
                    value={officialNetValue}
                    disabled={busy}
                    onChange={(value) => {
                      setOfficialNetValue(value);
                      if (!grossEdited) setOfficialGrossValue(value === null ? null : officialGrossFromNet(value));
                    }}
                  />
                )}
              </Field>
              <Field
                label="Оклад с налогом"
                required
                hint={
                  officialTax !== null && officialTax >= 0 ? (
                    <>
                      НДФЛ <Money value={officialTax} fraction="auto" />
                    </>
                  ) : undefined
                }
                error={officialNetValue !== null && officialGrossValue !== null ? officialError : undefined}
              >
                {(control) => (
                  <AmountInput
                    {...control}
                    value={officialGrossValue}
                    disabled={busy}
                    onChange={(value) => {
                      setOfficialGrossValue(value);
                      setGrossEdited(true);
                    }}
                  />
                )}
              </Field>
            </div>
          )}
          <p className={s.categoryHint}>
            Статьи ФОТ подставляются по должностям.
          </p>
        </section>
        {!officialOn && <div className={s.noteField}>
          <Label htmlFor={`${formId}-note`}>Комментарий</Label>
          <textarea
            id={`${formId}-note`}
            aria-label="Комментарий к выплате"
            rows={3}
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Необязательно"
            disabled={busy}
          />
        </div>}
      </form>
      {footerTarget ? createPortal(footer, footerTarget) : null}
    </>
  );
}
