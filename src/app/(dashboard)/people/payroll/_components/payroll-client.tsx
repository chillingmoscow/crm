"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, RefreshCw, Wallet } from "lucide-react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { DateRangeFilter } from "@/components/shared/date-range-filter";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { TablePageHeader } from "@/components/shared/table";
import { cn } from "@/lib/utils";
import { blocksPayrollAttendance } from "@/lib/payroll/attendance";
import { statementRows } from "@/lib/payroll/calculate";
import type { PayrollData } from "@/lib/payroll/types";
import { money } from "@/lib/sales/format";
import { addDays } from "@/lib/sales/time";
import {
  loadPayroll,
  payrollCommand,
  refreshPayroll,
  cancelPayrollPayment,
} from "../actions";
import { PayrollTable } from "./payroll-table";
import { PaymentForm } from "./payment-form";
import { PayrollPaymentsTable } from "./payroll-payments-table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
type Statement = ReturnType<typeof statementRows>[number];
const labels = {
  employee: "Сотрудник",
  shifts: "Смены",
  earned: "Заработано",
  bonuses: "Премии",
  deductions: "Удержания",
  opening: "Перенос в этот месяц",
  paid: "Выплачено",
  transferredOut: "Перенесено далее",
  remaining: "К выплате",
  tips: "Чаевые",
};
const hiddenColumns = ["tips"];
const search = (r: Statement) => `${r.employee.name} ${r.employee.role_name}`;
export function PayrollClient({
  initial,
  initialMonth,
}: {
  initial: PayrollData;
  initialMonth?: string;
}) {
  const router = useRouter();
  const [data, setData] = useState(initial),
    [month, setMonth] = useState(
      initialMonth ??
        `${initial.settings?.starts_on.slice(0, 7) ?? "2026-09"}-01`,
    ),
    [busy, setBusy] = useState(false),
    [pay, setPay] = useState(false),
    [approvalOpen, setApprovalOpen] = useState(false),
    [activeTab, setActiveTab] = useState("statements");
  const manager = data.permissions.includes("payroll.view"),
    can = (s: string) => data.permissions.includes(`payroll.${s}`);
  const reload = useCallback(async () => {
    const next = await loadPayroll();
    if (next.venueId === initial.venueId) setData(next);
  }, [initial.venueId]);
  useEffect(() => {
    setData(initial);
    setMonth(initialMonth ?? initial.settings?.starts_on ?? "2026-09-01");
    setPay(false);
  }, [initial, initialMonth]);
  useEffect(() => {
    const timer = setInterval(
      () => {
        if (document.visibilityState === "visible")
          void reload().catch(() => {});
      },
      data.sources.some((s) => ["pending", "loading"].includes(s.state))
        ? 10000
        : 60000,
    );
    return () => clearInterval(timer);
  }, [data.sources, reload]);
  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await fn();
      await reload();
      toast.success(message);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Не удалось выполнить действие",
      );
    } finally {
      setBusy(false);
    }
  };
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
      ),
    [data, month],
  );
  const columns = useMemo<ColumnDef<Statement>[]>(
    () =>
      Object.entries(labels).map(([id, label]) =>
        id === "employee"
          ? {
              id,
              header: label,
              accessorFn: (r) => r.employee.name,
              cell: ({ row }) => (
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    {row.original.employee.name}
                    {!!row.original.issues && (
                      <AlertCircle
                        className="h-3.5 w-3.5 text-muted-foreground"
                        aria-label="Требует проверки"
                      />
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {row.original.employee.role_name}
                  </div>
                </div>
              ),
            }
          : {
              id,
              header: label,
              accessorFn: (r) =>
                id === "earned"
                  ? r.earned - r.bonuses + r.deductions
                  : r[id as keyof Omit<Statement, "employee">],
              cell: ({ row }) =>
                id === "shifts" ? (
                  row.original.shifts
                ) : ["paid", "remaining"].includes(id) &&
                  data.legacyPayments.some(
                    (p) =>
                      p.employee_id === row.original.employee.id &&
                      p.month === month &&
                      p.state === "review",
                  ) ? (
                  <span
                    className="text-muted-foreground"
                    title="Прежние выплаты ещё не внесены: откройте вкладку Выплаты"
                  >
                    —
                  </span>
                ) : (
                  <span
                    className={cn(
                      id === "remaining" && "font-semibold",
                      id === "opening" &&
                        !row.original.employee.opening_confirmed &&
                        "text-muted-foreground",
                    )}
                    title={
                      id === "opening" &&
                      !row.original.employee.opening_confirmed
                        ? "Нужно подтвердить долг или переплату на начало учёта: сотрудник → Оплата"
                        : undefined
                    }
                  >
                    {["opening", "remaining"].includes(id) &&
                    !row.original.employee.opening_confirmed
                      ? "—"
                      : id === "earned"
                        ? money(
                            row.original.earned -
                              row.original.bonuses +
                              row.original.deductions,
                          )
                        : money(
                            Number(
                              row.original[
                                id as keyof Omit<Statement, "employee">
                              ],
                            ),
                          )}
                  </span>
                ),
            },
      ),
    [data.legacyPayments, month],
  );
  const period = data.periods.find((p) => p.month === month),
    periodLabel =
      period?.status === "closed" ? "Месяц закрыт" : "Расчёт зафиксирован";
  const sums = rows.reduce(
    (s, r) => ({
      earned: s.earned + r.earned,
      paid: s.paid + r.paid,
      remaining: s.remaining + (r.employee.opening_confirmed ? r.remaining : 0),
      tips: s.tips + r.tips,
    }),
    { earned: 0, paid: 0, remaining: 0, tips: 0 },
  );
  const legacyRows = data.legacyPayments.filter(
    (p) => p.month === month && p.state === "review",
  );
  const unconfirmed = rows.filter((r) => !r.employee.opening_confirmed);
  const paymentStatus =
    sums.paid === 0
      ? "Выплаты не внесены"
      : sums.remaining > 0
        ? "Выплачено частично"
        : "Выплачено полностью";
  const next = new Date(`${month}T12:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const until = addDays(next.toISOString().slice(0, 10), -1);
  const sources = data.sources.filter(
      (s) => s.business_date >= month && s.business_date <= until,
    ),
    pending = sources.filter((s) => s.state !== "complete");
  const unreviewedExits = data.attendance.filter(
    (a) =>
      a.business_date >= month &&
      a.business_date <= until &&
      blocksPayrollAttendance(a),
  ).length;
  const unreviewedAccruals = data.accruals.filter(
    (a) =>
      a.business_date >= month &&
      a.business_date <= until &&
      (a.status === "review" || a.issues.length > 0),
  ).length;
  const missingSource =
    sources.length < Number(until.slice(-2)) || pending.length > 0;
  const canConfirm =
    period?.status !== "draft" ||
    (!unconfirmed.length &&
      !unreviewedExits &&
      !unreviewedAccruals &&
      !missingSource);
  const paymentRows = data.payments.filter((p) =>
    data.allocations.some((a) => a.payment_id === p.id && a.month === month),
  );
  const statementActions = (
    <>
      {can("sync") && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                disabled={busy}
                title="Ручное обновление: повторно получить данные Quick Resto за выбранный месяц. Данные также обновляются автоматически."
                onClick={() =>
                  void run(
                    () => refreshPayroll(month, until),
                    "Период поставлен на пересчёт",
                  )
                }
              >
                <RefreshCw
                  className={cn("mr-2 h-4 w-4", busy && "animate-spin")}
                />
                Обновить
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-72 font-normal">
              Данные обновляются автоматически. Нажмите, чтобы повторно
              загрузить выбранный месяц сейчас.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {can("approve") && period && period.status !== "closed" && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => setApprovalOpen(true)}
        >
          <Check className="mr-2 h-4 w-4" />
          Закрыть месяц
        </Button>
      )}
    </>
  );
  if (!manager && !data.employees.length)
    return (
      <div className="space-y-4 p-6">
        <TablePageHeader title="Моя зарплата" />
        <p className="text-sm text-muted-foreground">
          Условия оплаты ещё не настроены. Управляющий должен связать вашу
          карточку с расчётом зарплаты.
        </p>
      </div>
    );
  return (
    <div className="min-w-0 space-y-6 p-4 md:p-6">
      <TablePageHeader title={manager ? "Зарплата" : "Моя зарплата"} />
      <div className="grid gap-3 lg:flex lg:flex-wrap lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <DateRangeFilter
            monthOnly
            ariaLabel="Месяц ведомости"
            value={{ start: new Date(`${month}T12:00:00`), end: null }}
            minDate={
              data.settings
                ? new Date(`${data.settings.starts_on}T12:00:00`)
                : undefined
            }
            presetLabel={null}
            onChange={(value) => {
              if (value.start) {
                const nextMonth = `${value.start.getFullYear()}-${String(value.start.getMonth() + 1).padStart(2, "0")}`;
                setMonth(`${nextMonth}-01`);
                router.replace(`/people/payroll?month=${nextMonth}`, {
                  scroll: false,
                });
              }
            }}
          />
          {period && period.status !== "draft" && (
            <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground whitespace-nowrap">
              {periodLabel} · {paymentStatus}
            </span>
          )}
        </div>
        <div
          id="payroll-table-controls"
          className="min-h-24 min-w-0 sm:min-h-10"
        />
      </div>
      {manager && (!sources.length || pending.length > 0) && (
        <div className="flex items-start gap-2 rounded-lg border p-3 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            {sources.length
              ? `Проверка источника: ${sources.filter((s) => s.state === "complete").length} дней готовы, ${pending.length} ожидают обработки.`
              : "За этот месяц источник ещё не загружен."}
            {pending.find((s) => s.error) && (
              <p className="mt-1 text-muted-foreground">
                {pending.find((s) => s.error)?.error}
              </p>
            )}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 overflow-hidden rounded-xl border lg:grid-cols-4">
        {[
          ["Начислено за месяц", sums.earned],
          ["Выплачено", legacyRows.length ? null : sums.paid],
          [
            "К выплате",
            unconfirmed.length || legacyRows.length ? null : sums.remaining,
          ],
          ["Чаевые · отдельно от зарплаты", sums.tips],
        ].map(([label, value], index) => (
          <div
            key={label}
            className={cn(
              "p-4",
              index < 2 && "border-b lg:border-b-0",
              index % 2 === 0 && "border-r",
              index === 1 && "lg:border-r",
            )}
          >
            <div className="text-xs text-muted-foreground">{label}</div>
            <div
              className={cn(
                "mt-2 font-semibold tabular-nums",
                value === null ? "text-base" : "text-xl",
              )}
            >
              <span
                title={
                  value === null
                    ? label === "Выплачено" || !unconfirmed.length
                      ? "Прежние выплаты требуют сверки в настройках заведения → Оплата труда → Первоначальные данные по зарплате"
                      : "Укажите начальный долг или переплату в условиях оплаты сотрудника"
                    : undefined
                }
              >
                {value === null ? "—" : money(Number(value))}
              </span>{" "}
              {value !== null && (
                <span className="text-sm font-normal text-muted-foreground">
                  ₽
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="statements">Ведомость</TabsTrigger>
          <TabsTrigger value="payments">Выплаты</TabsTrigger>
        </TabsList>
        <TabsContent value="statements" className="mt-4">
          <PayrollTable
            id={`payroll.simple.${data.venueId}`}
            hiddenColumns={hiddenColumns}
            rows={rows}
            columns={columns}
            labels={labels}
            numeric={Object.keys(labels).filter((k) => k !== "employee")}
            searchText={search}
            toolbarTargetId="payroll-table-controls"
            onRow={(r) =>
              router.push(
                `/people/payroll/${r.employee.id}?month=${month.slice(0, 7)}`,
              )
            }
            actions={statementActions}
          />
        </TabsContent>
        <TabsContent value="payments" className="mt-4 space-y-3">
          <p className="max-w-3xl text-sm text-muted-foreground">
            Здесь записывается фактически выданная зарплата, авансы и выдача
            чаевых. Зарплатные выплаты уменьшают остаток в ведомости и создают
            расход в финансах. Перевод в банке выполняется отдельно.
          </p>
          <PayrollPaymentsTable
            data={data}
            payments={paymentRows}
            busy={busy}
            onCancel={(id) =>
              run(
                () => cancelPayrollPayment(id),
                "Выплата отменена, задолженность восстановлена",
              )
            }
            actions={
              can("pay") ? (
                <Button disabled={busy} onClick={() => setPay(true)}>
                  <Wallet className="mr-2 h-4 w-4" />
                  Добавить выплату
                </Button>
              ) : null
            }
          />
        </TabsContent>
      </Tabs>
      <Dialog open={approvalOpen} onOpenChange={setApprovalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Закрыть месяц</DialogTitle>
            <DialogDescription>
              {period?.status === "draft"
                ? "Закрытие сохраняет окончательные суммы. Выплаты можно записывать и до, и после закрытия. Невыплаченный остаток останется в этом месяце до выплаты или ручного переноса."
                : "Закрытие завершает работу с расчётом месяца. Невыплаченный долг сохраняется; исправления оформляются в открытом месяце."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            {period?.status === "draft" && (
              <>
                <p className="font-medium">Перед закрытием месяца</p>
                <ul className="list-disc space-y-2 pl-5">
                  <li>
                    Если есть незакрытые или неоднозначные выходы Quick Resto,
                    проверьте их в{" "}
                    <Link
                      href="/schedule/attendance"
                      onClick={() => setApprovalOpen(false)}
                      className="text-brand hover:underline"
                    >
                      табеле смен сотрудников
                    </Link>
                    .
                  </li>
                  <li>
                    Проверьте начисления, премии и удержания в карточках
                    сотрудников.
                  </li>
                  <li>
                    Подтвердите начальные долги и переплаты: сотрудник →
                    «Оплата».
                  </li>
                </ul>
                {!canConfirm && (
                  <div className="space-y-1 rounded-lg bg-muted p-3">
                    <p className="font-medium">Сначала завершите проверку</p>
                    {unconfirmed.length > 0 && (
                      <p>
                        У {unconfirmed.length} сотрудников не подтверждён
                        начальный остаток.
                      </p>
                    )}
                    {unreviewedExits > 0 && (
                      <p>
                        Нужно проверить {unreviewedExits} отметок выхода в
                        табеле.
                      </p>
                    )}
                    {unreviewedAccruals > 0 && (
                      <p>
                        В {unreviewedAccruals} дневных расчётах есть вопросы.
                        Причины видны в карточке сотрудника.
                      </p>
                    )}
                    {missingSource && (
                      <p>Дождитесь загрузки всех дней месяца.</p>
                    )}
                  </div>
                )}
              </>
            )}
            <p className="text-muted-foreground">
              Это действие не создаёт выплату. Исправления закрытого месяца
              оформляются отдельной корректировкой.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApprovalOpen(false)}>
              Отмена
            </Button>
            <Button
              disabled={busy || !canConfirm}
              onClick={() => {
                if (!period) return;
                void run(
                  async () => {
                    await payrollCommand("period", {
                      id: period.id,
                      version: period.version,
                      status: "closed",
                    });
                    setApprovalOpen(false);
                  },
                  period.status === "draft" ? "Месяц закрыт" : "Месяц закрыт",
                );
              }}
            >
              Закрыть месяц
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <EditDrawer
        open={pay}
        onOpenChange={setPay}
        title="Добавить выплату"
        description="Запись выданной зарплаты или аванса создаст расход и уменьшит долг перед сотрудниками"
      >
        <PaymentForm
          data={data}
          month={month}
          onDone={async () => {
            setPay(false);
            await reload();
          }}
        />
      </EditDrawer>
    </div>
  );
}
