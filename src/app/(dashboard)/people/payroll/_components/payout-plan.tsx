"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "@/components/ui/option-select";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money, formatRub } from "@/components/shared/money";
import { unwrapAction } from "@/lib/actions/result";
import { formatDayMonth } from "@/lib/format/date";
import { countRu } from "@/lib/format/plural";
import { addDays } from "@/lib/sales/time";
import { payoutRowState, type PayoutRowState, type PayoutScheduleCode } from "@/lib/payroll/payout-plan";
import { CalendarClock } from "lucide-react";
import {
  loadPayoutPlan,
  savePayoutPlan,
  setPayoutPlanState,
  updatePayoutRow,
  type PayoutPlanView,
  type PayoutRowView,
} from "../payout-actions";
import { PayrollTable } from "./payroll-table";
import { PayrollEmployeeCell } from "./payroll-employee-cell";
import { PayrollDetailDialog } from "./payroll-detail-dialog";
import { PayoutIssueDialog } from "./payout-issue-dialog";
import { selectClass } from "./select-class";
import formStyle from "./payroll-payment-form.module.css";

const labels = {
  employee: "Сотрудник",
  earned: "Начислено",
  forecast: "Прогноз",
  reserve: "Запас",
  official: "Официальная часть",
  paid: "Выплачено",
  amount: "К выплате",
  status: "Статус",
};
const numeric = ["earned", "forecast", "reserve", "official", "paid", "amount"];
const FLAG_TEXT: Record<string, string> = {
  few_shifts: "Мало смен для прогноза",
  no_shift: "Нет смены в окне выплаты: выберите день сами",
  unmoved_balance: "Остаток прошлого месяца не перенесён",
};
const monthTitle = (month: string) => {
  const name = new Date(`${month}T12:00:00Z`).toLocaleDateString("ru-RU", { month: "long", timeZone: "UTC" });
  return name.charAt(0).toUpperCase() + name.slice(1);
};
const shortDate = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

const TONE: Record<PayoutRowState, "success" | "warning" | "neutral" | "info" | "danger"> = {
  issued: "success",
  partial: "warning",
  none: "neutral",
  invoice: "neutral",
  waiting: "info",
  missed: "danger",
  no_day: "warning",
};
const dayText = (d: string | null) => (d ? (formatDayMonth(d) ?? d) : "");
/** Статус строки с датой: «В плане на 25 ноября», «Пропущено 25 ноября». */
function rowStatus(row: PayoutRowView, today: string) {
  if (row.outside) return <StatusBadge tone="neutral">Вне плана</StatusBadge>;
  const state = payoutRowState(row, today, "cash");
  const text =
    state === "issued" ? "Выдано"
    : state === "partial" ? `Выдано частично, остаток ${dayText(row.pay_date)}`
    : state === "none" ? "Не выдаём"
    : state === "waiting" ? `В плане на ${dayText(row.pay_date)}`
    : state === "missed" ? `Пропущено ${dayText(row.pay_date)}`
    : "Нет дня";
  return <StatusBadge tone={TONE[state]}>{text}</StatusBadge>;
}

