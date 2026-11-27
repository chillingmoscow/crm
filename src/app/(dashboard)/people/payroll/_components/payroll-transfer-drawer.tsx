"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PayrollDetailDialog } from "@/app/(dashboard)/people/payroll/_components/payroll-detail-dialog";
import { PayrollEmployeePicker } from "@/app/(dashboard)/people/payroll/_components/payroll-employee-picker";
import { PayrollEmployeeCell } from "@/app/(dashboard)/people/payroll/_components/payroll-employee-cell";
import { transferPayroll } from "@/app/(dashboard)/people/payroll/actions";
import { unwrapAction } from "@/lib/actions/result";
import { statementRows, transferableBalance } from "@/lib/payroll/calculate";
import formStyle from "./payroll-payment-form.module.css";
import type { PayrollData } from "@/lib/payroll/types";
import { Money } from "@/components/shared/money";
import { toKopecks } from "@/lib/format/amount";
import { countRu } from "@/lib/format/plural";

const monthLabel = (m: string) =>
  new Date(`${m}T12:00:00Z`)
    .toLocaleDateString("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" })
    .replace(" г.", "");

/** «октября 2026»: месяц в родительном падеже, для «С … на …». */
const monthFromLabel = (m: string) =>
  new Date(`${m}T12:00:00Z`)
    .toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .replace(/^\d+\s*/, "")
    .replace(" г.", "");

/**
 * Причина для журнала: база требует её, а выбирать здесь нечего. Остаток
 * бывает долгом (недоплатили — доплатим в следующем месяце) или переплатой
 * (выдали больше — удержим из следующего месяца), и причина говорит, какой.
 */
export function transferReason(remaining: number, from: string, to: string) {
  return remaining < 0
    ? `Переплата за ${monthLabel(from)}: удерживается из выплаты за ${monthLabel(to)}`
    : `Недоплата за ${monthLabel(from)}: переносится к выплате за ${monthLabel(to)}`;
}

/**
 * Кому есть что переносить за месяц: известный и ненулевой остаток.
 * Переплату, возникшую из-за ожидаемой официальной части, база не видит —
 * её нет. Пока прежние выплаты месяца на сверке, остаток неизвестен.
 */
export function transferCandidates(data: PayrollData, month: string) {
  const rows = statementRows(
    data.employees, data.accruals, data.adjustments, data.payments, data.allocations, month,
    data.transfers, data.settings?.starts_on ?? month, data.officialExpected ?? [],
  );
  return rows.flatMap((row) => {
    const pending = data.legacyPayments.some(
      (p) => p.employee_id === row.employee.id && p.month === month && p.state === "review",
    );
    const { amount } = transferableBalance(row);
    return !pending && toKopecks(amount) > 0 ? [{ row, amount }] : [];
  });
}

/**
 * Перенос остатка всегда целиком и всегда на следующий месяц, сразу для
 * нескольких сотрудников. Каждый сотрудник — отдельный перенос в базе: если
 * у одного расчёт не завершён, остальные всё равно переносятся.
 */
