"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PayrollDetailDialog } from "@/app/(dashboard)/people/payroll/_components/payroll-detail-dialog";
import { PayrollMonthPicker } from "@/app/(dashboard)/people/payroll/_components/payroll-month-picker";
import { PayrollEmployeePicker } from "@/app/(dashboard)/people/payroll/_components/payroll-employee-picker";
import { transferPayroll, cancelPayrollTransfer } from "@/app/(dashboard)/people/payroll/actions";
import { statementRows } from "@/lib/payroll/calculate";
import formStyle from "./concept-payment-form.module.css";
import type { PayrollData } from "@/lib/payroll/types";

const money = (n: number) => `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(n)} ₽`;
const monthLabel = (m: string) => new Date(`${m}T12:00:00Z`).toLocaleDateString("ru-RU", {month:"long", year:"numeric", timeZone:"UTC"}).replace(" г.", "");
const dateMonth = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`;

export function PayrollTransferDrawer({data, month, employeeId, onClose, onChange}: {
  data: PayrollData; month: string; employeeId?: string; onClose: () => void; onChange: () => Promise<void>;
}) {
  const nextMonth = new Date(`${month}T12:00:00`);
  nextMonth.setMonth(nextMonth.getMonth()+1);
  const rows = statementRows(data.employees, data.accruals, data.adjustments, data.payments, data.allocations, month, data.transfers, data.settings?.starts_on ?? month);
  const [employee, setEmployee] = useState(employeeId ?? "");
  const [target, setTarget] = useState(nextMonth);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const requestKey = useRef<string | null>(null);
  const row = rows.find((r) => r.employee.id === employee);
  const pending = data.legacyPayments.some((p) => p.employee_id === employee && p.month === month && p.state === "review");
  const known = Boolean(row?.employee.opening_confirmed && !pending);
  const remaining = row?.remaining ?? 0;
  const numeric = Number(value.replace(/\s/g, "").replace(",", "."));
  const valid = known && numeric > 0 && numeric <= Math.abs(remaining) && reason.trim().length >= 3 && dateMonth(target) > month;
  const history = data.transfers.filter((t) => t.employee_id === employee && (t.from_month === month || t.to_month === month)).sort((a,b) => b.created_at.localeCompare(a.created_at));
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); await onChange(); } catch(e) { toast.error(e instanceof Error ? e.message : "Не удалось сохранить перенос"); }
    finally { setBusy(false); }
  };
  return <PayrollDetailDialog open onOpenChange={(open) => {if (!open && !busy) onClose();}} title="Перенести остаток"
    description={`Из ведомости за ${monthLabel(month)}`}
    footer={<Button className="ml-auto" disabled={busy || !valid} onClick={() => void run(async () => {
      requestKey.current ??= crypto.randomUUID();
      await transferPayroll({ request_key:requestKey.current, employee_id:employee, from_month:month, to_month:dateMonth(target), amount:numeric*Math.sign(remaining), reason:reason.trim() });
      requestKey.current=null; setValue(""); setReason(""); toast.success("Остаток перенесён");
    })}>{busy ? "Сохраняем…" : "Перенести"}</Button>}>
    <div className={formStyle.form}>
      <div className="space-y-2">
        <Label>Сотрудник</Label>
        <PayrollEmployeePicker employees={rows.map((r) => r.employee)} selectedIds={employee ? [employee] : []} disabled={busy} onChange={(ids) => {setEmployee(ids[0] ?? "");setValue("");requestKey.current=null;}} />
      </div>
      {row && <p className="text-sm text-muted-foreground">{known ? <>Остаток за {monthLabel(month)}: <strong className="font-medium text-foreground">{money(remaining)}</strong></> : "Для переноса сначала уточните прежние выплаты и начальный остаток сотрудника в настройках оплаты труда."}</p>}
      <div className="flex flex-col items-start gap-2"><Label>В какой месяц</Label>
        <PayrollMonthPicker variant="field" ariaLabel="Месяц переноса" prefix="" value={dateMonth(target)} min={dateMonth(nextMonth)} disabled={busy} onChange={(value) => {setTarget(new Date(`${value}T12:00:00`));requestKey.current=null;}} />
      </div>
      <div className="space-y-2"><Label htmlFor="transfer-value">Сумма переноса, ₽</Label>
        <Input id="transfer-value" inputMode="decimal" value={value} onChange={(e) => {setValue(e.target.value);requestKey.current=null;}} placeholder="1 000" disabled={busy} />
        {known && remaining !== 0 && <Button variant="link" size="sm" className="h-auto px-0" onClick={() => {setValue(String(Math.abs(remaining)));requestKey.current=null;}}>Весь остаток · {money(Math.abs(remaining))}</Button>}
        {known && numeric > Math.abs(remaining) && <p className="text-xs text-destructive">Сумма превышает остаток этого месяца.</p>}
      </div>
      <div className="space-y-2"><Label htmlFor="transfer-reason">Причина</Label><Textarea id="transfer-reason" value={reason} onChange={(e) => {setReason(e.target.value);requestKey.current=null;}} placeholder="Например, выплатить вместе с зарплатой за следующий месяц" disabled={busy} /></div>
      <p className="text-xs leading-relaxed text-muted-foreground">Сумма уменьшит остаток этого месяца и добавится к выплате в выбранном месяце. Движения денег не будет.</p>
      {employee && <section className="space-y-3 border-t pt-5"><h3 className="text-sm font-medium">Оформленные переносы</h3>
        {!history.length && <p className="text-xs text-muted-foreground">За этот месяц переносов нет.</p>}
        {history.map((t) => <div key={t.id} className="space-y-2 rounded-xl border p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2"><span>{monthLabel(t.from_month)}</span><ArrowRight size={14}/><span>{monthLabel(t.to_month)}</span></div>
          <div className="flex items-center justify-between"><strong className="font-medium">{money(Number(t.amount))}</strong>{t.state==="cancelled" && <span className="text-xs text-muted-foreground">Отменён</span>}</div>
          <p className="text-xs text-muted-foreground">{t.reason}</p>
          {t.state==="posted" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(async () => {await cancelPayrollTransfer(t.id);toast.success("Перенос отменён");})}>Отменить перенос</Button>}
        </div>)}
      </section>}
      {data.permissions.includes("org.view_audit") && <Link href="/org/audit?types=payroll_transfer" className="inline-flex text-xs text-brand hover:underline">Журнал переносов →</Link>}
    </div>
  </PayrollDetailDialog>;
}
