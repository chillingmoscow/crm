"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  PageBreadcrumb,
  PageHeaderActions,
} from "@/components/shared/page-header-actions";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
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
import { TooltipProvider } from "@/components/ui/tooltip";
import { PayrollDetailDialog } from "@/app/(dashboard)/people/payroll/_components/payroll-detail-dialog";
import { ConceptPaymentForm } from "./concept-payment-form";
import paymentStyle from "./concept-payment-form.module.css";
import { paymentJournalRows } from "@/lib/payroll/payment-journal";
import { PayrollPaymentsTable } from "@/app/(dashboard)/people/payroll/_components/payroll-payments-table";
import {
  loadPayroll,
  cancelPayrollPayment,
} from "@/app/(dashboard)/people/payroll/actions";
import { PayrollJournal, PayrollEntryForm, PayrollEntryMenuItems } from "./payroll-journal";
import { PayrollTransferDrawer } from "./payroll-transfer-drawer";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { PayrollLedger } from "./payroll-ledger";
import { statementRows } from "@/lib/payroll/calculate";
import type { Accrual, PayrollData } from "@/lib/payroll/types";
import s from "./payroll-concept.module.css";
import { PageFrame } from "@/components/shared/page-frame";

type Row = ReturnType<typeof statementRows>[number];
const rub = (n: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n);
const amount = (n: number) => `${rub(n)} ₽`;
const short = (n: number) => (n >= 1000 ? `${rub(n / 1000)} тыс.` : rub(n));
const plural = (n: number, forms: [string, string, string]) => {
  const v = Math.abs(n) % 100,
    d = v % 10;
  return `${n} ${forms[v > 10 && v < 20 ? 2 : d === 1 ? 0 : d >= 2 && d <= 4 ? 1 : 2]}`;
};
const shiftCount = (n: number) => plural(n, ["смена", "смены", "смен"]);
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

