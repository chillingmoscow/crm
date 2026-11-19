"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Users,
  Plus,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import tabStyle from "@/components/shared/workspace-tabs.module.css";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PayrollDetailDialog } from "@/app/(dashboard)/people/payroll/_components/payroll-detail-dialog";
import { PayrollPaymentForm } from "./payroll-payment-form";
import paymentStyle from "./payroll-payment-form.module.css";
import { paymentJournalRows } from "@/lib/payroll/payment-journal";
import { PayrollPaymentsTable } from "@/app/(dashboard)/people/payroll/_components/payroll-payments-table";
import {
  loadPayrollOverview,
  cancelPayrollPayment,
} from "@/app/(dashboard)/people/payroll/actions";
import { PayrollJournal, PayrollEntryForm, PayrollEntryMenuItems } from "./payroll-journal";
import { PayrollTransferDrawer } from "./payroll-transfer-drawer";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { PayrollLedger } from "./payroll-ledger";
import { RefreshFailedNotice, useAutoRefresh } from "./auto-refresh";
import { statementRows } from "@/lib/payroll/calculate";
import type { Accrual, PayrollData } from "@/lib/payroll/types";
import s from "./payroll-workspace.module.css";
import { PeriodStepper, periodTriggerClass } from "@/components/shared/period-stepper";
import { PageFrame } from "@/components/shared/page-frame";
import { recalculateInventoryDeduction } from "@/app/(dashboard)/inventory/_actions/deduction";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { TableFilterChip, TablePageHeader } from "@/components/shared/table";
import { Money, formatRub } from "@/components/shared/money";
import { formatAmount, toKopecks } from "@/lib/format/amount";
import { countRu } from "@/lib/format/plural";

type Row = ReturnType<typeof statementRows>[number];
const short = (n: number) =>
  n >= 1000 ? `${formatAmount(n / 1000, 0)} тыс.` : formatAmount(n, 0);
const shiftCount = (n: number) => countRu(n, "смена", "смены", "смен");
const staffCount = (n: number) =>
  countRu(n, "сотрудник", "сотрудника", "сотрудников");
const ROLE_BARS = 4;
const colors = [1, 0.72, 0.46, 0.28, 0.18].map(
  (alpha) => `hsl(var(--brand) / ${alpha})`,
);
const groupLabels: Record<string, string> = {
  base: "Ставки за смены",
  monthly: "Оклад",
  percent: "Процент от продаж",
  extra: "Дополнительные продажи",
  experience: "Надбавка за стаж",
  knowledge: "Надбавка за знания",
  food: "Питание",
  bonus: "Премии",
  allowance: "Надбавка за месяц",
  cleaner: "Премии",
};

function componentGroups(accruals: Accrual[]) {
  const groups = new Map<string, number>();
  for (const a of accruals)
    for (const c of a.components) {
      if (c.kind === "tips") continue;
      const label =
        (c.amount ?? 0) < 0
          ? "Удержания"
          : (groupLabels[c.kind] ??
            (c.label === "Выход" ? "Ставки за смены" : c.label));
      groups.set(label, (groups.get(label) ?? 0) + Number(c.amount ?? 0));
    }
  return [...groups].filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]);
}

function CompositionList({ groups }: { groups: [string, number][] }) {
  return (
    <div className={s.breakdown}>
      {groups.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>
            <Money value={value} />
          </strong>
        </div>
      ))}
    </div>
  );
}

