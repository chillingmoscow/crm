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
import { unwrapAction } from "@/lib/actions/result";
import { statementRows, transferableBalance } from "@/lib/payroll/calculate";
import formStyle from "./payroll-payment-form.module.css";
import type { PayrollData, PayrollTransfer } from "@/lib/payroll/types";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money, formatRub } from "@/components/shared/money";
import { StatusBadge } from "@/components/ui/status-badge";

const monthLabel = (m: string) => new Date(`${m}T12:00:00Z`).toLocaleDateString("ru-RU", {month:"long", year:"numeric", timeZone:"UTC"}).replace(" г.", "");
const dateMonth = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`;

export function PayrollTransferDrawer({data, month, employeeId, onClose, onChange}: {
  data: PayrollData; month: string; employeeId?: string; onClose: () => void; onChange: () => Promise<void>;
}) {
  const nextMonth = new Date(`${month}T12:00:00`);
  nextMonth.setMonth(nextMonth.getMonth()+1);
  const rows = statementRows(data.employees, data.accruals, data.adjustments, data.payments, data.allocations, month, data.transfers, data.settings?.starts_on ?? month, data.officialExpected ?? []);
  const [employee, setEmployee] = useState(employeeId ?? "");
  const [target, setTarget] = useState(nextMonth);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const requestKey = useRef<string | null>(null);
  const row = rows.find((r) => r.employee.id === employee);
  const pending = data.legacyPayments.some((p) => p.employee_id === employee && p.month === month && p.state === "review");
  const known = Boolean(row && !pending);
  const remaining = row?.remaining ?? 0;
  // Переплата только из-за ожидаемой официальной части: база её не видит.
  const { amount: transferable, blockedByOfficial } = row ? transferableBalance(row) : { amount: 0, blockedByOfficial: false };
  const numeric = Number(value.replace(/\s/g, "").replace(",", "."));
  const valid = known && !blockedByOfficial && numeric > 0 && numeric <= transferable && reason.trim().length >= 3 && dateMonth(target) > month;
  const history = data.transfers.filter((t) => t.employee_id === employee && (t.from_month === month || t.to_month === month)).sort((a,b) => b.created_at.localeCompare(a.created_at));
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); await onChange(); } catch(e) { toast.error(e instanceof Error ? e.message : "Не удалось сохранить перенос"); }
    finally { setBusy(false); }
  };
  // Отмена переноса меняет остатки двух месяцев — только через подтверждение.
  const [cancelling, setCancelling] = useState<PayrollTransfer | null>(null);
  const [cancelError, setCancelError] = useState("");
  const confirmCancel = async () => {
    if (!cancelling) return;
    setBusy(true);
    setCancelError("");
    try {
      unwrapAction(await cancelPayrollTransfer(cancelling.id));
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : "Не удалось отменить перенос");
      setBusy(false);
      return;
    }
    setCancelling(null);
    toast.success("Перенос отменён");
    try { await onChange(); } catch { /* Ведомость обновится при следующем автообновлении. */ }
    finally { setBusy(false); }
  };
  return <PayrollDetailDialog open onOpenChange={(open) => {if (!open && !busy) onClose();}} title="Перенести остаток"
    description={`Из ведомости за ${monthLabel(month)}`}
    footer={<><Button variant="outline" disabled={busy} onClick={() => onClose()}>Отмена</Button><Button disabled={busy || !valid} onClick={() => void run(async () => {
      requestKey.current ??= crypto.randomUUID();
      unwrapAction(await transferPayroll({ request_key:requestKey.current, employee_id:employee, from_month:month, to_month:dateMonth(target), amount:numeric*Math.sign(remaining), reason:reason.trim() }));
      requestKey.current=null; setValue(""); setReason(""); toast.success("Остаток перенесён");
    })}>{busy ? "Сохраняем…" : "Перенести"}</Button></>}>
    <div className={formStyle.form}>
      <div className="space-y-2">
        <Label>Сотрудник</Label>
        <PayrollEmployeePicker employees={rows.map((r) => r.employee)} selectedIds={employee ? [employee] : []} disabled={busy} onChange={(ids) => {setEmployee(ids[0] ?? "");setValue("");requestKey.current=null;}} />
      </div>
      {row && <p className="text-sm text-muted-foreground">{known ? <>{remaining < 0 ? "Переплата" : "К выплате"} за {monthLabel(month)}: <strong className="font-medium text-foreground"><Money value={Math.abs(remaining)} fraction /></strong></> : "Для переноса сначала уточните прежние выплаты и начальный остаток сотрудника в настройках оплаты труда."}</p>}
      <div className="flex flex-col items-start gap-2"><Label>В какой месяц</Label>
        <PayrollMonthPicker variant="field" ariaLabel="Месяц переноса" prefix="" value={dateMonth(target)} min={dateMonth(nextMonth)} disabled={busy} onChange={(value) => {setTarget(new Date(`${value}T12:00:00`));requestKey.current=null;}} />
      </div>
      <div className="space-y-2"><Label htmlFor="transfer-value">Сумма переноса, ₽</Label>
        <Input id="transfer-value" inputMode="decimal" value={value} onChange={(e) => {setValue(e.target.value);requestKey.current=null;}} placeholder="1 000" disabled={busy} />
        {known && blockedByOfficial && <p className="text-xs text-muted-foreground">Переплату можно перенести после проведения официальной выплаты</p>}
        {known && transferable !== 0 && <Button variant="link" size="sm" className="h-auto px-0" onClick={() => {setValue(String(transferable));requestKey.current=null;}}>Весь остаток · {formatRub(transferable, { fraction: true })}</Button>}
        {known && !blockedByOfficial && numeric > transferable && <p className="text-xs text-destructive">Сумма превышает остаток этого месяца.</p>}
      </div>
      <div className="space-y-2"><Label htmlFor="transfer-reason">Причина</Label><Textarea id="transfer-reason" value={reason} onChange={(e) => {setReason(e.target.value);requestKey.current=null;}} placeholder="Например, выплатить вместе с зарплатой за следующий месяц" disabled={busy} /></div>
      <p className="text-xs leading-relaxed text-muted-foreground">Сумма уменьшит остаток этого месяца и добавится к выплате в выбранном месяце. Движения денег не будет.</p>
      {employee && <section className="space-y-3 border-t pt-5"><h3 className="text-sm font-medium">Оформленные переносы</h3>
        {!history.length && <p className="text-xs text-muted-foreground">За этот месяц переносов нет.</p>}
        {history.map((t) => <div key={t.id} className="space-y-2 rounded-xl border p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2"><span>{monthLabel(t.from_month)}</span><ArrowRight size={14}/><span>{monthLabel(t.to_month)}</span></div>
          <div className="flex items-center justify-between"><strong className="font-medium"><Money value={Number(t.amount)} fraction /></strong>{t.state==="cancelled" && <StatusBadge>Отменён</StatusBadge>}</div>
          <p className="text-xs text-muted-foreground">{t.reason}</p>
          {t.state==="posted" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => {setCancelError("");setCancelling(t);}}>Отменить перенос</Button>}
        </div>)}
      </section>}
      {data.permissions.includes("org.view_audit") && <Link href="/org/audit?types=payroll_transfer" className="inline-flex text-xs text-brand hover:underline">Журнал переносов →</Link>}
    </div>
    <ConfirmDialog
      open={Boolean(cancelling)}
      onOpenChange={(open) => { if (!open) setCancelling(null); }}
      title={cancelling ? `Отменить перенос ${formatRub(Math.abs(Number(cancelling.amount)), { fraction: "auto" })}?` : "Отменить перенос?"}
      description={cancelling ? `Сумма вернётся из ведомости за ${monthLabel(cancelling.to_month)} в ведомость за ${monthLabel(cancelling.from_month)}. Перенос останется в списке с отметкой «Отменён». Движения денег не будет.` : undefined}
      confirmLabel="Отменить перенос"
      pendingLabel="Отменяем…"
      destructive
      busy={busy}
      onConfirm={() => void confirmCancel()}
    >
      {cancelError && <p role="alert" className="text-sm text-destructive">{cancelError}</p>}
    </ConfirmDialog>
  </PayrollDetailDialog>;
}
