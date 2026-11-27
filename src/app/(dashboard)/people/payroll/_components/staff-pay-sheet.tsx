"use client";

import { useExitValue } from "@/hooks/use-exit-value";
import { useId, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Download, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MonthPicker } from "@/components/shared/month-picker";
import { PeriodStepper } from "@/components/shared/period-stepper";
import { ProfileSection } from "@/components/shared/profile-section";
import { Money, formatRub } from "@/components/shared/money";
import { toKopecks } from "@/lib/format/amount";
import { StatusBadge } from "@/components/ui/status-badge";
import { countRu } from "@/lib/format/plural";
import { accrualRole, isShiftAccrual, shiftSalary } from "@/lib/payroll/accrual-view";
import { attendanceRuleAtDate } from "@/lib/payroll/attendance";
import { statementRows } from "@/lib/payroll/calculate";
import { officialExpectedNote, officialPartLabel, officialPaymentLabel } from "@/lib/payroll/official";
import {
  buildPaySheet,
  monthKey,
  payMonthHistory,
  paySheetPayments,
  shiftMonth,
  type PaySheetGroup,
  type PaySheetItem,
} from "@/lib/payroll/pay-sheet";
import type { PayEmployee, PayrollData, PayrollTransfer } from "@/lib/payroll/types";
import { downloadPayslip as savePayslip } from "./payslip-download";
import { cn } from "@/lib/utils";
import { PayrollEntryForm, PayrollJournal } from "@/app/(dashboard)/people/payroll/_components/payroll-journal";
import { paymentJournalRows } from "@/lib/payroll/payment-journal";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { cancelPayrollPayment, cancelPayrollTransfer } from "../actions";
import { unwrapAction } from "@/lib/actions/result";
import { PaymentDetails } from "./payroll-payments-table";
import { PayrollTransferDrawer } from "./payroll-transfer-drawer";
import { PayrollPaymentForm } from "@/app/(dashboard)/people/payroll/_components/payroll-payment-form";
import paymentStyle from "@/app/(dashboard)/people/payroll/_components/payroll-payment-form.module.css";
import { EmployeeConditionDrawer, type ConditionMode } from "./employee-pay-conditions";
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