export function PayoutPlan({ onChanged }: { onChanged: () => Promise<void> }) {
  // План — для наличных. Сотрудники на графике «Переводом» в план не входят:
  // им платят по их счетам, выплаты вносят вручную (Павел, 25.11).
  const schedule: PayoutScheduleCode = "main";
  const [view, setView] = useState<PayoutPlanView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [openRow, setOpenRow] = useState<PayoutRowView | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(unwrapAction(await loadPayoutPlan(schedule)));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить план выплат");
    }
  }, [schedule]);
  useEffect(() => {
    setView(null);
    void load();
  }, [load]);

  const refresh = async () => {
    await load();
    try { await onChanged(); } catch { /* Ведомость обновится при следующем автообновлении. */ }
  };
  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      await refresh();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось выполнить действие");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const plan = view?.plan ?? null;
  const rows = useMemo(() => view?.rows ?? [], [view]);
  const today = view?.today ?? "";
  const dueToday = plan?.state === "approved"
    && rows.some((r) => r.state !== "issued" && r.pay_date === today && r.amount > r.issued);

  const columns = useMemo<ColumnDef<PayoutRowView>[]>(
    () =>
      Object.entries(labels).map(([id, label]) => ({
        id,
        header: label,
        // Заголовок целиком, со стрелкой сортировки (правило дизайн-системы).
        minSize: id === "employee" ? 200 : label.length * 8 + 32,
        accessorFn: (row) =>
          id === "employee" ? row.name
          : id === "earned" ? row.breakdown.earned
          : id === "forecast" ? row.breakdown.forecast
          : id === "reserve" ? row.breakdown.reserve
          : id === "paid" ? row.paidNow
          : id === "official" ? row.breakdown.official
          : id === "amount" ? row.amount
          : (row.outside ? "~" : row.pay_date ?? ""),
        cell: ({ row }) => {
          const r = row.original;
          if (id === "employee")
            return (
              // Имя ведёт в расчёт сотрудника за месяц плана; остальная строка открывает расшифровку.
              <Link
                href={`/people/payroll/${r.employee_id}${plan || view?.window ? `?month=${(plan?.month ?? view?.window?.month ?? "").slice(0, 7)}` : ""}`}
                onClick={(e) => e.stopPropagation()}
                className="block rounded-md hover:opacity-80"
              >
                <PayrollEmployeeCell name={r.name} role={r.role} avatarUrl={r.avatarUrl} />
              </Link>
            );
          if (r.outside && id !== "status" && id !== "earned" && id !== "paid" && id !== "official")
            return <span className="text-muted-foreground">—</span>;
          if (id === "status") return rowStatus(r, today);
          if (id === "forecast")
            return r.breakdown.averageShift === null
              ? <span className="text-muted-foreground">—</span>
              : <span data-tip={`${countRu(r.breakdown.forecastShifts, "смена", "смены", "смен")} × ${formatRub(r.breakdown.averageShift)}`}><Money value={r.breakdown.forecast} /></span>;
          if (id === "official")
            return r.breakdown.official ? (
              <span data-tip="Выплатит бухгалтерия; идёт в счёт первой половины месяца">
                <Money value={-r.breakdown.official} signed />
              </span>
            ) : <span className="text-muted-foreground">—</span>;
          if (id === "amount")
            return (
              <span className="inline-flex flex-col items-end">
                <Money value={r.amount} className="font-semibold" />
                {r.fresh !== null && plan && Math.round(r.fresh) < Math.round(r.amount) && (
                  <small className="text-xs text-amber-700 dark:text-amber-400">сейчас {formatRub(r.fresh)}</small>
                )}
              </span>
            );
          const value = id === "earned" ? r.breakdown.earned : id === "reserve" ? r.breakdown.reserve : r.paidNow;
          return <Money value={value} />;
        },
      })),
    [plan, today, view],
  );


  const canPay = view?.canPay ?? false;
  const actions = view && canPay ? (
    <>
      {!plan && view.window && (
        <Button size="sm" disabled={busy} onClick={() => void run(async () => unwrapAction(await savePayoutPlan(schedule)), "План сформирован")}>
          Сформировать план
        </Button>
      )}
      {plan?.state === "draft" && (
        <>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => unwrapAction(await savePayoutPlan(schedule)), "План пересчитан")}>
            Пересчитать
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void run(async () => unwrapAction(await setPayoutPlanState(plan.id, "approved")), "План утверждён")}>
            Утвердить
          </Button>
        </>
      )}
      {plan && plan.state !== "cancelled" && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setCancelOpen(true)}>Отменить план</Button>
      )}
      {dueToday && view.canIssue && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setIssueOpen(true)}>Выдать сейчас</Button>
      )}
    </>
  ) : null;


  const heading = view?.window ? (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium">
        {monthTitle(view.window.month)}, первая выплата · {shortDate(view.window.from)} – {shortDate(view.window.to)}
      </span>
      {plan?.state === "draft" && <StatusBadge tone="neutral">Черновик</StatusBadge>}
      {plan?.state === "approved" && <StatusBadge tone="success">Утверждён</StatusBadge>}
      {!plan && <StatusBadge tone="neutral">Не сформирован</StatusBadge>}
    </div>
  ) : null;

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {heading}
      </div>
      {view?.shiftsHidden && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          Нет доступа к графику работы всей команды: дни выплаты и прогноз по сменам не видны. Нужно право планировать график.
        </p>
      )}
      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => void load()}>Повторить</Button>
        </div>
      )}
      {!view && !error && <p className="py-6 text-sm text-muted-foreground">Загружаем план выплат…</p>}
      {view && !view.window && !plan && (
        <EmptyState
          icon={CalendarClock}
          title="Сейчас не окно первой выплаты"
          description="План первой выплаты формируется с 25-го по 1-е число."
        />
      )}
      {view && (view.window || plan) && (
        <PayrollTable
          id={`payroll.payout-plan.${schedule}`}
          label="План выплат"
          rows={rows}
          columns={columns}
          labels={labels}
          numeric={numeric}
          searchText={(r) => `${r.name} ${r.role}`}
          onRow={(r) => { if (!r.outside) setOpenRow(r); }}
          actions={actions}
          emptyText="В этом графике нет сотрудников"
          totals={(visible) => ({
            amount: <Money value={visible.reduce((s, r) => s + r.amount, 0)} className="font-semibold" />,
            paid: <Money value={visible.reduce((s, r) => s + r.paidNow, 0)} />,
          })}
        />
      )}

      {openRow && view && (
        <PayoutRowDrawer
          row={openRow}
          view={view}
          busy={busy}
          onClose={() => setOpenRow(null)}
          onSave={async (amount, day) => {
            if (!openRow.id) return;
            const ok = await run(async () => unwrapAction(await updatePayoutRow(openRow.id!, amount, day)), "Строка сохранена");
            if (ok) setOpenRow(null);
          }}
        />
      )}
      {issueOpen && plan && (
        <PayoutIssueDialog planId={plan.id} onClose={() => setIssueOpen(false)} onDone={refresh} />
      )}
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Отменить план выплат?"
        description="Уже проведённые выплаты останутся. Новый план можно будет сформировать заново."
        confirmLabel="Отменить план"
        destructive
        busy={busy}
        onConfirm={async () => {
          if (!plan) return;
          const ok = await run(async () => unwrapAction(await setPayoutPlanState(plan.id, "cancelled")), "План отменён");
          if (ok) setCancelOpen(false);
        }}
      />
    </div>
  );
}

