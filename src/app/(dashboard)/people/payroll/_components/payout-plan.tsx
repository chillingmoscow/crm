"use client";

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
import { formatDateCell, formatDayMonth } from "@/lib/format/date";
import { countRu } from "@/lib/format/plural";
import { addDays } from "@/lib/sales/time";
import { payoutRowState, type PayoutRowState, type PayoutScheduleCode } from "@/lib/payroll/payout-plan";
import { CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
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
import { PayoutTransferDialog } from "./payout-transfer-dialog";
import { selectClass } from "./select-class";
import formStyle from "./payroll-payment-form.module.css";

const SCHEDULE_OPTIONS: { value: PayoutScheduleCode; label: string }[] = [
  { value: "main", label: "Основной" },
  { value: "transfer", label: "Переводом" },
];
const labels = {
  employee: "Сотрудник",
  day: "День выплаты",
  earned: "Начислено",
  forecast: "Прогноз",
  reserve: "Запас",
  paid: "Уже выплачено",
  amount: "К выплате",
  issued: "Выдано",
  status: "Статус",
};
const numeric = ["earned", "forecast", "reserve", "paid", "amount", "issued"];
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

const STATUS: Record<PayoutRowState, { tone: "success" | "warning" | "neutral" | "info" | "danger"; text: string }> = {
  issued: { tone: "success", text: "Выдано" },
  partial: { tone: "warning", text: "Выдано частично" },
  none: { tone: "neutral", text: "Не выдаём" },
  invoice: { tone: "info", text: "Ждёт оплаты счёта" },
  waiting: { tone: "info", text: "Ждёт дня" },
  missed: { tone: "danger", text: "День пропущен" },
  no_day: { tone: "warning", text: "Нет дня" },
};
function rowStatus(row: PayoutRowView, transfer: boolean, today: string) {
  const state = STATUS[payoutRowState(row, today, transfer ? "transfer" : "cash")];
  return <StatusBadge tone={state.tone}>{state.text}</StatusBadge>;
}

export function PayoutPlan({ onChanged }: { onChanged: () => Promise<void> }) {
  const [schedule, setSchedule] = useState<PayoutScheduleCode>("main");
  const [view, setView] = useState<PayoutPlanView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [openRow, setOpenRow] = useState<PayoutRowView | null>(null);
  const [transferRow, setTransferRow] = useState<PayoutRowView | null>(null);
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

  const transfer = schedule === "transfer";
  const plan = view?.plan ?? null;
  const rows = useMemo(() => view?.rows ?? [], [view]);
  const today = view?.today ?? "";
  const dueToday = !transfer && plan?.state === "approved"
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
          : id === "day" ? (row.pay_date ?? "")
          : id === "earned" ? row.breakdown.earned
          : id === "forecast" ? row.breakdown.forecast
          : id === "reserve" ? row.breakdown.reserve
          : id === "paid" ? row.breakdown.paid
          : id === "amount" ? row.amount
          : id === "issued" ? row.issued
          : row.state,
        cell: ({ row }) => {
          const r = row.original;
          if (id === "employee") return <PayrollEmployeeCell name={r.name} role={r.role} avatarUrl={r.avatarUrl} />;
          if (id === "status") return rowStatus(r, transfer, today);
          if (id === "day") return transfer ? <span className="text-muted-foreground">по счёту</span> : r.pay_date ? formatDateCell(r.pay_date) : "—";
          if (id === "forecast")
            return transfer || r.breakdown.averageShift === null
              ? <span className="text-muted-foreground">—</span>
              : <span data-tip={`${countRu(r.breakdown.forecastShifts, "смена", "смены", "смен")} × ${formatRub(r.breakdown.averageShift)}`}><Money value={r.breakdown.forecast} /></span>;
          if (id === "amount")
            return (
              <span className="inline-flex flex-col items-end">
                <Money value={r.amount} className="font-semibold" />
                {r.fresh !== null && plan && Math.round(r.fresh) < Math.round(r.amount) && (
                  <small className="text-xs text-amber-700 dark:text-amber-400">сейчас {formatRub(r.fresh)}</small>
                )}
              </span>
            );
          const value = id === "earned" ? r.breakdown.earned : id === "reserve" ? r.breakdown.reserve : id === "paid" ? r.breakdown.paid : r.issued;
          return <Money value={value} />;
        },
      })),
    [transfer, plan, today],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const r of rows) {
      if (!r.pay_date || r.amount - r.issued <= 0) continue;
      const day = map.get(r.pay_date) ?? { total: 0, count: 0 };
      day.total += r.amount - r.issued;
      day.count += 1;
      map.set(r.pay_date, day);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

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
        <Button size="sm" disabled={busy} onClick={() => setIssueOpen(true)}>Выдать сегодня</Button>
      )}
    </>
  ) : null;

  const scheduleSwitch = (
    <div role="radiogroup" aria-label="График выплат" className="inline-flex h-9 items-center gap-1 rounded-md bg-muted p-1">
      {SCHEDULE_OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={schedule === o.value}
          onClick={() => setSchedule(o.value)}
          className={cn(
            "inline-flex h-7 items-center rounded-md px-3 text-sm font-medium transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
            schedule === o.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );

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
        {scheduleSwitch}
        {heading}
      </div>
      {view && !transfer && view.window && (
        <p className="text-[13px] text-muted-foreground">
          Наличные выдают менеджеры. В день выплаты нажмите «Выдать сегодня»: приложение проверит кассы, проведёт выплаты
          с «Кэшбокса» и напишет в чат менеджеров.
        </p>
      )}
      {view && transfer && (
        <p className="text-[13px] text-muted-foreground">
          Сотрудник выставляет счёт, вы его оплачиваете и отмечаете «Выплачено». В Adesk такая выплата не отправляется.
        </p>
      )}
      {view?.shiftsHidden && !transfer && (
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
          key={schedule}
          id={`payroll.payout-plan.${schedule}`}
          label="План выплат"
          rows={rows}
          columns={columns}
          labels={labels}
          numeric={numeric}
          hiddenColumns={transfer ? ["forecast", "reserve", "day"] : []}
          searchText={(r) => `${r.name} ${r.role}`}
          onRow={(r) => setOpenRow(r)}
          actions={actions}
          emptyText="В этом графике нет сотрудников"
          totals={(visible) => ({
            amount: <Money value={visible.reduce((s, r) => s + r.amount, 0)} className="font-semibold" />,
            issued: <Money value={visible.reduce((s, r) => s + r.issued, 0)} />,
          })}
        />
      )}
      {!transfer && byDay.length > 0 && (
        <div className="rounded-lg border p-3 text-sm">
          <p className="mb-2 font-medium">По дням</p>
          <ul className="space-y-1">
            {byDay.map(([day, v]) => (
              <li key={day} className="flex justify-between gap-3 tabular-nums">
                <span>{formatDayMonth(day)} · {countRu(v.count, "сотрудник", "сотрудника", "сотрудников")}</span>
                <Money value={v.total} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {openRow && view && (
        <PayoutRowDrawer
          row={openRow}
          view={view}
          transfer={transfer}
          busy={busy}
          onClose={() => setOpenRow(null)}
          onSave={async (amount, day) => {
            if (!openRow.id) return;
            const ok = await run(async () => unwrapAction(await updatePayoutRow(openRow.id!, amount, day)), "Строка сохранена");
            if (ok) setOpenRow(null);
          }}
          onPaid={() => {
            setTransferRow(openRow);
            setOpenRow(null);
          }}
        />
      )}
      {transferRow && view && plan && (
        <PayoutTransferDialog
          row={transferRow}
          view={view}
          onClose={() => setTransferRow(null)}
          onDone={refresh}
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
  transfer,
  busy,
  onClose,
  onSave,
  onPaid,
}: {
  row: PayoutRowView;
  view: PayoutPlanView;
  transfer: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (amount: number, day: string | null) => Promise<void>;
  onPaid: () => void;
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
      status={rowStatus(row, transfer, view.today)}
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>Закрыть</Button>
          {transfer && editable && row.amount > row.issued && view.canIssue && plan?.state === "approved" && (
            <Button variant="outline" disabled={busy} onClick={onPaid}>Выплачено</Button>
          )}
          {editable && (
            <Button disabled={busy || !changed} onClick={() => void onSave(Math.round(parsed * 100) / 100, transfer ? null : day || null)}>
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
          {!transfer && line(
            "Прогноз до конца месяца",
            b.averageShift === null ? "—" : <Money value={b.forecast} />,
            b.averageShift === null ? "мало смен для прогноза" : `${countRu(b.forecastShifts, "смена", "смены", "смен")} × ${formatRub(b.averageShift)}`,
          )}
          {line("Запас", <Money value={-b.reserve} signed />)}
          {line("Половина месяца", <Money value={b.half} />)}
          {line("Уже выплачено за месяц", <Money value={-b.paid} signed />)}
          {b.official > 0 && line("Официальная часть", <Money value={-b.official} signed />, "выплатит бухгалтерия, в наличные не входит")}
          {line("Больше не выдаём", <Money value={Math.max(0, b.ceiling)} />, b.official > 0 ? "начислено минус выплаченное, запас и официальная часть" : "начислено минус выплаченное и запас")}
          {line("К выплате", <strong><Money value={row.amount} /></strong>, "вниз до шага округления")}
          {row.issued > 0 && line("Выдано", <Money value={row.issued} />)}
        </ul>
        {payoutRowState(row, view.today, transfer ? "transfer" : "cash") === "missed" && (
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
            {!transfer && (
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
            )}
          </div>
        )}
      </div>
    </PayrollDetailDialog>
  );
}
