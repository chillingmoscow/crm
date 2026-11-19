"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown, Download, Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MonthPicker } from "@/components/shared/month-picker";
import { PeriodStepper } from "@/components/shared/period-stepper";
import { ProfileSection } from "@/components/shared/profile-section";
import { Money, formatRub } from "@/components/shared/money";
import { toKopecks } from "@/lib/format/amount";
import { StatusBadge } from "@/components/ui/status-badge";
import { countRu } from "@/lib/format/plural";
import { accrualRole } from "@/lib/payroll/accrual-view";
import { attendanceRuleAtDate } from "@/lib/payroll/attendance";
import { statementRows } from "@/lib/payroll/calculate";
import {
  buildPaySheet,
  monthKey,
  payMonthHistory,
  paySheetPayments,
  shiftMonth,
  type PaySheetGroup,
  type PaySheetItem,
} from "@/lib/payroll/pay-sheet";
import type { PayEmployee, PayrollData } from "@/lib/payroll/types";
import { buildPayslip, payslipFileName } from "@/lib/payroll/payslip";
import { cn } from "@/lib/utils";
import { PayrollEntryForm } from "@/app/(dashboard)/people/payroll/_components/payroll-journal";
import { PayrollPaymentForm } from "@/app/(dashboard)/people/payroll/_components/payroll-payment-form";
import paymentStyle from "@/app/(dashboard)/people/payroll/_components/payroll-payment-form.module.css";
import { EmployeePayConditions } from "./employee-pay-conditions";
import { PayrollDetailDialog } from "./payroll-detail-dialog";

/** Сколько строк раскрытой статьи видно до «Показать все». */
const PREVIEW = 5;

const shifts = (n: number) => countRu(n, "смена", "смены", "смен");
const dayMonth = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;
const fullDate = (date: string) => date.slice(0, 10).split("-").reverse().join(".");
const monthName = (month: string, format: "long" | "short" = "long") =>
  new Date(`${monthKey(month)}-01T12:00:00Z`)
    .toLocaleDateString("ru-RU", { month: format, timeZone: "UTC" })
    .replace(".", "");

/** Статьи, которые считаются за каждую смену. */
const PER_SHIFT = new Set(["base", "percent", "extra", "experience", "knowledge", "food"]);

function groupNote(group: PaySheetGroup) {
  const n = group.items.length;
  if (group.id === "monthly") return "За месяц";
  if (PER_SHIFT.has(group.id))
    return group.uniform !== null && n > 1 ? `${shifts(n)} × ${formatRub(group.uniform)}` : shifts(n);
  if (n === 1) return group.items[0].title;
  return countRu(n, "запись", "записи", "записей");
}