export function PayrollWorkspace({
  data: initial,
  initialMonth,
}: {
  data: PayrollData;
  initialMonth: string;
}) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryKind, setEntryKind] = useState<"deduction" | "allowance">("deduction");
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferEmployee, setTransferEmployee] = useState<string | undefined>();
  const [cancelId, setCancelId] = useState<string | null>(null);
  const can = (action: string) =>
    data.permissions.includes(`payroll.${action}`);
  const reload = useCallback(async () => {
    const next = await loadPayrollOverview();
    if (next.venueId === initial.venueId) setData(next);
  }, [initial.venueId]);
  const autoRefresh = useAutoRefresh(reload, 15000);
  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await fn();
      await reload();
      toast.success(message);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Не удалось выполнить действие",
      );
    } finally {
      setBusy(false);
    }
  };
  const [month, setMonth] = useState(initialMonth);
  const [monthOpen, setMonthOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(
    Number(initialMonth.slice(0, 4)),
  );
  const [tab, setTab] = useState("statement");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("entry"))
      setTab("journal");
  }, []);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("transfer");
    const transfer = initial.transfers.find((t) => t.id === id);
    if (transfer) { setTransferEmployee(transfer.employee_id); setTransferOpen(true); }
  }, [initial.transfers]);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  // «Стоимость команды» показывает четыре крупнейшие должности; остальные
  // сворачиваются в строку «Ещё N», а не пропадают молча.
  const [allRoles, setAllRoles] = useState(false);
  const [selected, setSelected] = useState<Row | null>(null);
  const [day, setDay] = useState<Accrual | null>(null);
  const [employeeTab, setEmployeeTab] = useState("summary");
  const [composition, setComposition] = useState(false);
  const [hoverDay, setHoverDay] = useState<number | null>(null);
  const monthStart = `${month}-01`;
  const title = new Date(`${monthStart}T12:00:00Z`)
    .toLocaleDateString("ru-RU", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    })
    .replace(" г.", "");
  const current = useMemo(
    () => data.accruals.filter((a) => a.business_date.startsWith(month)),
    [data.accruals, month],
  );
  const rows = useMemo(
    () =>
      statementRows(
        data.employees,
        data.accruals,
        data.adjustments,
        data.payments,
        data.allocations,
        monthStart,
        data.transfers,
        data.settings?.starts_on,
      ),
    [data, monthStart],
  );
  const active = rows.filter(
    (r) => r.shifts || r.earned || r.paid || r.opening || r.transferredOut || r.tips,
  );
  const total = rows.reduce((sum, r) => sum + r.earned, 0);
  const paid = rows.reduce((sum, r) => sum + r.paid, 0);
  const tips = rows.reduce((sum, r) => sum + r.tips, 0);
  const shifts = rows.reduce((sum, r) => sum + r.shifts, 0);
  const historyPending = data.legacyPayments.some(
    (p) => p.month === monthStart && p.state === "review",
  );
  const knownBalance = !historyPending;
  const remaining = rows.reduce((sum, r) => sum + r.remaining, 0);
  const roles = [
    ...new Set(rows.map((r) => r.employee.role_name).filter(Boolean)),
  ].sort();
  const visible = rows.filter(
    (r) =>
      (r.shifts || r.earned || r.paid || r.opening || r.transferredOut || r.tips) &&
      (!role || r.employee.role_name === role) &&
      `${r.employee.name} ${r.employee.role_name}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const tableRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          (r.shifts || r.earned || r.paid || r.opening || r.transferredOut || r.tips) &&
          (!role || r.employee.role_name === role),
      ),
    [rows, role],
  );
  const perRole = [
    ...new Set(active.map((r) => r.employee.role_name || "Без должности")),
  ]
    .map((name) => ({
      name,
      value: active
        .filter((r) => (r.employee.role_name || "Без должности") === name)
        .reduce((sum, r) => sum + r.earned, 0),
    }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  const days = new Date(
    Number(month.slice(0, 4)),
    Number(month.slice(5, 7)),
    0,
  ).getDate();
  const daily = Array.from({ length: days }, (_, i) => ({
    day: i + 1,
    value: current
      .filter(
        (a) => a.business_date === `${month}-${String(i + 1).padStart(2, "0")}`,
      )
      .reduce((sum, a) => sum + Number(a.salary), 0),
  }));
  const dailyMax = Math.max(...daily.map((d) => d.value), 1);
  const selectedDays = selected
    ? current
        .filter((a) => a.employee_id === selected.employee.id)
        .sort((a, b) => b.business_date.localeCompare(a.business_date))
    : [];
  const payments = data.payments.filter((p) =>
    data.allocations.some(
      (a) => a.payment_id === p.id && a.month === monthStart,
    ),
  );
  const filteredPayments = payments.filter(
    (p) =>
      !role ||
      data.allocations.some(
        (a) =>
          a.payment_id === p.id &&
          a.month === monthStart &&
          data.employees.find((e) => e.id === a.employee_id)?.role_name ===
            role,
      ),
  );
  const peakDay = daily.reduce(
    (best, d, i) => (d.value > daily[best].value ? i : best),
    0,
  );
  const selectedPoint = daily[hoverDay ?? peakDay];
  // График — одна остановка фокуса (role="slider"): день выбирают стрелками,
  // а пальцем или мышью — по всей площади графика, ближайший к точке день.
  const chartDayLabel = (day: number) =>
    new Date(`${month}-${String(day).padStart(2, "0")}T12:00:00Z`).toLocaleDateString(
      "ru-RU",
      { day: "numeric", month: "long", timeZone: "UTC" },
    );
  const chartDayAt = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width ? (event.clientX - rect.left) / rect.width : 0;
    return Math.min(days - 1, Math.max(0, Math.round(ratio * (days - 1))));
  };
  const chartKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const from = hoverDay ?? peakDay;
    const step: Record<string, number> = {
      ArrowRight: 1,
      ArrowUp: 1,
      ArrowLeft: -1,
      ArrowDown: -1,
      PageUp: 7,
      PageDown: -7,
    };
    let next: number | null = null;
    if (event.key in step) next = from + step[event.key];
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = days - 1;
    else if (event.key === "Escape" && hoverDay !== null) {
      event.preventDefault();
      setHoverDay(null);
      return;
    }
    if (next === null) return;
    event.preventDefault();
    setHoverDay(Math.min(days - 1, Math.max(0, next)));
  };
  const groups = componentGroups(selected ? selectedDays : current);

  const roleFilters = {
    active: Boolean(role),
    onReset: () => setRole(""),
    chips: (
      <TableFilterChip
        label="Должность"
        value={role}
        onChange={setRole}
        options={[
          { value: "", label: "Все должности" },
          ...roles.map((name) => ({ value: name, label: name })),
        ]}
      />
    ),
  };
  // Пересчёт удержания по недостаче за открытый месяц: нужен после правок табеля
  // и смен, которые автопересчёт не запускают. Право проверяет и сервер.
  const canRecalculateShortage = data.permissions.includes("inventory.post_deductions");
  const recalculateShortage = async () => {
    const label = new Date(`${monthStart}T12:00:00`).toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
    const id = toast.loading(`Пересчитываем недостачу за ${label}…`);
    try {
      const r = await recalculateInventoryDeduction({ venueId: data.venueId, month: monthStart });
      if (r.error) toast.error(r.error, { id });
      else toast.success(r.summary ?? "Недостача пересчитана", { id, duration: 8000 });
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось пересчитать недостачу", { id });
    }
  };
  const tableActions = tab === "statement" ? (
    (can("pay") || can("review") || canRecalculateShortage) && <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className={s.actionButton} disabled={busy}><Plus size={16} />Добавить<ChevronDown size={14} /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {can("pay") && <DropdownMenuItem onSelect={() => setPayOpen(true)}>Выплата</DropdownMenuItem>}
        {can("review") && <PayrollEntryMenuItems onSelect={(kind) => {setEntryKind(kind);setEntryOpen(true);}}/>}
        {can("review") && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => {
          setTransferEmployee(undefined); setTransferOpen(true);
        }}>Перенести остаток</DropdownMenuItem></>}
        {canRecalculateShortage && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => void recalculateShortage()}>
          Пересчитать недостачу за месяц
        </DropdownMenuItem></>}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : tab === "payments" && can("pay") ? (
    <Button className={s.actionButton} onClick={() => setPayOpen(true)} disabled={busy}>
      <Plus size={16} />Добавить выплату
    </Button>
  ) : null;
  const changeMonth = (value: string) => {
    setMonth(value);
    setHoverDay(null);
    const url = new URL(window.location.href);
    url.searchParams.set("month", value);
    window.history.replaceState(null, "", url);
  };
  const changeTab = (id: string) => {
    setTab(id);
    setQuery("");
  };
  const moveMonth = (direction: number) => {
    const date = new Date(`${monthStart}T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + direction);
    changeMonth(date.toISOString().slice(0, 7));
  };
  const exportRows = () => {
    const records = [
      [
        "Сотрудник",
        "Должность",
        "Смены",
        "Начислено",
        "Премии",
        "Удержания",
        "Перенос в этот месяц",
        "Перенесено далее",
        "Выплачено",
        "К выплате",
        "Чаевые",
      ],
      ...visible.map((r) => [
        r.employee.name,
        r.employee.role_name,
        r.shifts,
        r.earned,
        r.bonuses,
        r.deductions,
        r.opening,
        r.transferredOut,
        historyPending ? "" : r.paid,
        knownBalance ? r.remaining : "",
        r.tips,
      ]),
    ];
    const csv =
      "\uFEFF" +
      records
        .map((row) =>
          row
            .map((v) => {
              const cell =
                typeof v === "string" && /^[=+@\-\t\r]/.test(v)
                  ? `'${v}`
                  : String(v);
              return `"${cell.replaceAll('"', '""')}"`;
            })
            .join(";"),
        )
        .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `Зарплата-${month}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const exportPayments = () => {
    const records = [
      ["Дата", "Сотрудник", "Статья", "Сумма", "Статус"],
      ...paymentJournalRows(data, filteredPayments, monthStart, role)
        .filter((row) =>
          `${row.employee} ${row.kind} ${row.status}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
        .map((row) => [
          new Date(row.date).toLocaleDateString("ru-RU", {
            timeZone: data.timezone,
          }),
          row.employee,
          row.kind,
          row.amount,
          row.status,
        ]),
    ];
    const csv =
      "\uFEFF" +
      records
        .map((row) =>
          row
            .map((value) => {
              const text =
                typeof value === "string" && /^[=+@\-\t\r]/.test(value)
                  ? `'${value}`
                  : String(value);
              return `"${text.replaceAll('"', '""')}"`;
            })
            .join(";"),
        )
        .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `Выплаты-${month}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <TooltipProvider>
      <div className={`${s.app} ${s.embedded}`}>
        <Breadcrumbs items={[{ label: "Люди" }, { label: "Зарплата" }]} />
        <div className={s.main}>
          <PageFrame>
            <TablePageHeader
              className={s.pageHeader}
              title="Зарплата"
              period={
                <PeriodStepper
                  previous="Предыдущий месяц"
                  next="Следующий месяц"
                  onPrevious={() => moveMonth(-1)}
                  onNext={() => moveMonth(1)}
                >
                  <Popover
                    open={monthOpen}
                    onOpenChange={(open) => {
                      setMonthOpen(open);
                      if (open) setPickerYear(Number(month.slice(0, 4)));
                    }}
                  >
                    <PopoverTrigger asChild>
                      <button
                        className={periodTriggerClass}
                        aria-label="Месяц ведомости"
                      >
                        <CalendarDays size={15} />
                        <span>{title}</span>
                        <ChevronDown size={12} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className={s.monthPicker} align="start">
                      <div className={s.pickerHeading}>
                        <button
                          className="touch-target"
                          aria-label="Предыдущий год"
                          onClick={() => setPickerYear(pickerYear - 1)}
                        >
                          <ChevronLeft size={16} />
                        </button>
                        <strong>{pickerYear}</strong>
                        <button
                          className="touch-target"
                          aria-label="Следующий год"
                          onClick={() => setPickerYear(pickerYear + 1)}
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                      <div className={s.monthGrid}>
                        {Array.from({ length: 12 }, (_, i) => {
                          const value = `${pickerYear}-${String(i + 1).padStart(2, "0")}`;
                          return (
                            <button
                              key={i}
                              className={value === month ? s.selectedMonth : ""}
                              onClick={() => {
                                changeMonth(value);
                                setMonthOpen(false);
                              }}
                            >
                              {new Date(Date.UTC(pickerYear, i, 1))
                                .toLocaleDateString("ru-RU", {
                                  month: "short",
                                  timeZone: "UTC",
                                })
                                .replace(".", "")}
                            </button>
                          );
                        })}
                      </div>
                    </PopoverContent>
                  </Popover>
                </PeriodStepper>
              }
              actions={
                <div
                  id="payroll-workspace-controls"
                  className={s.functionalControls}
                />
              }
            />
            {autoRefresh.failed && (
              <RefreshFailedNotice className="mb-4" {...autoRefresh} />
            )}
            <section className={s.metrics} aria-label="Итоги за месяц">
              <button
                className={`${s.metric} ${s.mainMetric}`}
                onClick={() => {
                  setSelected(null);
                  setComposition(true);
                }}
              >
                <span className={s.metricLabel}>
                  Начислено команде <ArrowUpRight size={15} />
                </span>
                <strong>
                  <Money value={total} className={s.metricValue} />
                </strong>
                <small>
                  {staffCount(active.length)}{" "}
                  <i>·</i> {shiftCount(shifts)}
                </small>
              </button>
              <div className={s.metric}>
                <span className={s.metricLabel}>Выплачено</span>
                <strong>
                  <Money
                    value={historyPending ? null : paid}
                    className={s.metricValue}
                  />
                </strong>
                {/* Причина прочерка написана текстом: подсказку по наведению
                    не увидеть с клавиатуры и с телефона. */}
                {historyPending ? (
                  <small>Прежние выплаты ещё не сверены</small>
                ) : (
                  <small>
                    {countRu(payments.length, "операция", "операции", "операций")}{" "}
                    за месяц
                  </small>
                )}
              </div>
              <div className={s.metric}>
                <span className={s.metricLabel}>
                  {knownBalance && toKopecks(remaining) < 0 ? "Переплата" : "К выплате"}
                </span>
                <strong>
                  <Money
                    value={knownBalance ? Math.abs(toKopecks(remaining)) : null}
                    fraction="auto"
                    className={s.metricValue}
                  />
                </strong>
                {!knownBalance && (
                  <small>Появится после сверки прежних выплат</small>
                )}
              </div>
              <div className={s.metric}>
                <span className={s.metricLabel}>Чаевые</span>
                <strong>
                  <Money value={tips} className={s.metricValue} />
                </strong>
                <small>Отдельно от зарплаты</small>
              </div>
            </section>
            {/* Вкладки представления: общий Tabs + workspace-tabs. Панель одна
                на активную вкладку — как у Radix, неактивные не монтируются. */}
            <Tabs value={tab} onValueChange={changeTab} className={`${tabStyle.tabs} mt-6`}>
              <TabsList aria-label="Разделы зарплаты">
                <TabsTrigger value="statement">Ведомость · {active.length}</TabsTrigger>
                <TabsTrigger value="payments">Выплаты</TabsTrigger>
                <TabsTrigger value="journal">Начисления и удержания</TabsTrigger>
              </TabsList>
            <TabsContent value={tab} className="!mt-0">
            {tab === "statement" && (
              <section className={s.analytics}>
                <div className={s.timeline}>
                  <div className={s.sectionTitle}>
                    <div>
                      <h2>Динамика начислений</h2>
                      <p>Зарплата команды по дням</p>
                    </div>
                    <span className={s.legend}>
                      <i /> Начислено
                    </span>
                  </div>
                  <div className={s.chartHeading}>
                    <strong><Money value={selectedPoint.value} /></strong>
                    <span>
                      {String(selectedPoint.day).padStart(2, "0")}{" "}
                      {new Date(`${monthStart}T12:00:00Z`)
                        .toLocaleDateString("ru-RU", {
                          month: "long",
                          day: "numeric",
                          timeZone: "UTC",
                        })
                        .split(" ")
                        .slice(1)
                        .join(" ")}
                    </span>
                    <small>
                      {hoverDay === null
                        ? "Максимум за месяц"
                        : "За выбранный день"}
                    </small>
                  </div>
                  <div className={s.chart}>
                    <div className={s.chartLabels}>
                      {[1, 0.5, 0].map((v) => (
                        <span key={v}>{short(dailyMax * v)}</span>
                      ))}
                    </div>
                    <div
                      className={s.plot}
                      role="slider"
                      tabIndex={0}
                      aria-label="День на графике начислений"
                      aria-valuemin={1}
                      aria-valuemax={days}
                      aria-valuenow={selectedPoint.day}
                      aria-valuetext={`${chartDayLabel(selectedPoint.day)}: ${formatRub(selectedPoint.value)}`}
                      onFocus={() => setHoverDay((d) => d ?? peakDay)}
                      onKeyDown={chartKeyDown}
                      onPointerDown={(event) => {
                        // Палец ведут по графику: захват держит события,
                        // пока он не отпущен (вертикальный скролл не мешает —
                        // touch-action: pan-y).
                        if (event.pointerType !== "mouse") {
                          event.currentTarget.setPointerCapture(event.pointerId);
                        }
                        setHoverDay(chartDayAt(event));
                      }}
                      onPointerMove={(event) => {
                        if (
                          event.pointerType === "mouse" ||
                          event.currentTarget.hasPointerCapture(event.pointerId)
                        ) {
                          setHoverDay(chartDayAt(event));
                        }
                      }}
                      onPointerLeave={(event) => {
                        if (event.pointerType === "mouse") setHoverDay(null);
                      }}
                    >
                      <svg
                        viewBox="0 0 720 145"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        <defs>
                          <linearGradient
                            id="payroll-fill"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="0%"
                              stopColor="hsl(var(--brand))"
                              stopOpacity=".25"
                            />
                            <stop
                              offset="100%"
                              stopColor="hsl(var(--brand))"
                              stopOpacity=".01"
                            />
                          </linearGradient>
                        </defs>
                        {[10, 72, 135].map((y) => (
                          <line
                            key={y}
                            x1="0"
                            x2="720"
                            y1={y}
                            y2={y}
                            stroke="hsl(var(--border))"
                            strokeDasharray="3 5"
                          />
                        ))}
                        <path
                          d={`M 0 135 ${daily.map((d, i) => `L ${(i / (days - 1)) * 720} ${135 - (d.value / dailyMax) * 122}`).join(" ")} L 720 135 Z`}
                          fill="url(#payroll-fill)"
                        />
                        <polyline
                          points={daily
                            .map(
                              (d, i) =>
                                `${(i / (days - 1)) * 720},${135 - (d.value / dailyMax) * 122}`,
                            )
                            .join(" ")}
                          fill="none"
                          stroke="hsl(var(--brand))"
                          strokeWidth="2.3"
                          vectorEffect="non-scaling-stroke"
                          strokeLinejoin="round"
                        />
                        {hoverDay !== null && (
                          <>
                            <line
                              x1={(hoverDay / (days - 1)) * 720}
                              x2={(hoverDay / (days - 1)) * 720}
                              y1="0"
                              y2="145"
                              stroke="hsl(var(--brand) / .5)"
                              strokeDasharray="3 3"
                            />
                            <circle
                              cx={(hoverDay / (days - 1)) * 720}
                              cy={
                                135 - (daily[hoverDay].value / dailyMax) * 122
                              }
                              r="4"
                              fill="hsl(var(--brand))"
                              stroke="hsl(var(--card))"
                              strokeWidth="2"
                            />
                          </>
                        )}
                      </svg>
                    </div>
                  </div>
                  <div className={s.chartDates}>
                    <span>01</span>
                    <span>05</span>
                    <span>10</span>
                    <span>15</span>
                    <span>20</span>
                    <span>25</span>
                    <span>{days}</span>
                  </div>
                </div>
                <div className={s.distribution}>
                  <div className={s.sectionTitle}>
                    <div>
                      <h2>Стоимость команды</h2>
                      <p>Начисления по должностям</p>
                    </div>
                    <Users size={17} />
                  </div>
                  <div className={s.roleBars}>
                    {(allRoles || perRole.length <= ROLE_BARS ? perRole : perRole.slice(0, ROLE_BARS)).map((r, i) => (
                      <button
                        key={r.name}
                        type="button"
                        aria-pressed={role === r.name}
                        onClick={() => {
                          setRole(role === r.name ? "" : r.name);
                        }}
                        className={role === r.name ? s.selectedRole : ""}
                      >
                        <div>
                          <span>
                            <i style={{ background: colors[Math.min(i, colors.length - 1)] }} />
                            {r.name}
                          </span>
                          <strong><Money value={r.value} /></strong>
                        </div>
                        <div className={s.barTrack}>
                          <span
                            style={{
                              width: `${total ? (r.value / total) * 100 : 0}%`,
                              background: colors[Math.min(i, colors.length - 1)],
                            }}
                          />
                        </div>
                      </button>
                    ))}
                    {perRole.length > ROLE_BARS && (
                      <button
                        type="button"
                        className={s.moreRoles}
                        aria-expanded={allRoles}
                        onClick={() => setAllRoles((v) => !v)}
                      >
                        <span>
                          {allRoles
                            ? "Свернуть"
                            : `Ещё ${countRu(perRole.length - ROLE_BARS, "должность", "должности", "должностей")}`}
                        </span>
                        {!allRoles && (
                          <strong>
                            <Money value={perRole.slice(ROLE_BARS).reduce((sum, r) => sum + r.value, 0)} />
                          </strong>
                        )}
                      </button>
                    )}
                  </div>
                  <div className={s.average}>
                    <span>
                      В среднем за смену<small>Без сотрудников на окладе</small>
                    </span>
                    <strong>
                      <Money
                        value={
                          shifts
                            ? current
                                .filter(
                                  (a) =>
                                    a.calculation_snapshot.kind !== "monthly",
                                )
                                .reduce((sum, a) => sum + Number(a.salary), 0) /
                              shifts
                            : 0
                        }
                      />
                    </strong>
                  </div>
                </div>
              </section>
            )}
            <section className={`${s.ledger} ${s.functionalTable}`}>
              {role && (
                <div className={s.ledgerHeading}>
                  <button
                    className={s.appliedFilter}
                    onClick={() => setRole("")}
                  >
                    {role} ×
                  </button>
                </div>
              )}
              {tab === "journal" ? (
                <PayrollJournal
                  data={data}
                  month={monthStart}
                  query={query}
                  onQuery={setQuery}
                  onChange={reload}
                />
              ) : tab === "payments" ? (
                <PayrollPaymentsTable
                  data={data}
                  payments={filteredPayments}
                  financeMonth={monthStart}
                  financeRole={role}
                  busy={busy}
                  actions={tableActions}
                  toolbarTargetId="payroll-workspace-controls"
                  exportAction={{
                    label: "Экспорт выплат",
                    onClick: exportPayments,
                  }}
                  // Ключ сохранённых настроек столбцов: остался от прежнего названия
                  // экрана, менять нельзя — у всех сбросятся порядок и ширина столбцов.
                  tableId={`payroll.concept.payments.${data.venueId}`}
                  externalSearch={{ value: query, onChange: setQuery }}
                  filters={roleFilters}
                  onCancel={async (id) => {
                    setCancelId(id);
                  }}
                />
              ) : (
                <PayrollLedger
                  data={data}
                  month={monthStart}
                  rows={tableRows}
                  query={query}
                  onQuery={setQuery}
                  onExport={exportRows}
                  onEmployee={(row) => {
                    setSelected(row);
                    setDay(null);
                    setEmployeeTab("summary");
                  }}
                  actions={tableActions}
                  filters={roleFilters}
                />
              )}
            </section>
            </TabsContent>
            </Tabs>
          </PageFrame>
        </div>
        <PayrollEntryForm initialKind={entryKind} open={entryOpen} onOpenChange={setEntryOpen} data={data} month={monthStart}
          onCreated={async () => { await reload(); changeTab("journal"); }} />
        {transferOpen && <PayrollTransferDrawer data={data} month={monthStart} employeeId={transferEmployee}
          onClose={() => setTransferOpen(false)} onChange={reload} />}
        <Dialog
          open={Boolean(selected) || composition}
          onOpenChange={(open) => {
            if (!open) {
              setSelected(null);
              setComposition(false);
              setDay(null);
            }
          }}
        >
          <DialogContent
            className={s.dialog}
            tabIndex={-1}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              requestAnimationFrame(() => {
                const dialog = document.querySelector<HTMLElement>(
                  '[role="dialog"][data-state="open"]',
                );
                dialog?.focus({ preventScroll: true });
              });
            }}
          >
            <DialogTitle className={s.dialogTitle}>
              {selected ? selected.employee.name : "Состав начислений"}
            </DialogTitle>
            <DialogDescription className={s.dialogDescription}>
              {selected
                ? `${selected.employee.role_name} · ${title}`
                : `Команда заведения · ${title}`}
            </DialogDescription>
            <div className={s.dialogBody}>
              <div className={s.employeeTotal}>
                <span>Начислено за месяц</span>
                <strong><Money value={selected ? selected.earned : total} /></strong>
                <small>
                  {selected
                    ? `${shiftCount(selected.shifts)} · чаевые ${formatRub(selected.tips)} отдельно`
                    : `${staffCount(active.length)} · ${shiftCount(shifts)}`}
                </small>
              </div>
              {selected ? (
                <Tabs
                  value={employeeTab}
                  onValueChange={(value) => {
                    setEmployeeTab(value);
                    setDay(null);
                  }}
                  className={`${tabStyle.tabs} mt-6`}
                >
                  <TabsList aria-label="Расчёт сотрудника">
                    <TabsTrigger value="summary">Состав зарплаты</TabsTrigger>
                    <TabsTrigger value="shifts">
                      Смены · {selectedDays.length}
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="summary" className="!mt-0">
                    <CompositionList groups={groups} />
                  </TabsContent>
                  <TabsContent value="shifts" className="!mt-0">
                    {day ? (
                      <div className={s.shiftInspector}>
                        <button
                          className={s.shiftBack}
                          onClick={() => setDay(null)}
                        >
                          <ArrowLeft size={13} /> Все смены
                        </button>
                        <div className={s.shiftHeading}>
                          <span>
                            {day.calculation_snapshot.kind === "monthly"
                              ? "Оклад за месяц"
                              : new Date(
                                  `${day.business_date}T12:00:00Z`,
                                ).toLocaleDateString("ru-RU", {
                                  day: "numeric",
                                  month: "long",
                                  timeZone: "UTC",
                                })}
                          </span>
                          <strong>
                            <Money value={Number(day.salary)} />
                          </strong>
                        </div>
                        <div className={s.dayDetail}>
                          {day.components.map((c, i) => (
                            <div key={i}>
                              <span>
                                {c.label === "Выход" ? "Ставка за смену" : c.label}
                                <small>{c.basis}</small>
                              </span>
                              <strong>
                                {c.amount === null
                                  ? "Нет данных"
                                  : <Money value={Number(c.amount)} />}
                              </strong>
                            </div>
                          ))}
                        </div>
                        {day.issues.length > 0 && (
                          <details className={s.issueDetails}>
                            <summary>
                              Замечания к расчёту · {day.issues.length}
                            </summary>
                            {day.issues.map((issue) => (
                              <p key={issue}>{issue}</p>
                            ))}
                          </details>
                        )}
                      </div>
                    ) : (
                      <div className={s.dayList}>
                        {selectedDays.map((a) => (
                          <div key={a.id}>
                            <button onClick={() => setDay(a)}>
                              <span>
                                {a.calculation_snapshot.kind === "monthly"
                                  ? "Оклад за месяц"
                                  : new Date(
                                      `${a.business_date}T12:00:00Z`,
                                    ).toLocaleDateString("ru-RU", {
                                      day: "numeric",
                                      month: "long",
                                      timeZone: "UTC",
                                    })}
                              </span>
                              <strong>
                                <Money value={Number(a.salary)} />
                              </strong>
                              <ChevronRight size={15} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              ) : (
                <CompositionList groups={groups} />
              )}
              {selected && (
                <Link
                  className={s.fullDetailLink}
                  href={`/people/payroll/${selected.employee.id}?month=${month}`}
                >
                  Полная карточка сотрудника <ArrowUpRight size={15} />
                </Link>
              )}
            </div>
          </DialogContent>
        </Dialog>
        <ConfirmDialog
          open={Boolean(cancelId)}
          onOpenChange={(open) => {
            if (!open) setCancelId(null);
          }}
          title="Удалить выплату?"
          description="Финансовая операция будет помечена удалённой, а сумма вернётся в «К выплате». История сохранится."
          confirmLabel="Удалить выплату"
          pendingLabel="Удаляем…"
          destructive
          busy={busy}
          onConfirm={() => {
            if (cancelId)
              void run(async () => {
                await cancelPayrollPayment(cancelId);
                setCancelId(null);
              }, "Выплата удалена");
          }}
        />
        <PayrollDetailDialog
          open={payOpen}
          onOpenChange={setPayOpen}
          title="Добавить выплату"
          description="Запись выданной зарплаты"
          footer={
            <div
              id="payroll-payment-footer"
              className={paymentStyle.footerSlot}
            />
          }
        >
          <PayrollPaymentForm onCancel={() => setPayOpen(false)}
            data={data}
            month={monthStart}
            onDone={async () => {
              setPayOpen(false);
              await reload();
            }}
          />
        </PayrollDetailDialog>
      </div>
    </TooltipProvider>
  );
}