function PayoutRowDrawer({
  row,
  view,
  busy,
  onClose,
  onSave,
}: {
  row: PayoutRowView;
  view: PayoutPlanView;
  busy: boolean;
  onClose: () => void;
  onSave: (amount: number, day: string | null) => Promise<void>;
}) {
  const [amount, setAmount] = useState(String(row.amount));
  const [day, setDay] = useState(row.pay_date ?? "");
  const b = row.breakdown;
  const plan = view.plan;
  const editable = !!row.id && !!plan && plan.state !== "cancelled" && row.state !== "issued" && view.canPay;
  const days: string[] = [];
  if (view.window) for (let d = view.window.from; d <= view.window.to; d = addDays(d, 1)) days.push(d);
  const parsed = Number(amount.replace(",", ".").replace(/\s/g, ""));
  const valid = Number.isFinite(parsed) && parsed >= 0;
  const changed = valid && (parsed !== row.amount || (day || null) !== row.pay_date);
  const line = (label: string, value: React.ReactNode, hint?: string) => (
    <li className="flex items-start justify-between gap-3 py-1.5">
      <span>
        {label}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </li>
  );
  return (
    <PayrollDetailDialog
      open
      onOpenChange={(open) => { if (!open && !busy) onClose(); }}
      title="Строка плана"
      description={plan ? `${monthTitle(plan.month)}, первая выплата` : "Расчёт первой выплаты"}
      employee={{ name: row.name, role: row.role, avatarUrl: row.avatarUrl }}
      amount={<Money value={row.amount} />}
      amountLabel="К выплате"
      status={rowStatus(row, view.today)}
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>Закрыть</Button>
          {editable && (
            <Button disabled={busy || !changed} onClick={() => void onSave(Math.round(parsed * 100) / 100, day || null)}>
              {busy ? "Сохраняем…" : "Сохранить"}
            </Button>
          )}
        </>
      }
    >
      <div className={formStyle.form}>
        <ul className="divide-y rounded-xl border px-3 text-sm">
          {b.carried !== 0 && line("Перенесено из прошлого месяца", <Money value={b.carried} signed />)}
          {line("Начислено за месяц", <Money value={b.earned} />, b.pendingFines ? `без штрафов на подтверждении: ${formatRub(b.pendingFines)}` : undefined)}
          {line(
            "Прогноз до конца месяца",
            b.averageShift === null ? "—" : <Money value={b.forecast} />,
            b.averageShift === null ? "мало смен для прогноза" : `${countRu(b.forecastShifts, "смена", "смены", "смен")} × ${formatRub(b.averageShift)}`,
          )}
          {line("Запас", <Money value={-b.reserve} signed />)}
          {line("Половина месяца", <Money value={b.half} />)}
          {line("Уже выплачено за месяц", <Money value={-b.paid} signed />)}
          {b.official > 0 && line("Официальная часть", <Money value={-b.official} signed />, "выплатит бухгалтерия; идёт в счёт первой половины месяца")}
          {line("Больше не выдаём", <Money value={Math.max(0, b.ceiling)} />, b.official > 0 ? "начислено минус выплаченное, запас и официальная часть" : "начислено минус выплаченное и запас")}
          {line("К выплате", <strong><Money value={row.amount} /></strong>, "вниз до шага округления")}
          {row.issued > 0 && line("Выдано", <Money value={row.issued} />)}
        </ul>
        {payoutRowState(row, view.today, "cash") === "missed" && (
          <p role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            День выплаты прошёл, а выдано не всё. Выберите другой день в окне.
          </p>
        )}
        {b.flags.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            {b.flags.map((f) => <li key={f}>{FLAG_TEXT[f] ?? f}</li>)}
          </ul>
        )}
        {editable && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="payout-row-amount">К выплате, ₽</Label>
              <Input id="payout-row-amount" inputMode="decimal" value={amount} disabled={busy} onChange={(e) => setAmount(e.target.value)} />
              {row.issued > 0 && <p className="text-[13px] text-muted-foreground">Не меньше выданного: {formatRub(row.issued)}</p>}
            </div>
            <div className="space-y-2">
                <Label htmlFor="payout-row-day">День выплаты</Label>
                <OptionSelect
                  id="payout-row-day"
                  className={selectClass}
                  value={day}
                  disabled={busy}
                  onValueChange={setDay}
                  placeholder="Не выбран"
                  options={[{ value: "", label: "Не выбран" }, ...days.map((d) => ({ value: d, label: formatDayMonth(d) ?? d }))]}
                />
            </div>
          </div>
        )}
      </div>
    </PayrollDetailDialog>
  );
}
