"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { recordIndividualPayments } from "@/app/(dashboard)/people/payroll/actions";
import type { PayrollData } from "@/lib/payroll/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { money } from "@/lib/sales/format";
import s from "./concept-payment-form.module.css";

export function ConceptPaymentForm({
  data,
  month,
  onDone,
  initialEmployeeId,
}: {
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
  const [busy, setBusy] = useState(false);
  const [footerTarget, setFooterTarget] = useState<HTMLElement | null>(null);
  const request = useRef<{ key: string; date: string; payload: string } | null>(
    null,
  );
  useEffect(
    () => setFooterTarget(document.getElementById("concept-payment-footer")),
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
  const valid =
    selected.length > 0 &&
    selected.every((e) => Number(amounts[e.id]) > 0 && e.role_id);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !valid || !bank || !paymentDate) return;
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
      await recordIndividualPayments({
        ...payload,
        request_key: request.current.key,
        date: request.current.date,
      });
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
            {money(amount)} <small>₽</small>
          </strong>
        </div>
        <Button
          type="submit"
          form={formId}
          disabled={busy || !valid || !bank || !paymentDate}
        >
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {busy
            ? "Сохраняем…"
            : selected.length > 1
              ? "Записать выплаты"
              : "Записать выплату"}
        </Button>
      </div>
      <p className={s.footerMeta}>
        Каждому сотруднику создаётся отдельная транзакция в финансах.
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
              value={bank}
              onValueChange={setBank}
              disabled={busy}
            >
              <SelectTrigger id={`${formId}-bank`} className={s.select}>
                <SelectValue placeholder="Выберите счёт" />
              </SelectTrigger>
              <SelectContent>
                {data.banks.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                  <span className={s.avatar}>
                    {e.name
                      .split(" ")
                      .slice(0, 2)
                      .map((p) => p[0])
                      .join("")}
                  </span>
                  <div className={s.identity}>
                    <strong>{e.name}</strong>
                    <small>{e.role_name}</small>
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
                  <div className={s.amountInput}>
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
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    className={s.removePerson}
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
          <p className={s.categoryHint}>
            Статьи ФОТ подставляются по должностям.
          </p>
        </section>
        <div className={s.noteField}>
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
        </div>
      </form>
      {footerTarget ? createPortal(footer, footerTarget) : null}
    </>
  );
}
