"use client";
import {
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
  type Dispatch,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { statementRows } from "@/lib/payroll/calculate";
import type { PayrollData } from "@/lib/payroll/types";
import { money } from "@/lib/sales/format";
import { postPayrollPayment } from "../actions";
import { selectClass } from "./employee-pay";
export type PaymentFormDraft = {
  kind: "salary" | "advance";
  setKind: (kind: "salary" | "advance") => void;
  bank: string;
  setBank: (value: string) => void;
  category: string;
  setCategory: (value: string) => void;
  amounts: Record<string, string>;
  setAmounts: Dispatch<SetStateAction<Record<string, string>>>;
  note: string;
  setNote: (value: string) => void;
  busy: boolean;
  amount: number;
  rows: ReturnType<typeof statementRows>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  blockReason: (
    row: ReturnType<typeof statementRows>[number],
    kind?: "salary" | "advance",
  ) => string | null;
};
export function PaymentForm({
  data,
  month,
  onDone,
  render,
}: {
  data: PayrollData;
  month: string;
  onDone: () => Promise<void>;
  render?: (draft: PaymentFormDraft) => ReactNode;
}) {
  const key = useRef<string | null>(null),
    operationDate = useRef<string | null>(null),
    [kind, setKind] = useState<"salary" | "advance">("salary"),
    [bank, setBank] = useState(data.banks[0]?.id ?? ""),
    [category, setCategory] = useState(data.settings?.salary_category_id ?? ""),
    [amounts, setAmounts] = useState<Record<string, string>>({}),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false);
  const rows = useMemo(
    () =>
      statementRows(
        data.employees,
        data.accruals,
        data.adjustments,
        data.payments,
        data.allocations,
        month,
        data.transfers,
        data.settings?.starts_on,
      ).sort((a, b) => a.employee.name.localeCompare(b.employee.name, "ru")),
    [data, month],
  );
  const allocations = rows
      .filter((r) => Number(amounts[r.employee.id]) > 0)
      .map((r) => ({
        employee_id: r.employee.id,
        month,
        amount: Number(amounts[r.employee.id]),
        settled_amount: Number(amounts[r.employee.id]),
      })),
    amount = allocations.reduce((s, a) => s + a.amount, 0);
  const onSubmit: PaymentFormDraft["onSubmit"] = async (e) => {
    e.preventDefault();
    if (!amount) return;
    setBusy(true);
    key.current ??= crypto.randomUUID();
    operationDate.current ??= new Date().toISOString();
    try {
      await postPayrollPayment({
        request_key: key.current,
        kind,
        bank_account_id: bank,
        category_id: category,
        date: operationDate.current,
        amount: Math.round(amount * 100) / 100,
        note,
        allocations,
      });
      toast.success("Выплата проведена");
      await onDone();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось провести выплату",
      );
    } finally {
      setBusy(false);
    }
  };
  const blockReason: PaymentFormDraft["blockReason"] = (row, mode = kind) => {
    if (mode === "advance") return null;
    if (!row.employee.opening_confirmed)
      return "Уточните начальный долг или переплату в условиях оплаты сотрудника.";
    if (
      data.legacyPayments.some(
        (payment) =>
          payment.employee_id === row.employee.id &&
          payment.month === month &&
          payment.state === "review",
      )
    )
      return "Прежние выплаты ещё не учтены. Проверьте их в настройках заведения → Оплата труда → Первоначальные данные.";
    if (row.issues)
      return "В начислениях есть замечания. Откройте расчёт сотрудника и проверьте основания.";
    return null;
  };
  if (render)
    return render({
      kind,
      setKind: (next) => {
        setKind(next);
        if (next === "salary")
          setAmounts((current) =>
            Object.fromEntries(
              Object.entries(current).filter(([id]) => {
                const row = rows.find((row) => row.employee.id === id);
                return row && !blockReason(row, next);
              }),
            ),
          );
      },
      bank,
      setBank,
      category,
      setCategory,
      amounts,
      setAmounts,
      note,
      setNote,
      busy,
      amount,
      rows,
      onSubmit,
      blockReason,
    });
  return (
    <form className="mt-6 space-y-5" onSubmit={onSubmit}>
      <div className="space-y-2">
        <Label htmlFor="payment-kind">Вид выплаты</Label>
        <select
          className={selectClass}
          id="payment-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as "salary" | "advance")}
        >
          <option value="salary">Зарплата</option>
          <option value="advance">Аванс</option>
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="payment-bank">Счёт списания</Label>
        <select
          id="payment-bank"
          className={selectClass}
          value={bank}
          onChange={(e) => setBank(e.target.value)}
          required
        >
          <option value="">Выберите счёт</option>
          {data.banks.map((b) => (
            <option value={b.id} key={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="payment-category">Статья расхода</Label>
        <select
          id="payment-category"
          className={selectClass}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          required
        >
          <option value="">Выберите статью</option>
          {data.categories.map((c) => (
            <option value={c.id} key={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <div className="flex items-center justify-between gap-3">
          <Label>Получатели</Label>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={
              !rows.some(
                (r) =>
                  r.employee.opening_confirmed &&
                  r.remaining > 0 &&
                  !data.legacyPayments.some(
                    (p) =>
                      p.employee_id === r.employee.id &&
                      p.month === month &&
                      p.state === "review",
                  ),
              )
            }
            onClick={() =>
              setAmounts(
                Object.fromEntries(
                  rows
                    .filter(
                      (r) =>
                        r.employee.opening_confirmed &&
                        r.remaining > 0 &&
                        !data.legacyPayments.some(
                          (p) =>
                            p.employee_id === r.employee.id &&
                            p.month === month &&
                            p.state === "review",
                        ),
                    )
                    .map((r) => [r.employee.id, String(r.remaining)]),
                ),
              )
            }
          >
            Заполнить остатки
          </Button>
        </div>
        <div className="mt-2 max-h-72 space-y-3 overflow-auto rounded-xl border p-3">
          {rows.map((r) => (
            <div
              className="flex items-center justify-between gap-3"
              key={r.employee.id}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {r.employee.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {!r.employee.opening_confirmed
                    ? "Нужно указать начальный долг"
                    : data.legacyPayments.some(
                          (p) =>
                            p.employee_id === r.employee.id &&
                            p.month === month &&
                            p.state === "review",
                        )
                      ? "Нужно внести историю выплат"
                      : `К выплате ${money(r.remaining)} ₽`}
                </p>
              </div>
              <Input
                className="w-28 shrink-0 text-right tabular-nums"
                type="number"
                disabled={
                  kind === "salary" &&
                  (!r.employee.opening_confirmed ||
                    !!r.issues ||
                    data.legacyPayments.some(
                      (p) =>
                        p.employee_id === r.employee.id &&
                        p.month === month &&
                        p.state === "review",
                    ))
                }
                min="0"
                step="0.01"
                aria-label={`Выплата ${r.employee.name}`}
                value={amounts[r.employee.id] ?? ""}
                placeholder="0"
                onChange={(e) =>
                  setAmounts((s) => ({ ...s, [r.employee.id]: e.target.value }))
                }
              />
            </div>
          ))}
        </div>
      </div>
      <Label htmlFor="payment-note">Комментарий</Label>
      <Input
        id="payment-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex items-center justify-between border-t pt-4">
        <span className="font-semibold tabular-nums">{money(amount)} ₽</span>
        <Button disabled={busy || amount <= 0 || !bank || !category}>
          Записать выплату
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Запишите фактически выданную зарплату или аванс. Сумма уменьшит остаток
        к выплате и создаст расход в финансах. Перевод денег в банке выполняется
        отдельно.
      </p>
    </form>
  );
}
