"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { attendanceRuleAtDate } from "@/lib/payroll/attendance";
import type { PayrollData, PayEmployee } from "@/lib/payroll/types";
import { assignPayrollPosition, setPayrollAttendanceSource } from "../actions";
import { unwrapAction } from "@/lib/actions/result";
import { PayrollDetailDialog } from "./payroll-detail-dialog";
import form from "@/app/(dashboard)/people/payroll/_components/payroll-payment-form.module.css";

const dateLabel = (value: string) =>
  new Date(`${value}T12:00:00Z`).toLocaleDateString("ru-RU", { timeZone: "UTC" });
const sourceLabel = { quickresto: "Отметки Quick Resto", schedule: "Опубликованный график", excluded: "Не учитывать в зарплате" } as const;
type Source = keyof typeof sourceLabel;

export type ConditionMode = "attendance" | "model";

/**
 * Правка одного условия оплаты сотрудника: источник выходов или должность
 * (последнее — только у сотрудника без карточки; с карточкой должность
 * меняется в ней, иначе получились бы две разные должности).
 */
export function EmployeeConditionDrawer({ data, employee, month, mode, onClose, onChange }: {
  data: PayrollData;
  employee: PayEmployee;
  month: string;
  mode: ConditionMode | null;
  onClose: () => void;
  onChange: () => Promise<void>;
}) {
  const monthEnd = new Date(`${month}T12:00:00Z`);
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
  const lastDay = new Date(monthEnd.getTime() - 86400000).toISOString().slice(0, 10);
  const rules = (data.attendanceRules ?? [])
    .filter((r) => r.employee_id === employee.id)
    .sort((a, b) => b.valid_from.localeCompare(a.valid_from) || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  const current = attendanceRuleAtDate(data.attendanceRules ?? [], employee.id, lastDay);
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState<Source>(current?.source ?? "quickresto");
  const [model, setModel] = useState(employee.role_id ?? "");
  const [from, setFrom] = useState(month);
  const [reason, setReason] = useState("");
  const valid = mode === "attendance" ? Boolean(from) && reason.trim().length >= 3 : Boolean(model && from);
  const save = async () => {
    setBusy(true);
    try {
      if (mode === "attendance")
        unwrapAction(await setPayrollAttendanceSource(employee.id, source, from, reason, rules[0]?.id ?? null));
      if (mode === "model") unwrapAction(await assignPayrollPosition(employee.id, model, from));
      await onChange();
      onClose();
      toast.success("Условия сохранены");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };
  return (
    <PayrollDetailDialog
      open={Boolean(mode)}
      onOpenChange={(open) => { if (!open && !busy) onClose(); }}
      title={mode === "attendance" ? "Учёт выходов" : "Должность"}
      description={employee.name}
      footer={<>
        <Button variant="outline" disabled={busy} onClick={onClose}>Отмена</Button>
        <Button disabled={busy || !valid} onClick={() => void save()}>{busy ? "Сохраняем…" : "Сохранить"}</Button>
      </>}
    >
      <div className={form.form}>
        {mode === "attendance" && <>
          <div className="space-y-2">
            <Label>Откуда брать выходы</Label>
            <Select value={source} onValueChange={(v) => setSource(v as Source)} disabled={busy}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(sourceLabel) as Source[]).map((key) => (
                  <SelectItem key={key} value={key}>{sourceLabel[key]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label>Действует с</Label><DatePicker value={from} onChange={setFrom} clearable={false} disabled={busy} /></div>
          <div className="space-y-2">
            <Label htmlFor="attendance-source-reason">Причина изменения</Label>
            <Textarea id="attendance-source-reason" value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
          </div>
          {rules.length > 0 && (
            <section className="space-y-2 border-t pt-5">
              <h3 className="text-sm font-medium">Прежние изменения</h3>
              <ul className="space-y-3">
                {rules.map((r) => (
                  <li key={r.id} className="text-[13px]">
                    <p>С {dateLabel(r.valid_from)} · {sourceLabel[r.source]}</p>
                    {r.reason && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{r.reason}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>}
        {mode === "model" && <>
          <div className="space-y-2">
            <Label>Должность</Label>
            <Select value={model} onValueChange={setModel} disabled={busy}>
              <SelectTrigger><SelectValue placeholder="Выберите должность" /></SelectTrigger>
              <SelectContent>
                {(data.roles ?? [])
                  .filter((r) => data.models.some((m) => m.role_id === r.id && m.is_role_default && !m.archived))
                  .map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label htmlFor="employee-model-from">Действует с</Label><DatePicker id="employee-model-from" value={from} onChange={setFrom} clearable={false} disabled={busy} /></div>
        </>}
      </div>
    </PayrollDetailDialog>
  );
}