export function PayrollConcept({
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
    const next = await loadPayroll();
    if (next.venueId === initial.venueId) setData(next);
  }, [initial.venueId]);
  useEffect(() => {
    const timer = setInterval(() => {
      void reload().catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
  }, [reload]);
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
  const [selected, setSelected] = useState<Row | null>(null);
  const [day, setDay] = useState<Accrual | null>(null);
  const [employeeTab, setEmployeeTab] = useState("summary");
  const [help, setHelp] = useState(false);
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
    (r) => r.shifts || r.earned || r.paid || r.opening,
  );
  const total = rows.reduce((sum, r) => sum + r.earned, 0);
  const paid = rows.reduce((sum, r) => sum + r.paid, 0);
  const tips = rows.reduce((sum, r) => sum + r.tips, 0);
  const shifts = rows.reduce((sum, r) => sum + r.shifts, 0);
  const historyPending = data.legacyPayments.some(
    (p) => p.month === monthStart && p.state === "review",
  );
  const knownBalance =
    !historyPending && rows.every((r) => r.employee.opening_confirmed);
  const remaining = rows.reduce((sum, r) => sum + r.remaining, 0);
  const roles = [
    ...new Set(rows.map((r) => r.employee.role_name).filter(Boolean)),
  ].sort();
  const visible = rows.filter(
    (r) =>
      (r.shifts || r.earned || r.paid || r.opening) &&
      (!role || r.employee.role_name === role) &&
      `${r.employee.name} ${r.employee.role_name}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const tableRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          (r.shifts || r.earned || r.paid || r.opening) &&
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
  const selectedPoint =
    daily[
      hoverDay ??
        daily.reduce(
          (best, d, i) => (d.value > daily[best].value ? i : best),
          0,
        )
    ];
  const groups = componentGroups(selected ? selectedDays : current);

  const roleFilters = {
    active: Boolean(role),
    content: (
      <div className={s.roleFilter}>
        <span>Должность</span>
        {["", ...roles].map((name) => (
          <button key={name} onClick={() => setRole(name)}>
            <span>{name || "Все должности"}</span>
            {role === name && <Check size={14} />}
          </button>
        ))}
      </div>
    ),
  };
  const tableActions = tab === "statement" ? (
    (can("pay") || can("review")) && <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className={s.actionButton} disabled={busy}><Plus size={16} />Добавить<ChevronDown size={14} /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {can("pay") && <DropdownMenuItem onSelect={() => setPayOpen(true)}>Выплата</DropdownMenuItem>}
        {can("review") && <PayrollEntryMenuItems onSelect={(kind) => {setEntryKind(kind);setEntryOpen(true);}}/>}
        {can("review") && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => {
          setTransferEmployee(undefined); setTransferOpen(true);
        }}>Перенести остаток</DropdownMenuItem></>}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : tab === "payments" && can("pay") ? (
    <Button className={s.actionButton} onClick={() => setPayOpen(true)} disabled={busy}>
      <Plus size={16} />Добавить выплату
    </Button>
  ) : null;
  const moveMonth = (direction: number) => {
    const date = new Date(`${monthStart}T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + direction);
    setMonth(date.toISOString().slice(0, 7));
    setHoverDay(null);
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
        r.employee.opening_confirmed ? r.opening : "",
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
        <PageBreadcrumb>
          <div className={s.breadcrumb}>
            <Link href="/people/staff">Люди</Link>
            <span>/</span>
            <strong>Зарплата</strong>
          </div>
        </PageBreadcrumb>
        <PageHeaderActions>
          <button
            className={s.iconButton}
            aria-label="Как устроен этот экран"
            onClick={() => setHelp(true)}
          >
            <CircleHelp size={18} />
          </button>
        </PageHeaderActions>
        <div className={s.main}>
          <PageFrame>
            <section className={s.heading}>
              <div>
                <h1>Зарплата</h1>
              </div>
            </section>
            <div className={s.contextBar}>
              <div className={s.monthControl}>
                <button
                  onClick={() => moveMonth(-1)}
                  aria-label="Предыдущий месяц"
                >
                  <ChevronLeft size={16} />
                </button>
                <Popover
                  open={monthOpen}
                  onOpenChange={(open) => {
                    setMonthOpen(open);
                    if (open) setPickerYear(Number(month.slice(0, 4)));
                  }}
                >
                  <PopoverTrigger asChild>
                    <button
                      className={s.monthTrigger}
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
                        aria-label="Предыдущий год"
                        onClick={() => setPickerYear(pickerYear - 1)}
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <strong>{pickerYear}</strong>
                      <button
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
                              setMonth(value);
                              setHoverDay(null);
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
                <button
                  onClick={() => moveMonth(1)}
                  aria-label="Следующий месяц"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              <div
                id="payroll-concept-controls"
                className={s.functionalControls}
              />
            </div>
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
                  {rub(total)} <span>₽</span>
                </strong>
                <small>
                  {plural(active.length, [
                    "сотрудник",
                    "сотрудника",
                    "сотрудников",
                  ])}{" "}
                  <i>·</i> {shiftCount(shifts)}
                </small>
              </button>
              <div className={s.metric}>
                <span className={s.metricLabel}>Выплачено</span>
                <strong>
                  <span
                    className={s.metricValue}
                    title={
                      historyPending
                        ? "Прежние выплаты пока не учтены в этом расчёте"
                        : undefined
                    }
                  >
                    {historyPending ? "—" : rub(paid)}
                  </span>{" "}
                  <span>₽</span>
                </strong>
                {!historyPending && (
                  <small>{payments.length} операций за месяц</small>
                )}
              </div>
              <div className={s.metric}>
                <span className={s.metricLabel}>К выплате</span>
                <strong>
                  <span
                    className={s.metricValue}
                    title={
                      !knownBalance
                        ? "Остаток появится после уточнения выплат и переносов"
                        : undefined
                    }
                  >
                    {knownBalance ? rub(remaining) : "—"}
                  </span>{" "}
                  <span>₽</span>
                </strong>
              </div>
              <div className={s.metric}>
                <span className={s.metricLabel}>Чаевые</span>
                <strong>
                  {rub(tips)} <span>₽</span>
                </strong>
                <small>Отдельно от зарплаты</small>
              </div>
            </section>
            <div className={s.tabs}>
              <div role="tablist" aria-label="Разделы зарплаты">
                {[
                  ["statement", "Ведомость"],
                  ["payments", "Выплаты"],
                  ["journal", "Начисления и удержания"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={tab === id}
                    onClick={() => {
                      setTab(id);
                      setQuery("");
                    }}
                    className={tab === id ? s.activeTab : ""}
                  >
                    {label}
                    {id === "statement" && <span>{active.length}</span>}
                  </button>
                ))}
              </div>
            </div>
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
                    <strong>{amount(selectedPoint.value)}</strong>
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
                      onMouseLeave={() => setHoverDay(null)}
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
                      <div className={s.chartTargets}>
                        {daily.map((d, i) => (
                          <button
                            key={d.day}
                            aria-label={`${d.day} число: ${amount(d.value)}`}
                            onMouseEnter={() => setHoverDay(i)}
                            onFocus={() => setHoverDay(i)}
                            onClick={() => setHoverDay(i)}
                          />
                        ))}
                      </div>
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
                    {perRole.slice(0, 4).map((r, i) => (
                      <button
                        key={r.name}
                        onClick={() => {
                          setRole(role === r.name ? "" : r.name);
                        }}
                        className={role === r.name ? s.selectedRole : ""}
                      >
                        <div>
                          <span>
                            <i style={{ background: colors[i] }} />
                            {r.name}
                          </span>
                          <strong>{amount(r.value)}</strong>
                        </div>
                        <div className={s.barTrack}>
                          <span
                            style={{
                              width: `${total ? (r.value / total) * 100 : 0}%`,
                              background: colors[i],
                            }}
                          />
                        </div>
                      </button>
                    ))}
                  </div>
                  <div className={s.average}>
                    <span>
                      В среднем за смену<small>Без сотрудников на окладе</small>
                    </span>
                    <strong>
                      {amount(
                        shifts
                          ? current
                              .filter(
                                (a) =>
                                  a.calculation_snapshot.kind !== "monthly",
                              )
                              .reduce((sum, a) => sum + Number(a.salary), 0) /
                              shifts
                          : 0,
                      )}
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
                  toolbarTargetId="payroll-concept-controls"
                  scrollMode="page"
                  exportAction={{
                    label: "Экспорт выплат",
                    onClick: exportPayments,
                  }}
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
          </PageFrame>
        </div>
        <PayrollEntryForm initialKind={entryKind} open={entryOpen} onOpenChange={setEntryOpen} data={data} month={monthStart}
          onCreated={async () => { await reload(); setTab("journal"); }} />
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
                <strong>{amount(selected ? selected.earned : total)}</strong>
                <small>
                  {selected
                    ? `${shiftCount(selected.shifts)} · чаевые ${amount(selected.tips)} отдельно`
                    : `${plural(active.length, ["сотрудник", "сотрудника", "сотрудников"])} · ${shiftCount(shifts)}`}
                </small>
              </div>
              {selected && (
                <div className={s.employeeTabs}>
                  <button
                    onClick={() => {
                      setEmployeeTab("summary");
                      setDay(null);
                    }}
                    className={
                      employeeTab === "summary" ? s.employeeTabActive : ""
                    }
                  >
                    Состав зарплаты
                  </button>
                  <button
                    onClick={() => setEmployeeTab("shifts")}
                    className={
                      employeeTab === "shifts" ? s.employeeTabActive : ""
                    }
                  >
                    Смены <span>{selectedDays.length}</span>
                  </button>
                </div>
              )}
              {(!selected || employeeTab === "summary") && (
                <div className={s.breakdown}>
                  {groups.map(([label, value]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <strong>
                        {value < 0 ? "−" : ""}
                        {amount(Math.abs(value))}
                      </strong>
                    </div>
                  ))}
                </div>
              )}
              {selected &&
                employeeTab === "shifts" &&
                (day ? (
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
                      <strong>{amount(Number(day.salary))}</strong>
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
                              : amount(Number(c.amount))}
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
                          <strong>{amount(Number(a.salary))}</strong>
                          <ChevronRight size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
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
        <Dialog
          open={Boolean(cancelId)}
          onOpenChange={(open) => {
            if (!open) setCancelId(null);
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
              Удалить выплату?
            </DialogTitle>
            <DialogDescription className={s.dialogDescription}>
              Транзакция будет помечена удалённой, а сумма вернётся в остаток к
              выплате. История сохранится.
            </DialogDescription>
            <div className={s.dialogActions}>
              <Button variant="outline" onClick={() => setCancelId(null)}>
                Назад
              </Button>
              <Button
                disabled={busy}
                variant="destructive"
                onClick={() => {
                  if (cancelId)
                    void run(async () => {
                      await cancelPayrollPayment(cancelId);
                      setCancelId(null);
                    }, "Выплата удалена");
                }}
              >
                Удалить выплату
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <PayrollDetailDialog
          open={payOpen}
          onOpenChange={setPayOpen}
          title="Добавить выплату"
          description="Запись выданной зарплаты"
          footer={
            <div
              id="concept-payment-footer"
              className={paymentStyle.footerSlot}
            />
          }
        >
          <ConceptPaymentForm
            data={data}
            month={monthStart}
            onDone={async () => {
              setPayOpen(false);
              await reload();
            }}
          />
        </PayrollDetailDialog>
        <Dialog open={help} onOpenChange={setHelp}>
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
              От смены до зарплаты
            </DialogTitle>
            <DialogDescription className={s.dialogDescription}>
              Один расчёт, понятные основания.
            </DialogDescription>
            <div className={s.helpSteps}>
              {[
                [
                  "01",
                  "Смены из Quick Resto",
                  "Закрытые персональные смены подтверждают фактическую работу сотрудника.",
                ],
                [
                  "02",
                  "Ваши правила оплаты",
                  "Ставка, проценты, надбавки и премии формируют начисление. Удержания уменьшают его.",
                ],
                [
                  "03",
                  "Выплаты и переносы",
                  "Записанная выплата уменьшает долг. Перенос между месяцами оформляется вручную.",
                ],
                [
                  "04",
                  "Чаевые отдельно",
                  "Показываем сумму чаевых, не смешивая её с зарплатой.",
                ],
              ].map(([n, t, d]) => (
                <div key={n}>
                  <span>{n}</span>
                  <div>
                    <strong>{t}</strong>
                    <p>{d}</p>
                  </div>
                </div>
              ))}
              <p className={s.helpNote}>
                Выплаты работают с реальными данными. Перевод денег в банке
                выполняется отдельно.
              </p>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