/** «сентября», «ноября»: месяц в родительном падеже, для «из …». */
const monthGenitive = (month: string) =>
  new Date(`${monthKey(month)}-01T12:00:00Z`)
    .toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" })
    .replace(/^\d+\s*/, "");

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
  context = "staff",
}: {
  data: PayrollData;
  employee: PayEmployee;
  /** Где открыт лист: в карточке сотрудника или в разделе «Зарплата». */
  context?: "staff" | "payroll";
  /** Первое число выбранного месяца. */
  month: string;
  minMonth: string;
  maxMonth: string;
  onMonth: (month: string) => void;
  onChange: () => Promise<void>;
}) {
  const [condition, setCondition] = useState<ConditionMode | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [dayId, setDayId] = useState<string | null>(null);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [cancelPayment, setCancelPayment] = useState<string | null>(null);
  const [cancelTransfer, setCancelTransfer] = useState<PayrollTransfer | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryKind, setEntryKind] = useState<"deduction" | "allowance">("deduction");
  const [downloading, setDownloading] = useState(false);

  async function downloadPayslip() {
    setDownloading(true);
    try {
      await savePayslip(data, employee, month);
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
    data.officialExpected ?? [],
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
    tipPaid = row?.tipPaid ?? 0,
    official = row?.officialExpected ?? null;
  // Официальную часть выплатит бухгалтерия: в «из N» её нет, как и в «К выплате».
  const owed = opening + earned - transferredOut - (official?.amount ?? 0);
  const legacyPending = data.legacyPayments.some(
    (p) => p.employee_id === employee.id && monthKey(p.month) === monthKey(month) && p.state === "review",
  );
  const issues = [
    ...new Set(
      mine.filter((a) => a.business_date.startsWith(monthKey(month))).flatMap((a) => a.issues),
    ),
  ];
  // Переносы, которые касаются этого месяца: пришедшие в него и ушедшие из него.
  const transfers = data.transfers
    .filter(
      (t) =>
        t.employee_id === employee.id &&
        t.state === "posted" &&
        (monthKey(t.from_month) === monthKey(month) || monthKey(t.to_month) === monthKey(month)),
    )
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const empty =
    !sheet.groups.length && !sheet.deductions.length && !payments.length && !owed && !tips;

  const paymentRows = useMemo(
    () => paymentJournalRows(data, data.payments.filter((p) => payments.some((x) => x.id === p.id))),
    [data, payments],
  );
  const paymentRow = paymentRows.find((r) => r.id === paymentId);
  // Панели держим смонтированными, пока они уезжают (docs/motion.md).
  const shownPaymentRow = useExitValue(paymentRow);
  const shownCondition = useExitValue(condition);
  const shownTransfer = useExitValue(transferOpen);
  const day = mine.find((a) => a.id === dayId) ?? null;

  /** Строка листа ведёт к записи (премия, штраф) или к расчёту дня. */
  function openItem(item: PaySheetItem) {
    if (item.manual) {
      const entry = data.adjustments.find(
        (a) =>
          a.employee_id === employee.id &&
          !a.deleted_at &&
          a.kind === item.kind &&
          a.reason === item.title &&
          toKopecks(Number(a.amount)) === toKopecks(item.amount ?? 0) &&
          monthKey(a.business_date) === monthKey(month),
      );
      if (entry) return setEntryId(entry.id);
    }
    setDayId(item.accrualId);
  }

  async function confirmCancel() {
    setCancelBusy(true);
    try {
      if (cancelPayment) unwrapAction(await cancelPayrollPayment(cancelPayment));
      if (cancelTransfer) unwrapAction(await cancelPayrollTransfer(cancelTransfer.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось отменить");
      setCancelBusy(false);
      return;
    }
    toast.success(cancelPayment ? "Выплата удалена" : "Перенос отменён");
    setCancelPayment(null);
    setCancelTransfer(null);
    try { await onChange(); } catch { /* Обновится при следующем автообновлении. */ }
    finally { setCancelBusy(false); }
  }

  const addItems = [
    canPay && <DropdownMenuItem key="pay" onSelect={() => setPayOpen(true)}>Выплата</DropdownMenuItem>,
    canReview && <DropdownMenuItem key="deduction" onSelect={() => openEntry("deduction")}>Премия / штраф</DropdownMenuItem>,
    canReview && <DropdownMenuItem key="allowance" onSelect={() => openEntry("allowance")}>Надбавка за месяц</DropdownMenuItem>,
    canReview && <DropdownMenuSeparator key="sep" />,
    canReview && <DropdownMenuItem key="transfer" onSelect={() => setTransferOpen(true)}>Перенести остаток</DropdownMenuItem>,
  ].filter(Boolean);
  const addMenu = addItems.length ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="h-9">
          <Plus />
          Добавить
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">{addItems}</DropdownMenuContent>
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
              {!legacyPending && toKopecks(remaining) < 0 ? `Переплата за ${name}` : `К выплате за ${name}`}
            </h2>
            <p className="mt-1 text-[28px] font-semibold leading-tight tracking-tight tabular-nums">
              <Money value={legacyPending ? null : Math.abs(toKopecks(remaining))} fraction="auto" />
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
        {legacyPending ? (
          <p className="text-[13px] text-muted-foreground">
            Есть несверенные выплаты из прежнего учёта. Пока это так, остаток не показывается.
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
              {legacyPending || owed <= 0
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
        {(transfers.length > 0 || official) && (
          <dl className="grid gap-2 border-t pt-3 text-[13px]">
            {transfers.map((t) => {
              const incoming = monthKey(t.to_month) === monthKey(month);
              return (
                <div key={t.id} className="flex items-center justify-between gap-4">
                  <dt className="flex min-w-0 flex-wrap items-center gap-x-2 text-muted-foreground">
                    <span>{incoming ? `Перенос из ${monthGenitive(t.from_month)}` : `Перенос на ${monthName(t.to_month)}`}</span>
                    {canReview && (
                      <button
                        type="button"
                        className="text-xs font-medium text-brand hover:underline"
                        onClick={() => setCancelTransfer(t)}
                      >
                        Отменить
                      </button>
                    )}
                  </dt>
                  <dd className="shrink-0 tabular-nums">
                    <Money value={incoming ? Number(t.amount) : -Number(t.amount)} signed fraction="auto" />
                  </dd>
                </div>
              );
            })}
            {official && (
              <div className="flex justify-between gap-4">
                <dt>
                  <span className="text-muted-foreground">{officialPartLabel(official.agency)}</span>
                  {official.amount !== null && (
                    <span className="block text-xs text-muted-foreground">
                      {officialExpectedNote(official, month)}
                    </span>
                  )}
                </dt>
                <dd className="shrink-0 tabular-nums">
                  {official.amount === null ? (
                    <span className="text-muted-foreground">{officialExpectedNote(official, month)}</span>
                  ) : (
                    <Money value={-official.amount} signed fraction="auto" />
                  )}
                </dd>
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
                  <GroupLine key={`${month}.${group.id}`} group={group} onItem={openItem} />
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
                    onOpen={() => openItem(item)}
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
                    onOpen={paymentRows.some((r) => r.id === p.id) ? () => setPaymentId(p.id) : undefined}
                    title={
                      <>
                        {p.kind === "advance" ? "Аванс" : "Зарплата"}
                        {p.official && (
                          <StatusBadge tone="info" className="ml-2">{officialPaymentLabel(p.agency)}</StatusBadge>
                        )}
                        {!p.posted && (
                          <StatusBadge className="ml-2">Удалена</StatusBadge>
                        )}
                      </>
                    }
                    note={`${new Intl.DateTimeFormat("ru-RU", { timeZone: data.timezone }).format(
                      new Date(p.date),
                    )}${p.tax > 0 ? ` · налог ${formatRub(p.tax, { fraction: "auto" })}` : ""}`}
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

      <ProfileSection title="Условия оплаты">
        <Conditions
          data={data}
          employee={employee}
          month={month}
          canConfigure={canConfigure}
          context={context}
          onEdit={setCondition}
        />
      </ProfileSection>

      {shownCondition && (
        <EmployeeConditionDrawer
          key={shownCondition}
          open={!!condition}
          data={data}
          employee={employee}
          month={month}
          mode={shownCondition}
          onClose={() => setCondition(null)}
          onChange={onChange}
        />
      )}
      <PayrollDetailDialog
        open={Boolean(day)}
        onOpenChange={(open) => { if (!open) setDayId(null); }}
        title={day?.calculation_snapshot.kind === "monthly" ? "Оклад за месяц" : day && !isShiftAccrual(day) ? "Начисления за месяц" : "Расчёт смены"}
        description={day ? fullDate(day.business_date) : ""}
        employee={{ name: employee.name, role: day ? accrualRole(day, employee.role_name, data) : employee.role_name, avatarUrl: employee.avatar_url }}
        amount={day ? <Money value={isShiftAccrual(day) ? shiftSalary(day) : Number(day.salary)} /> : undefined}
        amountLabel="Начислено"
      >
        {day && (
          <div className="flex flex-col">
            {isShiftAccrual(day) && (
              <p className="mb-2 text-xs text-muted-foreground">
                {day.calculation_snapshot.source === "schedule" ? "Выход по опубликованному графику" : "Выход по отметке Quick Resto"}
              </p>
            )}
            {day.components
              .filter((c) => c.kind !== "tips" && (!isShiftAccrual(day) || c.kind !== "monthly"))
              .map((c, i) => (
                <div key={i} className="flex justify-between gap-5 border-b py-3 text-sm last:border-b-0">
                  <div className="min-w-0">
                    <p className="font-medium">{c.label}</p>
                    {c.basis && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.basis}</p>}
                  </div>
                  <strong className="shrink-0 font-medium tabular-nums"><Money value={c.amount} /></strong>
                </div>
              ))}
            {day.issues.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[13px]">
                <p className="font-medium">Замечания к расчёту</p>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {day.issues.map((issue) => <li key={issue}>{issue}</li>)}
                </ul>
              </div>
            )}
            <p className="mt-5 text-xs text-muted-foreground">
              Сохранённый расчёт · {new Date(day.updated_at).toLocaleString("ru-RU", { timeZone: data.timezone })}
            </p>
          </div>
        )}
      </PayrollDetailDialog>
      <PayrollJournal
        drawerOnly
        data={data}
        month={month}
        employeeId={employee.id}
        openId={entryId}
        onOpenIdChange={setEntryId}
        onChange={onChange}
      />
      {shownPaymentRow && (
        <PaymentDetails
          key={`${shownPaymentRow.id}:${shownPaymentRow.posted}`}
          open={!!paymentRow}
          row={shownPaymentRow}
          data={data}
          busy={cancelBusy}
          onClose={() => setPaymentId(null)}
          onCancel={() => {
            setPaymentId(null);
            setCancelPayment(shownPaymentRow.id);
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(cancelPayment) || Boolean(cancelTransfer)}
        onOpenChange={(open) => {
          if (!open && !cancelBusy) {
            setCancelPayment(null);
            setCancelTransfer(null);
          }
        }}
        title={cancelPayment ? "Удалить выплату?" : "Отменить перенос?"}
        description={
          cancelPayment
            ? "Финансовая операция будет помечена удалённой, а сумма вернётся в остаток к выплате сотруднику."
            : cancelTransfer
              ? `${formatRub(Math.abs(Number(cancelTransfer.amount)), { fraction: "auto" })} вернутся из ${monthGenitive(cancelTransfer.to_month)} в ${monthName(cancelTransfer.from_month)}. Движения денег не будет.`
              : undefined
        }
        confirmLabel={cancelPayment ? "Удалить выплату" : "Отменить перенос"}
        pendingLabel={cancelPayment ? "Удаляем…" : "Отменяем…"}
        destructive
        busy={cancelBusy}
        onConfirm={() => void confirmCancel()}
      />
      {shownTransfer && (
        <PayrollTransferDrawer
          open={transferOpen}
          data={data}
          month={month}
          employeeId={employee.id}
          onClose={() => setTransferOpen(false)}
          onChange={onChange}
        />
      )}
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

function StaticLine({ title, note, amount, onOpen }: { title: ReactNode; note: string; amount: ReactNode; onOpen?: () => void }) {
  const content = (
    <>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground tabular-nums">{note}</p>
      </div>
      <span className="shrink-0 text-sm font-medium tabular-nums">{amount}</span>
    </>
  );
  return (
    <li className="border-t first:border-t-0">
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {content}
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </button>
      ) : (
        <div className="flex items-center gap-3 py-3">{content}</div>
      )}
    </li>
  );
}

/** Статья начисления: закрыта по умолчанию, раскрывается в строки по дням. */
function GroupLine({ group, onItem }: { group: PaySheetGroup; onItem: (item: PaySheetItem) => void }) {
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
            <ItemLine key={item.key} item={item} onOpen={() => onItem(item)} />
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

function ItemLine({ item, onOpen }: { item: PaySheetItem; onOpen: () => void }) {
  return (
    <li className="border-t first:border-t-0">
      <button
        type="button"
        onClick={onOpen}
        className="-mx-3 grid w-[calc(100%+1.5rem)] grid-cols-[2.75rem_minmax(0,1fr)_auto] items-baseline gap-3 px-3 py-2 text-left text-[13px] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="text-muted-foreground tabular-nums">{dayMonth(item.date)}</span>
        <span className="min-w-0">
          {item.title}
          {item.note && <span className="text-muted-foreground"> · {item.note}</span>}
        </span>
        <Money value={item.amount} />
      </button>
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
  context,
  onEdit,
}: {
  data: PayrollData;
  employee: PayEmployee;
  month: string;
  canConfigure: boolean;
  context: "staff" | "payroll";
  onEdit: (mode: ConditionMode) => void;
}) {
  const lastDay = new Date(new Date(`${shiftMonth(month, 1)}T12:00:00Z`).getTime() - 86400000)
    .toISOString()
    .slice(0, 10);
  const rule = attendanceRuleAtDate(data.attendanceRules ?? [], employee.id, lastDay);
  const withCode = Boolean(employee.casual && employee.quickresto_id !== null && employee.quickresto_pin);
  const fact =
    rule?.source === "excluded"
      ? "Не участвует в зарплатном учёте"
      : withCode
        ? `По отметкам Quick Resto · PIN ${employee.quickresto_pin}`
        : !employee.casual && rule?.source !== "schedule"
          ? "По отметкам Quick Resto"
          : "По опубликованному графику";
  const factNote =
    rule?.source === "excluded"
      ? "Начисления за работу отключены, прежняя история сохраняется."
      : withCode
        ? "Нет отметки — смена засчитывается по графику."
        : employee.casual
          ? "Завершённая смена в графике считается отработанной."
          : rule?.source === "schedule"
            ? "Завершённая смена в графике считается отработанной."
            : "График задаёт план, отметка на кассе подтверждает выход.";
  const tenureStart = data.settings?.experience_starts_on ?? data.experienceStartsOn;
  const role = data.roles?.find((r) => r.id === employee.role_id)?.name ?? employee.role_name;
  const link = "text-[13px] font-medium text-brand hover:underline";
  const rows: { label: string; value: ReactNode; note?: ReactNode; action?: ReactNode }[] = [
    {
      label: "Должность",
      // Название должности ведёт в её оплату — кликабельное имя (design-system),
      // а не отдельная ссылка «Оплата должности». Одно действие на строку —
      // «Изменить» (Павел, 26.11: «много кнопок»).
      value: employee.role_id && role ? (
        <Link
          href={`/people/roles/${employee.role_id}?tab=compensation`}
          className="transition-colors hover:text-brand"
          data-tip="Оплата должности"
        >
          {role}
        </Link>
      ) : (role || "Не назначена"),
      note: "Ставки и проценты заданы должностью.",
      action:
        canConfigure && !employee.local_user_id ? (
          <button type="button" className={link} onClick={() => onEdit("model")}>Изменить</button>
        ) : canConfigure && employee.local_user_id && context === "payroll" ? (
          <Link href={`/people/staff/${employee.local_user_id}`} className={link} data-tip="Должность меняется в карточке сотрудника">Изменить</Link>
        ) : null,
    },
    {
      label: "Учёт выходов",
      value: fact,
      note: factNote,
      action:
        canConfigure && !employee.casual ? (
          <button type="button" className={link} onClick={() => onEdit("attendance")}>Изменить</button>
        ) : null,
    },
    {
      label: "Надбавка за стаж",
      value: tenureStart ? `С ${fullDate(tenureStart)}` : "Дата начала не назначена",
      note: "Сумма за выход — по шкале должности.",
    },
  ];
  if (employee.hired_on) rows.push({ label: "Дата приёма", value: fullDate(employee.hired_on) });
  return (
    <dl className="flex flex-col">
      {rows.map((row) => (
        <div key={row.label} className="flex items-start gap-4 border-t py-3 first:border-t-0 first:pt-0 last:pb-0">
          <dt className="w-36 shrink-0 text-[13px] text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0 flex-1 text-sm">
            {row.value}
            {row.note && <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{row.note}</span>}
          </dd>
          {row.action && <span className="shrink-0">{row.action}</span>}
        </div>
      ))}
    </dl>
  );
}
