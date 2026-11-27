"use client";

import { useExitValue } from "@/hooks/use-exit-value";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "@/components/ui/option-select";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money, formatRub } from "@/components/shared/money";
import { unwrapAction } from "@/lib/actions/result";
import { formatDayMonth } from "@/lib/format/date";
import { countRu } from "@/lib/format/plural";
import { signedAmountClass } from "@/lib/format/amount";
import { addDays } from "@/lib/sales/time";
import { payDayChoices, payoutRowState, type PayoutRowState, type PayoutScheduleCode } from "@/lib/payroll/payout-plan";
import { Banknote, CalendarClock, Check, ListChecks, Loader2, MoreHorizontal, RefreshCw, X, Ban } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
import { PayoutBreakdown } from "./payout-breakdown";
import { selectClass } from "./select-class";
import formStyle from "./payroll-payment-form.module.css";

const labels = {
  employee: "Сотрудник",
  // Перенос с прошлого месяца: переплата уменьшает выплату, долг — увеличивает (Павел, 26.11).
  carried: "Перенос",
  earned: "Начислено",
  forecast: "Прогноз",
  reserve: "Запас",
  official: "Официальная часть",
  paid: "Выплачено",
  amount: "К выплате",
  left: "Останется",
  status: "Статус",
};
// На виду — только то, по чему решают: сколько начислено, сколько выдаём и
// сколько останемся должны (или переплатим). Остальное — в «Столбцах» и в
// панели строки «Как посчитано» (Павел, 26.11).
const hiddenColumns = ["carried", "forecast", "reserve", "official", "paid"];
const numeric = ["carried", "earned", "forecast", "reserve", "official", "paid", "amount", "left"];
const FLAG_TEXT: Record<string, string> = {
  few_shifts: "Мало смен для прогноза",
  no_shift: "Нет смены в окне выплаты: выберите день сами",
  unmoved_balance: "Остаток прошлого месяца не перенесён",
};
const monthTitle = (month: string) => {
  const name = new Date(`${month}T12:00:00Z`).toLocaleDateString("ru-RU", { month: "long", timeZone: "UTC" });
  return name.charAt(0).toUpperCase() + name.slice(1);
};

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

/**
 * План последнего захода в «Зарплату» по заведению: вкладка открывается сразу
 * с ним и тихо обновляется в фоне — без «Загружаем…» на каждом заходе.
 */
const planCache = new Map<string, PayoutPlanView>();
export function cachedPayoutPlan(venueId: string) {
  return planCache.get(venueId) ?? null;
}
export async function prefetchPayoutPlan(venueId: string) {
  const r = await loadPayoutPlan("main");
  if (r.ok) planCache.set(venueId, r.data);
  return r.ok ? r.data : null;
}

