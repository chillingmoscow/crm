"use client";
import { useMemo, useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { statementRows } from "@/lib/payroll/calculate";
import { componentAmount, shiftSalary, accrualOtherAmount, isShiftAccrual, accrualRole, componentLabels } from "@/lib/payroll/accrual-view";
import type { PayrollData, PayEmployee, Accrual } from "@/lib/payroll/types";
import { PayrollDetailDialog } from "./payroll-detail-dialog";
import { PayrollTable } from "./payroll-table";
import { PayrollPaymentsTable } from "./payroll-payments-table";
import { EmployeePayConditions } from "./employee-pay-conditions";
import { cancelPayrollPayment } from "../actions";
import { PayrollJournal, PayrollEntryForm } from "@/app/payroll-concept/payroll-journal";
import { ConceptPaymentForm } from "@/app/payroll-concept/concept-payment-form";
import paymentStyle from "@/app/payroll-concept/concept-payment-form.module.css";
import s from "./employee-pay.module.css";
import tabStyle from "@/components/shared/workspace-tabs.module.css";
export const selectClass = "h-10 w-full rounded-md border bg-background px-3 text-base md:text-sm";
const rub = (n: number | null) => n === null ? "Нет данных" : `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(n)} ₽`;
const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("ru-RU", { timeZone: "UTC" });
const labels = { date: "Дата", role: "Должность", base: "Выход", percent: "Процент", extra: "Допродажи", other: "Надбавки и прочее", salary: "Начислено", tips: "Чаевые" };
const numeric = ["base", "percent", "extra", "other", "salary", "tips"];
const hidden = ["tips"];
export function EmployeePay({ data, employee, month, onChange, fullPage = false, conditionsOpen, onConditionsOpenChange }: {
    data: PayrollData;
    employee: PayEmployee;
    month: string;
    onChange: () => Promise<void>;
    fullPage?: boolean;
    conditionsOpen?: boolean;
    onConditionsOpenChange?: (open: boolean) => void;
}) {
    const controlsId = fullPage ? "employee-payroll-controls" : `employee-inline-controls-${employee.id}`;
    const [tab, setTab] = useState("shifts");
    const [detail, setDetail] = useState<Accrual | null>(null);
    const [breakdown, setBreakdown] = useState(false);
    const [ownConditions, setOwnConditions] = useState(false);
    const [payOpen, setPayOpen] = useState(false);
    const [entryKind, setEntryKind] = useState<"deduction" | "allowance">("deduction");
    const [entryOpen, setEntryOpen] = useState(false);
    const [query, setQuery] = useState("");
    const accruals = useMemo(() => data.accruals.filter(a => a.employee_id === employee.id && a.business_date.startsWith(month.slice(0, 7))), [data.accruals, employee.id, month]);
    const shifts = useMemo(() => accruals.filter(isShiftAccrual), [accruals]);
    const row = statementRows([employee], data.accruals, data.adjustments, data.payments, data.allocations, month, data.transfers, data.settings?.starts_on)[0];
    const pending = data.legacyPayments.some(p => p.employee_id === employee.id && p.month === month && p.state === "review");
    const canReview = data.permissions.includes("payroll.review"), canPay = data.permissions.includes("payroll.pay") && data.permissions.includes("finance.create_transaction");
    const setConditions = onConditionsOpenChange ?? setOwnConditions;
    const sums = new Map<string, number | null>();
    for (const a of accruals)
        for (const c of a.components) {
            if (c.kind === "tips")
                continue;
            const label = (c.amount ?? 0) < 0 ? "Удержания" : componentLabels[c.kind] ?? c.label;
            const before = sums.get(label);
            sums.set(label, c.amount === null || before === null ? null : (before ?? 0) + Number(c.amount));
        }
    const payments = useMemo(() => data.payments.filter(p => data.allocations.some(a => a.payment_id === p.id && a.employee_id === employee.id && a.month === month)), [data.payments, data.allocations, employee.id, month]);
    const paymentData = useMemo(() => ({ ...data, financeTransactions: [] }), [data]);
    const columns = useMemo<ColumnDef<Accrual>[]>(() => [
        { id: "date", header: "Дата", accessorFn: a => a.business_date, cell: ({ row }) => <button type="button" className="w-full text-left" aria-label={`Расчёт за ${row.original.business_date}`} onClick={event => { event.stopPropagation(); setDetail(row.original); }}>{dateLabel(row.original.business_date)}</button> },
        { id: "role", header: "Должность", accessorFn: a => accrualRole(a, employee.role_name, data), cell: ({ row }) => <span className="block whitespace-normal text-xs">{accrualRole(row.original, employee.role_name, data)}</span> },
        ...([["base", ["base"]], ["percent", ["percent"]], ["extra", ["extra"]]] as const).map(([id, kinds]) => ({ id, header: labels[id], accessorFn: (a: Accrual) => componentAmount(a.components, [...kinds]), cell: ({ row }: {
                row: {
                    original: Accrual;
                };
            }) => rub(componentAmount(row.original.components, [...kinds])) })),
        { id: "other", header: labels.other, accessorFn: accrualOtherAmount, cell: ({ row }) => rub(accrualOtherAmount(row.original)) },
        { id: "salary", header: "Начислено", accessorFn: shiftSalary, cell: ({ row }) => <button type="button" className={s.totalCell} aria-label={`Состав начисления за ${row.original.business_date}`} onClick={event => { event.stopPropagation(); setDetail(row.original); }}><strong>{rub(shiftSalary(row.original))}</strong><ChevronRight size={13}/></button> },
        { id: "tips", header: "Чаевые", accessorFn: a => a.tips, cell: ({ row }) => rub(row.original.tips) },
    ], [employee.role_name, data]);
    const issues = [...new Set(accruals.flatMap(a => a.issues))];
    const actions = (canPay || canReview) ? <DropdownMenu><DropdownMenuTrigger asChild><Button><Plus />Добавить</Button></DropdownMenuTrigger><DropdownMenuContent align="end">{canPay && <DropdownMenuItem onSelect={() => setPayOpen(true)}>Выплата</DropdownMenuItem>}{canReview && <><DropdownMenuItem onSelect={() => { setEntryKind("allowance"); setEntryOpen(true); }}>Надбавка за месяц</DropdownMenuItem><DropdownMenuItem onSelect={() => { setEntryKind("deduction"); setEntryOpen(true); }}>Премия / штраф</DropdownMenuItem></>}</DropdownMenuContent></DropdownMenu> : undefined;
    return <div className={s.workspace}>
  <div className={s.stats}>
   <button aria-label="Показать начисления за месяц" onClick={() => setBreakdown(true)}><span>Начислено<ChevronRight size={16}/></span><strong>{rub(row?.earned ?? 0)}</strong></button>
   <button onClick={() => setTab("payments")}><span>Выплачено<ChevronRight size={16}/></span><strong>{pending ? "—" : rub(row?.paid ?? 0)}</strong></button>
   <div><span>Осталось выплатить</span><strong>{pending || !employee.opening_confirmed ? "—" : rub(row?.remaining ?? 0)}</strong></div>
   <div><span>Чаевые</span><strong>{rub(row?.tips ?? 0)}</strong></div>
  </div>
  <div className={s.meta}><span>{shifts.length} смен{shifts.length > 0 ? ` · В среднем ${rub((row?.earned ?? 0) / shifts.length)} за смену` : ""}</span>{!fullPage && <Button variant="ghost" size="sm" onClick={() => setConditions(true)}>Условия сотрудника</Button>}</div>
  {!fullPage && <div id={controlsId} className={s.controls}/>}
  <Tabs value={tab} onValueChange={setTab} className={tabStyle.tabs}>
   <TabsList aria-label="Расчёт сотрудника"><TabsTrigger value="shifts">Смены</TabsTrigger><TabsTrigger value="entries">Начисления и удержания</TabsTrigger><TabsTrigger value="payments">Выплаты</TabsTrigger></TabsList>
   <TabsContent value="shifts"><PayrollTable id={`employee-shifts-v2-${employee.id}`} rows={shifts} columns={columns} labels={labels} numeric={numeric} hiddenColumns={hidden} defaultSort="date" defaultSortDesc scrollMode="page" minWidth={880} searchText={a => `${a.business_date} ${accrualRole(a, employee.role_name, data)}`} onRow={setDetail} toolbarTargetId={controlsId} actions={actions}/>{!shifts.length && accruals.length > 0 && <Button variant="link" onClick={() => setBreakdown(true)}>Посмотреть начисления за месяц</Button>}</TabsContent>
   <TabsContent value="entries"><PayrollJournal data={data} month={month} employeeId={employee.id} query={query} onQuery={setQuery} onChange={onChange} toolbarTargetId={controlsId}/></TabsContent>
   <TabsContent value="payments"><PayrollPaymentsTable data={paymentData} payments={payments} busy={false} actions={canPay ? <Button onClick={() => setPayOpen(true)}><Plus />Добавить выплату</Button> : null} toolbarTargetId={controlsId} tableId={`employee-payments-${employee.id}`} scrollMode="page" onCancel={async (id) => { await cancelPayrollPayment(id); await onChange(); }}/></TabsContent>
  </Tabs>
  <PayrollDetailDialog open={breakdown} onOpenChange={setBreakdown} title="Начисления за месяц" description={new Date(`${month}T12:00:00Z`).toLocaleDateString("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" })} employee={{ name: employee.name, role: employee.role_name, avatarUrl: employee.avatar_url }} amount={rub(row?.earned ?? 0)} amountLabel="Всего начислено">
   {[...sums].map(([label, value]) => <div key={label} className={s.breakdown}><span>{label}</span><strong>{rub(value)}</strong></div>)}
   <div className={s.breakdown}><span>Перенос в этот месяц</span><strong>{employee.opening_confirmed ? rub(row?.opening ?? 0) : "—"}</strong></div>
   {!!row?.transferredOut && <div className={s.breakdown}><span>Перенесено далее</span><strong>{rub(row.transferredOut)}</strong></div>}
   {issues.length > 0 && <details className={s.issue}><summary>Данные, требующие внимания · {issues.length}</summary>{issues.map(i => <p key={i}>{i}</p>)}</details>}
  </PayrollDetailDialog>
  <PayrollDetailDialog open={Boolean(detail)} onOpenChange={v => { if (!v)
        setDetail(null); }} title={detail?.calculation_snapshot.kind === "monthly" ? "Оклад за месяц" : detail?.calculation_snapshot.kind === "adjustment" ? "Начисления за месяц" : "Расчёт смены"} description={detail?.business_date ? dateLabel(detail.business_date) : ""} employee={{ name: employee.name, role: detail ? accrualRole(detail, employee.role_name, data) : employee.role_name, avatarUrl: employee.avatar_url }} amount={detail ? rub(isShiftAccrual(detail) ? shiftSalary(detail) : detail.salary) : undefined} amountLabel="Начислено">
   {detail&&isShiftAccrual(detail)&&<p className="mb-3 text-xs text-muted-foreground">{detail.calculation_snapshot.source==="schedule"?"Выход по опубликованному графику":"Выход по отметке Quick Resto"}</p>}
   {detail?.components.filter(c => !isShiftAccrual(detail) || c.kind !== "monthly").map((c, i) => <div key={i} className={s.breakdown}><div><p className="font-medium">{c.label}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.basis}</p>{c.source && <p className="mt-1 text-[11px] text-muted-foreground">{c.source}</p>}</div><strong>{rub(c.amount)}</strong></div>)}
   {detail && <p className="mt-5 text-[11px] text-muted-foreground">Сохранённый расчёт · {new Date(detail.updated_at).toLocaleString("ru-RU", { timeZone: data.timezone })}</p>}
   {Boolean(detail?.issues.length) && <details className={s.issue}><summary>Данные, требующие внимания</summary>{detail?.issues.map(i => <p key={i}>{i}</p>)}</details>}
  </PayrollDetailDialog>
  <PayrollDetailDialog open={conditionsOpen ?? ownConditions} onOpenChange={setConditions} title="Условия сотрудника" description={employee.name}><EmployeePayConditions data={data} employee={employee} month={month} onChange={onChange}/></PayrollDetailDialog>
  <PayrollEntryForm initialKind={entryKind} employeeId={employee.id} open={entryOpen} onOpenChange={setEntryOpen} data={data} month={month} onCreated={async () => { await onChange(); setTab("entries"); }}/>
  <PayrollDetailDialog open={payOpen} onOpenChange={setPayOpen} title="Добавить выплату" description="Запись выданной зарплаты" footer={<div id="concept-payment-footer" className={paymentStyle.footerSlot}/>}><ConceptPaymentForm data={data} month={month} initialEmployeeId={employee.id} onDone={async () => { setPayOpen(false); await onChange(); setTab("payments"); }}/></PayrollDetailDialog>
 </div>;
}