export function PayrollTransferDrawer({ open = true, data, month, employeeId, onClose, onChange }: {
  /** Открыта ли панель. Её держат смонтированной, пока она уезжает (docs/motion.md). */
  open?: boolean;
  data: PayrollData;
  month: string;
  employeeId?: string;
  onClose: () => void;
  onChange: () => Promise<void>;
}) {
  const next = new Date(`${month}T12:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const target = next.toISOString().slice(0, 10);
  const eligible = transferCandidates(data, month);
  const remainingOf = new Map(eligible.map((e) => [e.row.employee.id, e.row.remaining]));
  const [selected, setSelected] = useState<string[]>(
    employeeId && eligible.some((e) => e.row.employee.id === employeeId) ? [employeeId] : [],
  );
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<Record<string, string>>({});
  // Ключи повтора по сотруднику: повторное нажатие после сбоя не создаст дубль.
  const keys = useRef(new Map<string, string>());
  const chosen = eligible.filter((e) => selected.includes(e.row.employee.id));
  const total = chosen.reduce((sum, e) => sum + Math.sign(e.row.remaining) * e.amount, 0);
  const unavailable = employeeId && !eligible.some((e) => e.row.employee.id === employeeId);

  const submit = async () => {
    setBusy(true);
    const errors: Record<string, string> = {};
    let done = 0;
    for (const { row, amount } of chosen) {
      const id = row.employee.id;
      if (!keys.current.has(id)) keys.current.set(id, crypto.randomUUID());
      try {
        unwrapAction(await transferPayroll({
          request_key: keys.current.get(id),
          employee_id: id,
          from_month: month,
          to_month: target,
          amount: amount * Math.sign(row.remaining),
          reason: transferReason(row.remaining, month, target),
        }));
        keys.current.delete(id);
        done++;
      } catch (e) {
        errors[id] = e instanceof Error ? e.message : "Не удалось перенести";
      }
    }
    try { await onChange(); } catch { /* Ведомость обновится при следующем автообновлении. */ }
    setBusy(false);
    setFailed(errors);
    const failedIds = Object.keys(errors);
    if (!failedIds.length) {
      toast.success(done === 1 ? "Остаток перенесён" : `Перенесено: ${countRu(done, "сотрудник", "сотрудника", "сотрудников")}`);
      onClose();
      return;
    }
    // Оставляем в списке только тех, у кого не получилось: причина видна рядом.
    setSelected(failedIds);
    if (done) toast.success(`Перенесено: ${countRu(done, "сотрудник", "сотрудника", "сотрудников")}`);
  };

  return (
    <PayrollDetailDialog
      open={open}
      onOpenChange={(open) => { if (!open && !busy) onClose(); }}
      title="Перенести остаток"
      description={`С ${monthFromLabel(month)} на ${monthLabel(target)}`}
      footer={<>
        <Button variant="outline" disabled={busy} onClick={onClose}>Отмена</Button>
        <Button disabled={busy || !chosen.length} onClick={() => void submit()}>
          {busy ? "Переносим…" : chosen.length > 1 ? `Перенести · ${chosen.length}` : "Перенести"}
        </Button>
      </>}
    >
      <div className={formStyle.form}>
        <div className="space-y-2">
          <Label>Сотрудники</Label>
          <PayrollEmployeePicker
            multiple
            employees={eligible.map((e) => e.row.employee)}
            selectedIds={selected}
            disabled={busy || !eligible.length}
            onChange={(ids) => { setSelected(ids); setFailed({}); }}
            // Остаток «К выплате» — как в ведомости: переплата с минусом.
            aside={(e) => <Money value={remainingOf.get(e.id)} fraction="auto" />}
          />
          {!eligible.length && (
            <p className="text-xs text-muted-foreground">
              За {monthLabel(month)} переносить нечего: ни у кого нет остатка.
            </p>
          )}
          {unavailable && eligible.length > 0 && (
            <p className="text-xs text-muted-foreground">
              У этого сотрудника нет остатка, который можно перенести.
            </p>
          )}
        </div>

        {chosen.length > 0 && (
          <ul className="divide-y rounded-xl border">
            {chosen.map(({ row, amount }) => (
              <li key={row.employee.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <PayrollEmployeeCell
                    name={row.employee.name}
                    role={row.employee.role_name}
                    avatarUrl={row.employee.avatar_url}
                  />
                  {failed[row.employee.id] && (
                    <p role="alert" className="mt-1 text-xs text-destructive">{failed[row.employee.id]}</p>
                  )}
                </div>
                <span className="shrink-0 text-right text-sm tabular-nums">
                  <Money value={amount} fraction="auto" />
                  {row.remaining < 0 && <span className="block text-xs text-muted-foreground">переплата</span>}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  aria-label={`Убрать ${row.employee.name}`}
                  disabled={busy}
                  onClick={() => setSelected((ids) => ids.filter((id) => id !== row.employee.id))}
                >
                  <X size={14} />
                </Button>
              </li>
            ))}
            {chosen.length > 1 && (
              <li className="flex items-center justify-between px-3 py-2.5 text-sm font-medium">
                <span>Итого</span>
                <span className="mr-10 tabular-nums"><Money value={total} fraction="auto" /></span>
              </li>
            )}
          </ul>
        )}

        <p className="text-xs leading-relaxed text-muted-foreground">
          Весь остаток за {monthLabel(month)} перейдёт в {monthLabel(target)}: недоплата добавится
          к выплате, переплата уменьшит её. Движения денег не будет. Отменить перенос можно
          в расчёте сотрудника.
        </p>
      </div>
    </PayrollDetailDialog>
  );
}