export function PayoutPlan({
  venueId,
  view,
  onView,
  onChanged,
}: {
  venueId: string;
  view: PayoutPlanView | null;
  onView: (view: PayoutPlanView) => void;
  onChanged: () => Promise<void>;
}) {
  // План — для наличных. Сотрудники на графике «Переводом» в план не входят:
  // им платят по их счетам, выплаты вносят вручную (Павел, 25.11).
  const schedule: PayoutScheduleCode = "main";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [openRow, setOpenRow] = useState<PayoutRowView | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  // Панели держим смонтированными, пока они уезжают (docs/motion.md).
  const shownRow = useExitValue(openRow);
  const shownIssue = useExitValue(issueOpen);
  const [cancelOpen, setCancelOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = unwrapAction(await loadPayoutPlan(schedule));
      planCache.set(venueId, next);
      onView(next);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить план выплат");
    }
  }, [schedule, venueId, onView]);
  // При открытии — то, что уже есть, и тихое обновление в фоне.
  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    await load();
    try { await onChanged(); } catch { /* Ведомость обновится при следующем автообновлении. */ }
  };
  /** Действие плана отдаёт обновлённый план сразу — без повторной загрузки. */
  const [pending, setPending] = useState<string | null>(null);
  const run = async (action: () => Promise<PayoutPlanView>, success: string, label = "") => {
    setBusy(true);
    setPending(label);
    try {
      const next = await action();
      planCache.set(venueId, next);
      onView(next);
      toast.success(success);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось выполнить действие");
      return false;
    } finally {
      setBusy(false);
      setPending(null);
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
          : id === "carried" ? row.breakdown.carried
          : id === "earned" ? row.breakdown.earned
          : id === "forecast" ? row.breakdown.forecast
          : id === "reserve" ? row.breakdown.reserve
          : id === "paid" ? row.paidNow
          : id === "official" ? row.breakdown.official
          : id === "amount" ? row.amount
          : id === "left" ? (row.leftAfter ?? 0)
          : (row.outside ? "~" : row.pay_date ?? ""),
        cell: ({ row }) => {
          const r = row.original;
          if (id === "employee")
            return (
              // Имя ведёт в расчёт сотрудника за месяц плана; остальная строка открывает расшифровку.
              <PayrollEmployeeCell
                name={r.name}
                role={r.role}
                avatarUrl={r.avatarUrl}
                href={`/people/payroll/${r.employee_id}${plan || view?.window ? `?month=${(plan?.month ?? view?.window?.month ?? "").slice(0, 7)}` : ""}`}
              />
            );
          if (r.outside && id !== "status" && id !== "earned" && id !== "paid" && id !== "official" && id !== "carried")
            return <span className="text-muted-foreground">—</span>;
          if (id === "status") return rowStatus(r, today);
          if (id === "forecast")
            return r.breakdown.averageShift == null
              ? <span className="text-muted-foreground">—</span>
              : <span data-tip={`${countRu(r.breakdown.forecastShifts, "смена", "смены", "смен")} × ${formatRub(r.breakdown.averageShift)}`}><Money value={r.breakdown.forecast} /></span>;
          if (id === "carried")
            return r.breakdown.carried ? (
              <span data-tip={r.breakdown.carried < 0 ? "Переплата прошлого месяца: уменьшает выплату" : "Долг с прошлого месяца: добавляется к выплате"}>
                <Money value={r.breakdown.carried} signed />
              </span>
            ) : <span className="text-muted-foreground">—</span>;
          if (id === "official")
            return r.breakdown.official ? (
              <span data-tip={r.breakdown.officialAgency ? "Получит через агентство" : "Выплатит бухгалтерия; идёт в счёт первой половины месяца"}>
                <Money value={-r.breakdown.official} signed />
              </span>
            ) : <span className="text-muted-foreground">—</span>;
          if (id === "amount") {
            // Подпись — только когда выдача правда будет меньше плана: после
            // формирования появились выплаты или штрафы и срезали потолок.
            const cut = r.willIssue !== null && plan && Math.round(r.willIssue) < Math.round(r.amount);
            return (
              <span className="inline-flex flex-col items-end">
                <Money value={r.amount} className="font-semibold" />
                {cut && (
                  <small
                    className="text-xs text-amber-700 dark:text-amber-400"
                    data-tip={`Выдадим ${formatRub(r.willIssue!)}`}
                    data-tip-sub="После формирования плана появились выплаты или штрафы — больше начисленного не выдаём"
                  >
                    выдадим {formatRub(r.willIssue!)}
                  </small>
                )}
              </span>
            );
          }
          if (id === "left")
            return r.leftAfter === null ? <span className="text-muted-foreground">—</span> : (
              <span
                data-tip={r.leftAfter < 0 ? "Переплатим за месяц после этой выплаты" : "Будем должны за месяц после этой выплаты"}
                data-tip-sub={r.breakdown.official > 0 ? (r.breakdown.officialAgency ? "С учётом суммы, которую сотрудник получит через агентство" : "С учётом официальной части, которую выплатит бухгалтерия") : undefined}
              >
                <Money value={r.leftAfter} className={r.leftAfter < 0 ? signedAmountClass(r.leftAfter) : undefined} />
              </span>
            );
          const value = id === "earned" ? r.breakdown.earned : id === "reserve" ? r.breakdown.reserve : r.paidNow;
          return <Money value={value} />;
        },
      })),
    [plan, today, view],
  );


  const canPay = view?.canPay ?? false;
  // Кнопки — по правилу дизайн-системы: одна главная (brand, с иконкой) по
  // состоянию плана, остальное — в меню «⋯». Высота 36px, как в шапке.
  const form = () => run(async () => unwrapAction(await savePayoutPlan(schedule)), "План сформирован", "form");
  const recalc = () => run(async () => unwrapAction(await savePayoutPlan(schedule)), "План пересчитан", "recalc");
  const approve = () => run(async () => unwrapAction(await setPayoutPlanState(plan!.id, "approved")), "План утверждён", "approve");
  const secondary = plan && plan.state !== "cancelled";
  // Одно вторичное действие — кнопкой рядом, а не меню «⋯» ради одного пункта
  // (Павел, 26.11): у утверждённого плана остаётся только «Отменить план».
  const recalcable = plan?.state === "draft";
  const cancelButton = secondary && !recalcable && (
    <Button size="sm" variant="outline" disabled={busy} onClick={() => setCancelOpen(true)}>
      <X className="size-4" />
      Отменить план
    </Button>
  );
  const actions = view && canPay ? (
    <>
      {cancelButton}
      {!plan && view.window && (
        <Button size="sm" disabled={busy} onClick={() => void form()}>
          {pending === "form" ? <Loader2 className="size-4 animate-spin" /> : <ListChecks className="size-4" />}
          {pending === "form" ? "Формируем…" : "Сформировать план"}
        </Button>
      )}
      {plan?.state === "draft" && (
        <Button size="sm" disabled={busy} onClick={() => void approve()}>
          {pending === "approve" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          {pending === "approve" ? "Утверждаем…" : "Утвердить"}
        </Button>
      )}
      {dueToday && view.canIssue && (
        <Button size="sm" disabled={busy} onClick={() => setIssueOpen(true)}>
          <Banknote className="size-4" />
          Выдать сейчас
        </Button>
      )}
      {secondary && recalcable && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="w-9 px-0" disabled={busy} aria-label="Ещё действия с планом" data-tip="Ещё">
              {pending === "recalc" ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={() => void recalc()}>
              <RefreshCw className="size-4" />
              Пересчитать по свежим данным
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setCancelOpen(true)}>
              <X className="size-4" />
              Отменить план
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  ) : null;



  return (
    <div className="mt-4 space-y-4">
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
      {!view && !error && (
        <div className="space-y-2" aria-label="Загрузка плана выплат">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      )}
      {view && !view.window && !plan && (
        <EmptyState
          icon={CalendarClock}
          title="Плана выплаты пока нет"
          description="План выплаты появится, когда наступит её период."
        />
      )}
      {view && (view.window || plan) && (
        <PayrollTable
          // v2: новый набор столбцов по умолчанию — прежняя сохранённая видимость его бы перебила.
          id={`payroll.payout-plan.${schedule}.v2`}
          hiddenColumns={hiddenColumns}
          label="План выплат"
          rows={rows}
          columns={columns}
          labels={labels}
          numeric={numeric}
          searchText={(r) => `${r.name} ${r.role}`}
          onRow={(r) => { if (!r.outside) setOpenRow(r); }}
          actions={actions}
          // Кнопки — в шапке страницы, как у «Ведомости» и «Выплат».
          toolbarTargetId="payroll-workspace-controls"
          emptyText="В этом графике нет сотрудников"
          totals={(visible) => ({
            amount: <Money value={visible.reduce((s, r) => s + r.amount, 0)} className="font-semibold" />,
            paid: <Money value={visible.reduce((s, r) => s + r.paidNow, 0)} />,
            left: <Money value={visible.reduce((s, r) => s + (r.leftAfter ?? 0), 0)} />,
          })}
        />
      )}

      {shownRow && view && (
        <PayoutRowDrawer
          key={shownRow.id ?? shownRow.employee_id}
          open={!!openRow}
          row={shownRow}
          view={view}
          busy={busy}
          onClose={() => setOpenRow(null)}
          onSave={async (amount, day) => {
            if (!shownRow.id) return;
            const ok = await run(async () => unwrapAction(await updatePayoutRow(shownRow.id!, amount, day)), "Строка сохранена");
            if (ok) setOpenRow(null);
          }}
        />
      )}
      {shownIssue && plan && (
        <PayoutIssueDialog open={issueOpen} planId={plan.id} onClose={() => setIssueOpen(false)} onDone={refresh} />
      )}
      <ConfirmDialog
        icon={Ban}
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Отменить план выплат?"
        consequences={[
          { kind: "keep", text: "Уже проведённые выплаты останутся" },
          { kind: "info", text: "Новый план можно будет сформировать заново" },
        ]}
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
  open = true,
  row,
  view,
  busy,
  onClose,
  onSave,
}: {
  /** Открыта ли панель. Её держат смонтированной, пока она уезжает (docs/motion.md). */
  open?: boolean;
  row: PayoutRowView;
  view: PayoutPlanView;
  busy: boolean;
  onClose: () => void;
  onSave: (amount: number, day: string | null) => Promise<void>;
}) {
  // Ноль — подсказкой в пустом поле: нажал и вводишь сумму, без стирания «0» (Павел, 26.11).
  const [amount, setAmount] = useState(row.amount ? String(row.amount) : "");
  const [day, setDay] = useState(row.pay_date ?? "");
  const b = row.breakdown;
  const plan = view.plan;
  const editable = !!row.id && !!plan && plan.state !== "cancelled" && row.state !== "issued" && view.canPay;
  const days: string[] = [];
  // Дни — по графику сотрудника (основной 25–1 / 10–16, клинер с 20-го / с 5-го).
  const span = row.dayWindow ?? view.window;
  if (span) for (let d = span.from; d <= span.to; d = addDays(d, 1)) days.push(d);
  const parsed = Number(amount.replace(",", ".").replace(/\s/g, ""));
  const valid = Number.isFinite(parsed) && parsed >= 0;
  const changed = valid && (parsed !== row.amount || (day || null) !== row.pay_date);
  return (
    <PayrollDetailDialog
      open={open}
      onOpenChange={(open) => { if (!open && !busy) onClose(); }}
      title="Строка плана"
      description={`${monthTitle(plan?.month ?? view.window?.month ?? "")}, ${view.payoutNo === 2 ? "вторая" : "первая"} выплата`}
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
        {/* Сначала — что требует решения, потом правка, потом расшифровка (Павел, 26.11). */}
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
        {row.manual && row.ceilingNow !== null && row.amount - row.issued > Math.max(0, row.ceilingNow) + 0.5 && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            Сумма поставлена вручную и больше расчёта на {formatRub(row.amount - row.issued - Math.max(0, row.ceilingNow))}: выдадим её, но с учётом запаса{row.breakdown.official > 0 ? " и официальной части" : ""} это уйдёт в переплату.
          </p>
        )}
        {plan && row.willIssue !== null && Math.round(row.willIssue) < Math.round(row.amount) && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            Выдадим {formatRub(row.willIssue)}: после формирования плана появились выплаты или штрафы, а больше начисленного не выдаём.
          </p>
        )}
        {editable && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="payout-row-amount">К выплате, ₽</Label>
              <Input id="payout-row-amount" inputMode="decimal" placeholder="0" value={amount} disabled={busy} onChange={(e) => setAmount(e.target.value)} />
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
                // Дни со сменой в графике — первыми: выдают на смене (Павел, 26.11).
                options={[{ value: "", label: "Не выбран" }]}
                groups={payDayChoices(days, row.shiftDays, view.today, row.pay_date, !view.shiftsHidden).map((g) => ({
                  label: g.label,
                  options: g.days.map((d) => ({ value: d.date, label: formatDayMonth(d.date) ?? d.date, disabled: d.past })),
                }))}
              />
            </div>
          </div>
        )}
        <section aria-label="Как посчитано" className="space-y-4 border-t pt-5">
          <h3 className="text-base font-semibold">Как посчитано</h3>
          <PayoutBreakdown b={b} amount={row.amount} issued={row.issued} manual={row.manual} leftAfter={row.leftAfter} step={row.step} month={plan?.month ?? view.window?.month ?? null} />
        </section>
      </div>
    </PayrollDetailDialog>
  );
}
