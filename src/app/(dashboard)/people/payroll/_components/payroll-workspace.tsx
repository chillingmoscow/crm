"use client";

import { useExitValue } from "@/hooks/use-exit-value";
import { AttendanceAttentionNotice } from "./attendance-attention";
import type { AttentionSnapshot } from "@/lib/payroll/attention-snapshot";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRightLeft,
  ArrowUpRight,
  Banknote,
  CalendarX2,
  CircleMinus,
  CirclePlus,
  Download,
  Gift,
  Users,
  Plus,
  CalendarDays,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
  loadStatementExportData,
  cancelPayrollPayment,
} from "@/app/(dashboard)/people/payroll/actions";
import { unwrapAction } from "@/lib/actions/result";
import { PayrollJournal, PayrollEntryForm, PayrollEntryMenuItems } from "./payroll-journal";
import { PayrollTransferDrawer, transferCandidates } from "./payroll-transfer-drawer";
import { downloadPayslip } from "./payslip-download";
import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { PayoutPlan, cachedPayoutPlan, prefetchPayoutPlan } from "./payout-plan";
import { KpiTab } from "./kpi-tab";
import type { PayoutPlanView } from "../payout-actions";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { PayrollLedger } from "./payroll-ledger";
import { RefreshFailedNotice, useAutoRefresh } from "./auto-refresh";
import { statementRows } from "@/lib/payroll/calculate";
import type { Accrual, PayrollData } from "@/lib/payroll/types";
import s from "./payroll-workspace.module.css";
import { PeriodStepper } from "@/components/shared/period-stepper";
import { MonthPicker } from "@/components/shared/month-picker";
import { PageFrame } from "@/components/shared/page-frame";
import { recalculateInventoryDeduction } from "@/app/(dashboard)/inventory/_actions/deduction";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { Metric, MetricStrip } from "@/components/shared/metric-strip";
import { EmptyState } from "@/components/ui/empty-state";
import { TableFilterChip, TablePageHeader } from "@/components/shared/table";
import { Money, formatRub } from "@/components/shared/money";
import { AnimatedMoney } from "@/components/shared/animated-money";
import { ExpandPanel, OverviewToggle, TabsRow, useOverviewOpen } from "@/components/shared/overview-toggle";
import { OVERVIEW_KEYS } from "@/lib/ui/overview-pref";
import { formatAmount, toKopecks } from "@/lib/format/amount";
import { countRu } from "@/lib/format/plural";
import { downloadBlob, xlsxBlob, type XlsxSheet } from "@/lib/export/xlsx";

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
  venueName = null,
  initialOverviewOpen,
  initialAttention,
}: {
  data: PayrollData;
  initialMonth: string;
  /** Выбор «Обзора» из cookie — сервер рисует его сразу в нужном состоянии. */
  initialOverviewOpen?: boolean;
  /** «Ждут проверки» за месяц — сервером, чтобы уведомление не сдвигало страницу. */
  initialAttention?: AttentionSnapshot;
  /** Для шапки выгрузки ведомости. */
  venueName?: string | null;
}) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryKind, setEntryKind] = useState<"deduction" | "allowance" | "bonus">("deduction");
  const [transferOpen, setTransferOpen] = useState(false);
  // Сотрудник, для которого форму открыли из меню строки ведомости;
  // из кнопки «Добавить» — никто, выбирают в самой форме.
  const [payFor, setPayFor] = useState<string | undefined>();
  const [entryFor, setEntryFor] = useState<string | undefined>();
  const [transferFor, setTransferFor] = useState<string | undefined>();
  // Панель держим смонтированной, пока она уезжает (docs/motion.md).
  const shownTransfer = useExitValue(transferOpen);
  const router = useRouter();
  const [cancelId, setCancelId] = useState<string | null>(null);
  const can = (action: string) =>
    data.permissions.includes(`payroll.${action}`);
  // Данные грузятся по одному месяцу (начисления и журнал — только за него).
  // month — месяц загруженных данных, shownMonth — выбранный в переключателе:
  // пока новый месяц грузится, видны прежние цифры, приглушённые.
  const [month, setMonth] = useState(initialMonth);
  const [shownMonth, setShownMonth] = useState(initialMonth);
  const wantedMonth = useRef(initialMonth);
  // Уже показанные месяцы открываются сразу из памяти и тихо обновляются.
  const monthCache = useRef(new Map<string, PayrollData>([[initialMonth, initial]]));
  const reload = useCallback(async () => {
    const wanted = wantedMonth.current;
    const next = unwrapAction(await loadPayrollOverview(wanted));
    if (next.venueId !== initial.venueId) return;
    monthCache.current.set(wanted, next);
    // Ответ за месяц, с которого уже ушли, не показываем.
    if (wantedMonth.current !== wanted) return;
    setData(next);
    setMonth(wanted);
  }, [initial.venueId]);
  const autoRefresh = useAutoRefresh(reload, 15000);
  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await fn();
      // Действие могло задеть и другие месяцы (перенос, выплата за прошлый).
      monthCache.current.clear();
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
  const [tab, setTab] = useState("statement");
  // «Обзор» (график и стоимость команды) по умолчанию открыт; если его закрыть,
  // это запоминается в браузере.
  const [overviewOpen, setOverviewOpen] = useOverviewOpen(OVERVIEW_KEYS.payroll, initialOverviewOpen);
  // План выплат грузится заранее, пока смотрят ведомость: вкладка открывается сразу.
  const [planView, setPlanView] = useState<PayoutPlanView | null>(() => cachedPayoutPlan(initial.venueId));
  useEffect(() => {
    if (!initial.permissions.includes("payroll.view")) return;
    let alive = true;
    void prefetchPayoutPlan(initial.venueId).then((v) => { if (alive && v) setPlanView(v); });
    return () => { alive = false; };
  }, [initial.venueId, initial.permissions]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("entry")) setTab("journal");
    // Ссылка из уведомления о черновике плана выплат.
    else if (params.get("tab") === "plan") setTab("plan");
    // Ссылка из карточки «KPI не подведены» в «На разбор».
    else if (params.get("tab") === "kpi") setTab("kpi");
  }, []);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("transfer");
    const transfer = initial.transfers.find((t) => t.id === id);
    // Ссылка из журнала событий: перенос виден и отменяется в расчёте сотрудника.
    if (transfer)
      router.replace(`/people/payroll/${transfer.employee_id}?month=${transfer.from_month.slice(0, 7)}`);
  }, [initial.transfers, router]);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  // «Стоимость команды» показывает четыре крупнейшие должности; остальные
  // сворачиваются в строку «Ещё N», а не пропадают молча.
  const [allRoles, setAllRoles] = useState(false);
  const [composition, setComposition] = useState(false);
  const [hoverDay, setHoverDay] = useState<number | null>(null);
  const monthStart = `${month}-01`;
  // Раньше начала зарплатного учёта листать нечего (как во вкладке «Оплата»);
  // месяц из адреса остаётся доступным, даже если он раньше.
  const minMonth = useMemo(() => {
    const first = data.accruals.reduce<string | null>(
      (min, a) => (min === null || a.business_date < min ? a.business_date : min),
      null,
    );
    const start = `${(data.settings?.starts_on ?? first ?? `${initialMonth}-01`).slice(0, 7)}-01`;
    return start < `${initialMonth}-01` ? start : `${initialMonth}-01`;
  }, [data.accruals, data.settings?.starts_on, initialMonth]);
  // Предыдущий месяц — самый частый следующий шаг: подгружаем его заранее,
  // чтобы стрелка «назад» открывала его сразу.
  useEffect(() => {
    const date = new Date(`${month}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() - 1);
    const previous = date.toISOString().slice(0, 7);
    if (`${previous}-01` < minMonth || monthCache.current.has(previous)) return;
    const timer = setTimeout(() => {
      loadPayrollOverview(previous)
        .then(unwrapAction)
        .then((next) => {
          if (next.venueId === initial.venueId && !monthCache.current.has(previous))
            monthCache.current.set(previous, next);
        })
        .catch(() => undefined);
    }, 800);
    return () => clearTimeout(timer);
  }, [month, minMonth, initial.venueId]);
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
        data.officialExpected ?? [],
      ),
    [data, monthStart],
  );
  const active = rows.filter(
    (r) => r.shifts || r.earned || r.paid || r.opening || r.transferredOut || r.tips || r.officialExpected,
  );
  const total = rows.reduce((sum, r) => sum + r.earned, 0);
  // Пустой месяц (DS → «Состояния»): ни начислений, ни выплат, ни переносов —
  // вместо нулевого графика и пустой ведомости одно пустое состояние.
  const emptyMonth = tab === "statement" && active.length === 0;
  const planTab = tab === "plan";
  const planMonthIso = planView?.plan?.month ?? planView?.window?.month ?? null;
  const planMonth = planMonthIso
    ? `${new Intl.DateTimeFormat("ru-RU", { month: "long", timeZone: "UTC" }).format(new Date(`${planMonthIso.slice(0, 7)}-01T12:00:00Z`))} ${planMonthIso.slice(0, 4)}`
    : null;
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
      (r.shifts || r.earned || r.paid || r.opening || r.transferredOut || r.tips || r.officialExpected) &&
      (!role || r.employee.role_name === role) &&
      `${r.employee.name} ${r.employee.role_name}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const tableRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          (r.shifts || r.earned || r.paid || r.opening || r.transferredOut || r.tips || r.officialExpected) &&
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
  const groups = componentGroups(current);

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
  const openPay = (employeeId?: string) => {
    setPayFor(employeeId);
    setPayOpen(true);
  };
  const openEntry = (kind: "deduction" | "allowance" | "bonus", employeeId?: string) => {
    setEntryKind(kind);
    setEntryFor(employeeId);
    setEntryOpen(true);
  };
  const openTransfer = (employeeId?: string) => {
    setTransferFor(employeeId);
    setTransferOpen(true);
  };
  // Кому есть что переносить: пункт «Перенести остаток» только у них.
  const transferable = useMemo(
    () => new Set(transferCandidates(data, monthStart).map((e) => e.row.employee.id)),
    [data, monthStart],
  );
  const savePayslip = async (employee: (typeof rows)[number]["employee"]) => {
    const id = toast.loading("Формируем выписку…");
    try {
      await downloadPayslip(data, employee, monthStart);
      toast.dismiss(id);
    } catch {
      toast.error("Не удалось сформировать выписку. Попробуйте ещё раз", { id });
    }
  };
  /**
   * Правый клик по строке ведомости: то же, что в «Добавить» и в расчёте
   * сотрудника, но сразу для этого сотрудника. Пункты — по тем же правам,
   * что и кнопки.
   */
  const statementRowMenu = (row: (typeof rows)[number]) => {
    const id = row.employee.id;
    // Премии, штрафы и надбавки начисляют только работающим: форма
    // предлагает лишь их.
    const canEntry = can("review") && row.employee.active;
    const canTransfer = can("review") && transferable.has(id);
    // Форма выплаты предлагает работающих и тех, у кого есть начисления за месяц.
    const canPay = can("pay") && (
      row.employee.active || data.accruals.some((a) => a.employee_id === id && a.business_date.startsWith(month))
    );
    return (
      <>
        <ContextMenuLabel>{row.employee.name}</ContextMenuLabel>
        <ContextMenuItem onSelect={() => router.push(`/people/payroll/${id}?month=${month}`)}>
          <ArrowUpRight />
          Открыть расчёт
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void savePayslip(row.employee)}>
          <Download />
          Скачать выписку
        </ContextMenuItem>
        {(canPay || canEntry || canTransfer) && <ContextMenuSeparator />}
        {canPay && (
          <ContextMenuItem disabled={busy} onSelect={() => openPay(id)}>
            <Banknote />
            Выплатить
          </ContextMenuItem>
        )}
        {canEntry && (
          <>
            <ContextMenuItem onSelect={() => openEntry("bonus", id)}>
              <Gift />
              Начислить премию
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => openEntry("deduction", id)}>
              <CircleMinus />
              Добавить штраф
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => openEntry("allowance", id)}>
              <CirclePlus />
              Надбавка за месяц
            </ContextMenuItem>
          </>
        )}
        {canTransfer && (
          <ContextMenuItem onSelect={() => openTransfer(id)}>
            <ArrowRightLeft />
            Перенести остаток на следующий месяц
          </ContextMenuItem>
        )}
      </>
    );
  };
  const tableActions = tab === "statement" ? (
    (can("pay") || can("review") || canRecalculateShortage) && <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" disabled={busy}><Plus size={16} />Добавить</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {can("pay") && <DropdownMenuItem onSelect={() => openPay()}>Выплата</DropdownMenuItem>}
        {can("review") && <PayrollEntryMenuItems onSelect={(kind) => openEntry(kind)}/>}
        {can("review") && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => openTransfer()}>Перенести остаток</DropdownMenuItem></>}
        {canRecalculateShortage && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => void recalculateShortage()}>
          Пересчитать недостачу за месяц
        </DropdownMenuItem></>}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : tab === "payments" && can("pay") ? (
    <Button size="sm" onClick={() => openPay()} disabled={busy}>
      <Plus size={16} />Добавить выплату
    </Button>
  ) : null;
  const tabsList = (
    <TabsList aria-label="Разделы зарплаты">
      <TabsTrigger value="statement">Ведомость · {active.length}</TabsTrigger>
      <TabsTrigger value="payments">Выплаты</TabsTrigger>
      <TabsTrigger value="journal">Начисления и удержания</TabsTrigger>
      {can("view") && <TabsTrigger value="plan">План выплат</TabsTrigger>}
      {can("view") && <TabsTrigger value="kpi">KPI</TabsTrigger>}
    </TabsList>
  );
  const changeMonth = (value: string) => {
    wantedMonth.current = value;
    setShownMonth(value);
    const cached = monthCache.current.get(value);
    if (cached) {
      setData(cached);
      setMonth(value);
    }
    setHoverDay(null);
    const url = new URL(window.location.href);
    url.searchParams.set("month", value);
    window.history.replaceState(null, "", url);
    reload().catch((error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить месяц"),
    );
  };
  const changeTab = (id: string) => {
    setTab(id);
    setQuery("");
  };
  const monthLoading = shownMonth !== month;
  const moveMonth = (direction: number) => {
    const date = new Date(`${shownMonth}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + direction);
    changeMonth(date.toISOString().slice(0, 7));
  };
  // Выгрузка — то, что видно на экране: поиск и фильтр по должности
  // учитываются, условия записаны в шапке файла.
  const exportConditions = [
    role ? `должность «${role}»` : null,
    query.trim() ? `поиск «${query.trim()}»` : null,
  ].filter((c): c is string => !!c);
  const visiblePayments = () =>
    paymentJournalRows(data, filteredPayments, monthStart, role).filter((row) =>
      `${row.employee} ${row.kind} ${row.status}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
  const [exporting, setExporting] = useState(false);
  const saveWorkbook = async (
    build: () => Promise<{ sheets: XlsxSheet[]; fileName: string }>,
  ) => {
    setExporting(true);
    try {
      const { sheets, fileName } = await build();
      downloadBlob(await xlsxBlob(sheets), fileName);
    } catch {
      toast.error("Не удалось сформировать файл. Повторите попытку");
    } finally {
      setExporting(false);
    }
  };
  const exportRows = () =>
    saveWorkbook(async () => {
      // Обзор «Зарплаты» грузится без отметок и моделей оплаты: для часов
      // и должности в смене дочитываем их за месяц только при выгрузке.
      const [{ statementWorkbook, statementFileName }, extra] = await Promise.all([
        import("@/lib/payroll/statement-export"),
        loadStatementExportData(monthStart).then(unwrapAction),
      ]);
      return {
        sheets: statementWorkbook({
          venueName,
          month: monthStart,
          timezone: data.timezone,
          generatedAt: new Date(),
          rows: visible,
          accruals: data.accruals,
          attendance: extra.attendance,
          models: extra.models,
          roles: data.roles,
          paidKnown: knownBalance,
          conditions: exportConditions,
          payments: visiblePayments(),
        }),
        fileName: statementFileName(monthStart, venueName),
      };
    });
  const exportPayments = () =>
    saveWorkbook(async () => {
      const { paymentsWorkbook, paymentsFileName } = await import(
        "@/lib/payroll/statement-export"
      );
      return {
        sheets: paymentsWorkbook({
          venueName,
          month: monthStart,
          timezone: data.timezone,
          generatedAt: new Date(),
          conditions: exportConditions,
          payments: visiblePayments(),
        }),
        fileName: paymentsFileName(monthStart, venueName),
      };
    });
  return (
    <TooltipProvider>
      <div className={`${s.app} ${s.embedded}`}>
        <Breadcrumbs items={[{ label: "Люди" }, { label: "Зарплата" }]} />
        <div className={s.main}>
          <PageFrame>
            <TablePageHeader
              className={s.pageHeader}
              title="Зарплата"
              period={planTab ? (
                // План выплат всегда про текущую выплату: месяц видно, но не
                // переключаем (Павел, 26.11).
                planMonth && (
                  <span
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-brand/20 bg-brand/[0.06] px-3 text-[13px] font-medium text-brand"
                    data-tip="Месяц плана выплат"
                  >
                    <CalendarDays size={15} aria-hidden />
                    {planMonth}
                  </span>
                )
              ) : (
                <PeriodStepper
                  previous="Предыдущий месяц"
                  next="Следующий месяц"
                  previousDisabled={`${shownMonth}-01` <= minMonth}
                  onPrevious={() => moveMonth(-1)}
                  onNext={() => moveMonth(1)}
                >
                  {/* Тот же выбор месяца, что на странице расчёта сотрудника
                      и во вкладке «Оплата»: общий MonthPicker. */}
                  <MonthPicker
                    variant="period"
                    prefix=""
                    ariaLabel="Месяц ведомости"
                    value={`${shownMonth}-01`}
                    min={minMonth}
                    onChange={(value) => changeMonth(value.slice(0, 7))}
                  />
                </PeriodStepper>
              )}
              actions={
                <div id="payroll-workspace-controls" className={s.functionalControls} />
              }
            />
            <Tabs
              value={tab}
              onValueChange={changeTab}
              aria-busy={monthLoading || undefined}
              // Пока грузится выбранный месяц, прежние цифры приглушены.
              className={`${tabStyle.tabs} transition-opacity duration-150 ${monthLoading ? "pointer-events-none opacity-60" : ""}`}
            >
            {/* Вкладки — сразу под шапкой: при переключении меняется всё ниже,
                и итоги тоже. «Обзор» (график и стоимость команды) — справа в
                строке вкладок, только на «Ведомости». */}
            <TabsRow
              tabs={tabsList}
              aside={
                tab === "statement" && !emptyMonth && (
                  <OverviewToggle
                    open={overviewOpen}
                    onOpenChange={setOverviewOpen}
                    ariaLabel="Обзор: график и стоимость команды"
                  />
                )
              }
            />
            {autoRefresh.failed && (
              <RefreshFailedNotice className="mb-4" {...autoRefresh} />
            )}
            {can("view") && (
              <AttendanceAttentionNotice className="mb-4" months={[monthStart.slice(0, 7)]} initial={initialAttention} />
            )}
            {/* Итоги вкладки мягко всплывают и досчитываются заново при её смене. */}
            <div key={tab} className="motion-rise">
            {tab === "kpi" ? null : tab === "plan" ? (
              <PlanMetrics view={planView} />
            ) : tab === "payments" ? (
              <PaymentsMetrics data={data} month={monthStart} />
            ) : tab === "journal" ? (
              <JournalMetrics data={data} month={monthStart} />
            ) : (
            <MetricStrip label="Итоги за месяц">
              <Metric
                primary
                label="Начислено команде"
                icon={<ArrowUpRight size={15} />}
                ariaLabel="Начислено команде: состав начислений"
                onClick={() => setComposition(true)}
                value={<AnimatedMoney value={total} />}
                hint={`${staffCount(active.length)} · ${shiftCount(shifts)}`}
              />
              <Metric
                label="Выплачено"
                value={<AnimatedMoney value={historyPending ? null : paid} />}
                // Причина прочерка написана текстом: подсказку по наведению
                // не увидеть с клавиатуры и с телефона.
                hint={
                  historyPending
                    ? "Прежние выплаты ещё не сверены"
                    : `${countRu(payments.length, "операция", "операции", "операций")} за месяц`
                }
              />
              <Metric
                label={knownBalance && toKopecks(remaining) < 0 ? "Переплата" : "К выплате"}
                value={
                  <Money
                    value={knownBalance ? Math.abs(toKopecks(remaining)) : null}
                    fraction="auto"
                  />
                }
                hint={knownBalance ? undefined : "Появится после сверки прежних выплат"}
              />
              <Metric label="Чаевые" value={<AnimatedMoney value={tips} />} hint="Отдельно от зарплаты" />
            </MetricStrip>
            )}
            </div>
            {/* Вкладки представления: общий Tabs + workspace-tabs. Панель одна
                на активную вкладку — как у Radix, неактивные не монтируются. */}
            <TabsContent value={tab} className="!mt-0">
            {tab === "plan" && (
              <PayoutPlan venueId={data.venueId} view={planView} onView={setPlanView} onChanged={reload} />
            )}
            {tab === "kpi" && <KpiTab month={month} />}
            {emptyMonth ? (
              <EmptyState
                className="mt-6"
                icon={CalendarX2}
                title={`За ${title} начислений нет`}
                description="Начисления появятся после первых смен месяца. Выплату или запись можно добавить и сейчас."
                action={tableActions || undefined}
              />
            ) : null}
            {tab === "statement" && !emptyMonth && (
              // Ключ — чтобы при раскрытии график рисовался заново, а не уже нарисованным.
              <ExpandPanel open={overviewOpen} replayOnOpen>
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
                        // Новый месяц — график рисуется заново (дизайн-система, «Движение»).
                        key={monthStart}
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
                          className="chart-fill-in"
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
                          pathLength={1}
                          className="chart-line-draw"
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
                            key={monthStart}
                            className="chart-bar-grow-x"
                            style={{
                              animationDelay: `${200 + i * 90}ms`,
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
              </ExpandPanel>
            )}
            {!emptyMonth && !planTab && tab !== "kpi" && <section className={`${s.ledger} ${s.functionalTable}`}>
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
                    onClick: () => void exportPayments(),
                    loading: exporting,
                  }}
                  // Ключ сохранённых настроек столбцов: остался от прежнего названия
                  // экрана, менять нельзя — у всех сбросятся порядок и ширина столбцов.
                  tableId={`payroll.concept.payments.${data.venueId}`}
                  externalSearch={{ value: query, onChange: setQuery }}
                  filters={roleFilters}
                  onChange={reload}
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
                  onExport={() => void exportRows()}
                  exporting={exporting}
                  onEmployee={(row) =>
                    router.push(`/people/payroll/${row.employee.id}?month=${month}`)
                  }
                  actions={tableActions}
                  filters={roleFilters}
                  rowMenu={statementRowMenu}
                />
              )}
            </section>}
            </TabsContent>
            </Tabs>
          </PageFrame>

        </div>
        <PayrollEntryForm initialKind={entryKind} employeeId={entryFor} open={entryOpen} onOpenChange={setEntryOpen} data={data} month={monthStart}
          onCreated={async () => { await reload(); changeTab("journal"); }} />
        {shownTransfer && <PayrollTransferDrawer key={transferFor ?? "all"} open={transferOpen} data={data} month={monthStart}
          employeeId={transferFor}
          onClose={() => setTransferOpen(false)} onChange={reload} />}
        <Dialog
          open={composition}
          onOpenChange={setComposition}
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
              Состав начислений
            </DialogTitle>
            <DialogDescription className={s.dialogDescription}>
              {`Команда заведения · ${title}`}
            </DialogDescription>
            <div className={s.dialogBody}>
              <div className={s.employeeTotal}>
                <span>Начислено за месяц</span>
                <strong><Money value={total} /></strong>
                <small>
                  {`${staffCount(active.length)} · ${shiftCount(shifts)}`}
                </small>
              </div>
              <CompositionList groups={groups} />
            </div>
          </DialogContent>
        </Dialog>
        <ConfirmDialog
          open={Boolean(cancelId)}
          onOpenChange={(open) => {
            if (!open) setCancelId(null);
          }}
          title="Удалить выплату?"
          consequences={[
            { kind: "remove", text: "Финансовая операция будет помечена удалённой" },
            { kind: "info", text: "Сумма вернётся в «К выплате»" },
            { kind: "keep", text: "История сохранится" },
          ]}
          confirmLabel="Удалить выплату"
          pendingLabel="Удаляем…"
          destructive
          busy={busy}
          onConfirm={() => {
            if (cancelId)
              void run(async () => {
                unwrapAction(await cancelPayrollPayment(cancelId));
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
            key={payFor ?? "all"}
            initialEmployeeId={payFor}
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

const PLAN_MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const dm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

/** Итоги плана выплат вместо итогов месяца — пока открыта вкладка «План выплат». */
function PlanMetrics({ view }: { view: PayoutPlanView | null }) {
  const rows = (view?.rows ?? []).filter((r) => !r.outside);
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  const issued = rows.reduce((sum, r) => sum + r.issued, 0);
  const people = rows.filter((r) => r.amount > 0);
  const issuedPeople = people.filter((r) => r.issued >= r.amount).length;
  const todayRows = people.filter((r) => r.pay_date === view?.today && r.issued < r.amount);
  const todaySum = todayRows.reduce((sum, r) => sum + r.amount - r.issued, 0);
  const window = view?.window;
  const state = view?.plan?.state === "approved" ? "утверждён" : view?.plan?.state === "draft" ? "черновик" : "не сформирован";
  const title = window ? `${view?.payoutNo === 2 ? "Вторая" : "Первая"} выплата за ${PLAN_MONTHS[Number(window.month.slice(5, 7)) - 1]}` : "План выплат";
  return (
    <MetricStrip label="Итоги плана выплат">
      <Metric
        primary
        label={title}
        value={<AnimatedMoney value={view ? total : null} />}
        hint={window ? `${dm(window.from)} – ${dm(window.to)} · ${state}` : "План выплаты ещё не сформирован"}
      />
      <Metric
        label="Выдано"
        value={<AnimatedMoney value={view ? issued : null} />}
        hint={view ? `${issuedPeople} из ${people.length} сотрудников` : undefined}
      />
      <Metric label="Осталось выдать" value={<AnimatedMoney value={view ? total - issued : null} />} />
      <Metric
        label="Сегодня по плану"
        value={<AnimatedMoney value={view ? todaySum : null} />}
        hint={
          !view ? undefined
          : view.plan?.state !== "approved" ? "после утверждения"
          : view.settings.auto_issue ? `${countRu(todayRows.length, "сотрудник", "сотрудника", "сотрудников")} · автоматически в 14:00`
          : `${countRu(todayRows.length, "сотрудник", "сотрудника", "сотрудников")} · кнопкой «Выдать сейчас»`
        }
      />
    </MetricStrip>
  );
}

/** Итоги вкладки «Выплаты»: что и как выплачено за месяц. */
function PaymentsMetrics({ data, month }: { data: PayrollData; month: string }) {
  const posted = new Map(data.payments.filter((p) => p.state === "posted").map((p) => [p.id, p]));
  const lines = data.allocations.filter((a) => a.month === month && posted.has(a.payment_id));
  const sum = (pick: (kind: string, official: boolean) => boolean) =>
    lines
      .filter((a) => {
        const p = posted.get(a.payment_id)!;
        return pick(p.kind, !!p.official_month);
      })
      .reduce((total, a) => total + Number(a.amount), 0);
  const count = (pick: (kind: string) => boolean) =>
    new Set(lines.filter((a) => pick(posted.get(a.payment_id)!.kind)).map((a) => a.payment_id)).size;
  const salary = sum((kind) => kind !== "tips");
  return (
    <MetricStrip label="Итоги выплат за месяц">
      <Metric
        primary
        label="Выплачено зарплаты"
        value={<AnimatedMoney value={salary} />}
        hint={countRu(count((kind) => kind !== "tips"), "операция", "операции", "операций")}
      />
      <Metric label="Наличными и переводом" value={<AnimatedMoney value={sum((kind, official) => kind !== "tips" && !official)} />} hint="Без официальной части" />
      <Metric label="Официальная часть" value={<AnimatedMoney value={sum((kind, official) => kind !== "tips" && official)} />} hint="Переводит бухгалтерия" />
      <Metric label="Чаевые выданы" value={<AnimatedMoney value={sum((kind) => kind === "tips")} />} hint={countRu(count((kind) => kind === "tips"), "выдача", "выдачи", "выдач")} />
    </MetricStrip>
  );
}

/** Итоги вкладки «Начисления и удержания»: премии, штрафы, надбавки за месяц. */
function JournalMetrics({ data, month }: { data: PayrollData; month: string }) {
  const rows = data.adjustments.filter((a) => !a.deleted_at && a.business_date.startsWith(month.slice(0, 7)));
  const total = (pick: (a: (typeof rows)[number]) => boolean) => rows.filter(pick).reduce((s, a) => s + Number(a.amount), 0);
  const bonuses = total((a) => a.kind !== "allowance" && Number(a.amount) > 0);
  const fines = total((a) => Number(a.amount) < 0);
  const allowances = total((a) => a.kind === "allowance");
  const pending = rows.filter((a) => !a.approved);
  return (
    <MetricStrip label="Итоги начислений и удержаний за месяц">
      <Metric primary label="Премии" value={<AnimatedMoney value={bonuses} signed />} hint={countRu(rows.filter((a) => a.kind !== "allowance" && Number(a.amount) > 0).length, "запись", "записи", "записей")} />
      <Metric label="Штрафы и удержания" value={<AnimatedMoney value={fines} signed />} hint={countRu(rows.filter((a) => Number(a.amount) < 0).length, "запись", "записи", "записей")} />
      <Metric label="Надбавки за месяц" value={<AnimatedMoney value={allowances} signed />} />
      <Metric label="На подтверждении" value={<AnimatedMoney value={total((a) => !a.approved)} signed />} hint={countRu(pending.length, "запись", "записи", "записей")} />
    </MetricStrip>
  );
}