/** Расчётный лист сотрудника за месяц: вкладка «Оплата» в карточке. */
export function StaffPaySheet({
  data,
  employee,
  month,
  minMonth,
  maxMonth,
  onMonth,
  onChange,
}: {
  data: PayrollData;
  employee: PayEmployee;
  /** Первое число выбранного месяца. */
  month: string;
  minMonth: string;
  maxMonth: string;
  onMonth: (month: string) => void;
  onChange: () => Promise<void>;
}) {
  const [conditionsOpen, setConditionsOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryKind, setEntryKind] = useState<"deduction" | "allowance">("deduction");
  const [downloading, setDownloading] = useState(false);

  async function downloadPayslip() {
    setDownloading(true);
    try {
      const payslip = buildPayslip(data, employee, month, (a) => accrualRole(a, employee.role_name, data));
      // The PDF renderer is heavy: it is loaded only when a statement is requested.
      const { renderPayslip } = await import("@/lib/payroll/payslip-pdf");
      const blob = await renderPayslip(payslip, `${window.location.origin}/fonts/inter`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = payslipFileName(payslip);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      toast.error("Не удалось сформировать выписку. Попробуйте ещё раз");
    } finally {
      setDownloading(false);
    }
  }

  const mine = useMemo(
    () => data.accruals.filter((a) => a.employee_id === employee.id),
    [data.accruals, employee.id],
  );
  const sheet = useMemo(
    () => buildPaySheet(mine, month, (a) => accrualRole(a, employee.role_name, data)),
    [mine, month, employee.role_name, data],
  );
  const payments = useMemo(
    () =>
      paySheetPayments(data.payments, data.allocations, employee.id, month).filter(
        (p) => p.kind !== "tips",
      ),
    [data.payments, data.allocations, employee.id, month],
  );
  const history = useMemo(
    () => payMonthHistory(mine, maxMonth, minMonth),
    [mine, maxMonth, minMonth],
  );
  const row = statementRows(
    [employee],
    data.accruals,
    data.adjustments,
    data.payments,
    data.allocations,
    month,
    data.transfers,
    data.settings?.starts_on,
  )[0];

  const can = (permission: string) => data.permissions.includes(permission);
  const canPay = can("payroll.pay") && can("finance.create_transaction");
  const canReview = can("payroll.review");
  const canConfigure = can("payroll.configure");

  const name = monthName(month);
  const earned = row?.earned ?? 0,
    paid = row?.paid ?? 0,
    opening = row?.opening ?? 0,
    transferredOut = row?.transferredOut ?? 0,
    remaining = row?.remaining ?? 0,
    tips = row?.tips ?? 0,
    tipPaid = row?.tipPaid ?? 0;
  const owed = opening + earned - transferredOut;
  const legacyPending = data.legacyPayments.some(
    (p) => p.employee_id === employee.id && monthKey(p.month) === monthKey(month) && p.state === "review",
  );
  // Прочерк вместо нуля: остаток нельзя назвать, пока исходные данные не сверены.
  const unknownReason = legacyPending
    ? "Есть несверенные выплаты из прежнего учёта."
    : !employee.opening_confirmed
      ? "Начальный остаток сотрудника не подтверждён."
      : null;
  const issues = [
    ...new Set(
      mine.filter((a) => a.business_date.startsWith(monthKey(month))).flatMap((a) => a.issues),
    ),
  ];
  const empty =
    !sheet.groups.length && !sheet.deductions.length && !payments.length && !owed && !tips;

  const addMenu =
    canPay && canReview ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="h-9">
            <Plus />
            Добавить
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setPayOpen(true)}>Выплата</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openEntry("deduction")}>Премия / штраф</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openEntry("allowance")}>Надбавка за месяц</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : canPay ? (
      <Button className="h-9" onClick={() => setPayOpen(true)}>
        <Plus />
        Добавить выплату
      </Button>
    ) : canReview ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="h-9">
            <Plus />
            Добавить запись
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => openEntry("deduction")}>Премия / штраф</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openEntry("allowance")}>Надбавка за месяц</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  function openEntry(kind: "deduction" | "allowance") {
    setEntryKind(kind);
    setEntryOpen(true);
  }

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PeriodStepper
          previous="Предыдущий месяц"
          next="Следующий месяц"
          previousDisabled={monthKey(month) <= monthKey(minMonth)}
          nextDisabled={monthKey(month) >= monthKey(maxMonth)}
          onPrevious={() => onMonth(shiftMonth(month, -1))}
          onNext={() => onMonth(shiftMonth(month, 1))}
        >
          <MonthPicker
            variant="period"
            prefix=""
            ariaLabel="Месяц расчёта"
            value={month}
            min={minMonth}
            max={maxMonth}
            onChange={onMonth}
          />
        </PeriodStepper>
        {history.length > 1 && (
          <MonthBars history={history} month={month} onMonth={onMonth} />
        )}
      </div>

      {issues.length > 0 && (
        <div
          role="status"
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
        >
          <p className="font-medium">
            Расчёт за {name} неполный:{" "}
            {countRu(issues.length, "замечание", "замечания", "замечаний")}
          </p>
          <ul className="mt-1 list-disc pl-5 text-[13px] text-muted-foreground">
            {issues.slice(0, 3).map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
            {issues.length > 3 && <li>и ещё {issues.length - 3}</li>}
          </ul>
        </div>
      )}

      <section className="flex flex-col gap-4 rounded-[14px] border bg-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h2 className="text-xs font-medium text-muted-foreground">
              {!unknownReason && toKopecks(remaining) < 0 ? `Переплата за ${name}` : `К выплате за ${name}`}
            </h2>
            <p className="mt-1 text-[28px] font-semibold leading-tight tracking-tight tabular-nums">
              <Money value={unknownReason ? null : Math.abs(toKopecks(remaining))} fraction="auto" />
            </p>
          </div>
          <div className="flex gap-2">
            {!empty && (
              <Button
                variant="outline"
                className="h-9"
                disabled={downloading}
                onClick={downloadPayslip}
              >
                {downloading ? <Loader2 className="animate-spin" /> : <Download />}
                Выписка
              </Button>
            )}
            {addMenu}
          </div>
        </div>
        {unknownReason ? (
          <p className="text-[13px] text-muted-foreground">
            {unknownReason} Пока это так, остаток не показывается.
            {canConfigure && !legacyPending && (
              <>
                {" "}
                <button
                  type="button"
                  className="font-medium text-brand hover:underline"
                  onClick={() => setConditionsOpen(true)}
                >
                  Указать остаток
                </button>
              </>
            )}
          </p>
        ) : (
          owed > 0 && (
            <div
              className="h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="Доля выплаченного"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(Math.min(1, Math.max(0, paid / owed)) * 100)}
            >
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${Math.min(1, Math.max(0, paid / owed)) * 100}%` }}
              />
            </div>
          )
        )}
        <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 text-[13px] text-muted-foreground tabular-nums empty:hidden">
          {(paid !== 0 || owed > 0) && (
            <span>
              {unknownReason || owed <= 0
                ? `Выплачено ${formatRub(paid)}`
                : `Выплачено ${formatRub(paid)} из ${formatRub(owed)}`}
            </span>
          )}
          {tips > 0 && (
            <span>
              Чаевые {formatRub(tips)}
              {tipPaid > 0 ? ` (выдано ${formatRub(tipPaid)})` : ""}, отдельно от зарплаты
            </span>
          )}
        </div>
        {(opening !== 0 || transferredOut !== 0) && (
          <dl className="grid gap-1 border-t pt-3 text-[13px]">
            {opening !== 0 && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Перенос в этот месяц</dt>
                <dd className="tabular-nums"><Money value={employee.opening_confirmed ? opening : null} signed /></dd>
              </div>
            )}
            {transferredOut !== 0 && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Перенесено на другой месяц</dt>
                <dd className="tabular-nums"><Money value={-transferredOut} signed /></dd>
              </div>
            )}
          </dl>
        )}
      </section>

      {empty ? (
        <ProfileSection title={`За ${name} записей нет`}>
          <p className="text-sm text-muted-foreground">
            Нет ни начислений, ни выплат. Выберите другой месяц или добавьте запись.
          </p>
        </ProfileSection>
      ) : (
        <>
          <ProfileSection
            title="Начислено"
            actions={<Sum><Money value={sheet.earned} /></Sum>}
          >
            {sheet.groups.length ? (
              <div className="flex flex-col">
                {sheet.groups.map((group) => (
                  <GroupLine key={`${month}.${group.id}`} group={group} />
                ))}
              </div>
            ) : (
              <Quiet>Начислений за месяц нет</Quiet>
            )}
          </ProfileSection>

          <ProfileSection
            title="Удержано"
            actions={
              <Sum>
                <Money value={sheet.deducted < 0 ? sheet.deducted : 0} signed />
              </Sum>
            }
          >
            {sheet.deductions.length ? (
              <ul className="flex flex-col">
                {sheet.deductions.map((item) => (
                  <StaticLine
                    key={item.key}
                    title={item.title}
                    note={fullDate(item.date)}
                    amount={
                      <Money value={item.amount ?? 0} signed />
                    }
                  />
                ))}
              </ul>
            ) : (
              <Quiet>Удержаний за месяц нет</Quiet>
            )}
          </ProfileSection>

          <ProfileSection title="Выплачено" actions={<Sum><Money value={paid} /></Sum>}>
            {payments.length ? (
              <ul className="flex flex-col">
                {payments.map((p) => (
                  <StaticLine
                    key={p.id}
                    title={
                      <>
                        {p.kind === "advance" ? "Аванс" : "Зарплата"}
                        {!p.posted && (
                          <StatusBadge className="ml-2">Удалена</StatusBadge>
                        )}
                      </>
                    }
                    note={new Intl.DateTimeFormat("ru-RU", { timeZone: data.timezone }).format(
                      new Date(p.date),
                    )}
                    amount={
                      <span className={p.posted ? undefined : "text-muted-foreground line-through"}>
                        <Money value={p.amount} />
                      </span>
                    }
                  />
                ))}
              </ul>
            ) : (
              <Quiet>Выплат за месяц нет</Quiet>
            )}
          </ProfileSection>
        </>
      )}

      <ProfileSection
        title="Условия оплаты"
        actions={
          <Button variant="outline" size="sm" onClick={() => setConditionsOpen(true)}>
            {canConfigure && <Pencil />}
            {canConfigure ? "Изменить" : "Подробнее"}
          </Button>
        }
      >
        <Conditions data={data} employee={employee} month={month} canConfigure={canConfigure} />
      </ProfileSection>

      {can("payroll.view") && (
        <Link
          href={`/people/payroll/${employee.id}?month=${monthKey(month)}`}
          className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-brand hover:underline"
        >
          Открыть расчёт в «Зарплате»
          <ArrowUpRight className="size-4" />
        </Link>
      )}

      <PayrollDetailDialog
        open={conditionsOpen}
        onOpenChange={setConditionsOpen}
        title="Условия сотрудника"
        description={employee.name}
      >
        <EmployeePayConditions data={data} employee={employee} month={month} onChange={onChange} />
      </PayrollDetailDialog>
      <PayrollEntryForm
        initialKind={entryKind}
        employeeId={employee.id}
        open={entryOpen}
        onOpenChange={setEntryOpen}
        data={data}
        month={month}
        onCreated={onChange}
      />
      <PayrollDetailDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        title="Добавить выплату"
        description="Запись выданной зарплаты"
        footer={<div id="payroll-payment-footer" className={paymentStyle.footerSlot} />}
      >
        <PayrollPaymentForm onCancel={() => setPayOpen(false)}
          data={data}
          month={month}
          initialEmployeeId={employee.id}
          onDone={async () => {
            setPayOpen(false);
            await onChange();
          }}
        />
      </PayrollDetailDialog>
    </div>
  );
}

function Sum({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("text-base font-semibold tabular-nums", className)}>{children}</span>;
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function StaticLine({ title, note, amount }: { title: ReactNode; note: string; amount: ReactNode }) {
  return (
    <li className="flex items-center gap-3 border-t py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground tabular-nums">{note}</p>
      </div>
      <span className="shrink-0 text-sm font-medium tabular-nums">{amount}</span>
    </li>
  );
}

/** Статья начисления: закрыта по умолчанию, раскрывается в строки по дням. */
function GroupLine({ group }: { group: PaySheetGroup }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const id = useId();
  const visible = all ? group.items : group.items.slice(0, PREVIEW);
  return (
    <div className="border-t first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{group.label}</span>
          <span className="block truncate text-xs text-muted-foreground tabular-nums">
            {group.amount === null ? "Часть данных ещё не получена" : groupNote(group)}
          </span>
        </span>
        <span className="shrink-0 text-sm font-medium tabular-nums"><Money value={group.amount} /></span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <ul id={id} className="mb-3 rounded-lg bg-muted/60 px-3">
          {visible.map((item) => (
            <ItemLine key={item.key} item={item} />
          ))}
          {!all && group.items.length > PREVIEW && (
            <li className="border-t py-2">
              <button
                type="button"
                className="text-[13px] font-medium text-brand hover:underline"
                onClick={() => setAll(true)}
              >
                Показать все {group.items.length}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function ItemLine({ item }: { item: PaySheetItem }) {
  return (
    <li className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-baseline gap-3 border-t py-2 text-[13px] first:border-t-0">
      <span className="text-muted-foreground tabular-nums">{dayMonth(item.date)}</span>
      <span className="min-w-0">
        {item.title}
        {item.note && <span className="text-muted-foreground"> · {item.note}</span>}
      </span>
      <Money value={item.amount} />
    </li>
  );
}

/** Начислено по месяцам: столбики работают как быстрый переход к месяцу. */
function MonthBars({
  history,
  month,
  onMonth,
}: {
  history: { month: string; earned: number }[];
  month: string;
  onMonth: (month: string) => void;
}) {
  const max = Math.max(1, ...history.map((h) => h.earned));
  return (
    <div className="flex items-end gap-1.5" role="group" aria-label="Начислено по месяцам">
      {history.map((h) => {
        const active = monthKey(h.month) === monthKey(month);
        return (
          <button
            key={h.month}
            type="button"
            aria-pressed={active}
            aria-label={`${monthName(h.month)}: начислено ${formatRub(h.earned)}`}
            data-tip={`${monthName(h.month)}: ${formatRub(h.earned)}`}
            onClick={() => onMonth(h.month)}
            className="group flex w-9 flex-col items-center gap-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex h-9 w-full items-end">
              <span
                className={cn(
                  "w-full rounded-t",
                  active ? "bg-brand" : "bg-border group-hover:bg-muted-foreground/40",
                )}
                style={{ height: `${Math.max(8, Math.round((Math.max(0, h.earned) / max) * 100))}%` }}
              />
            </span>
            <span
              className={cn(
                "text-xs leading-none",
                active ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              {monthName(h.month, "short")}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Conditions({
  data,
  employee,
  month,
  canConfigure,
}: {
  data: PayrollData;
  employee: PayEmployee;
  month: string;
  canConfigure: boolean;
}) {
  const lastDay = new Date(new Date(`${shiftMonth(month, 1)}T12:00:00Z`).getTime() - 86400000)
    .toISOString()
    .slice(0, 10);
  const rule = attendanceRuleAtDate(data.attendanceRules ?? [], employee.id, lastDay);
  const withCode = Boolean(employee.casual && employee.quickresto_id !== null && employee.quickresto_pin);
  const fact =
    rule?.source === "excluded"
      ? "Не участвует в зарплатном учёте"
      : withCode || (!employee.casual && rule?.source !== "schedule")
        ? "По отметкам Quick Resto"
        : "По опубликованному графику";
  const tenureStart = data.settings?.experience_starts_on ?? data.experienceStartsOn;
  const role = data.roles?.find((r) => r.id === employee.role_id)?.name ?? employee.role_name;
  const rows: [string, ReactNode][] = [
    [
      "Должность",
      <>
        {role || "Не назначена"}
        <span className="block text-[13px] text-muted-foreground">
          Ставки и проценты заданы должностью.
          {canConfigure && employee.role_id && (
            <>
              {" "}
              <Link
                href={`/people/roles/${employee.role_id}?tab=compensation`}
                className="font-medium text-brand hover:underline"
              >
                Оплата должности
              </Link>
            </>
          )}
        </span>
      </>,
    ],
    ["Учёт выходов", fact],
    [
      "Надбавка за стаж",
      tenureStart ? `Начисляется с ${fullDate(tenureStart)} по шкале должности` : "Дата начала не назначена",
    ],
  ];
  if (employee.hired_on) rows.push(["Дата трудоустройства", fullDate(employee.hired_on)]);
  if (!employee.casual)
    rows.push([
      "Начальный остаток",
      employee.opening_confirmed ? <Money value={employee.opening_balance} /> : "Не указан",
    ]);
  return (
    <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-[minmax(140px,220px)_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-[13px] text-muted-foreground">{label}</dt>
          <dd className="-mt-2 text-sm tabular-nums sm:mt-0">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
