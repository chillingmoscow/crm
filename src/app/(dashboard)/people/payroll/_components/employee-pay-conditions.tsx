"use client";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { attendanceRuleAtDate } from "@/lib/payroll/attendance";
import { latestQualification, qualificationAtDate } from "@/lib/payroll/qualifications";
import type { PayrollData, PayEmployee } from "@/lib/payroll/types";
import { assignPayrollPosition, payrollCommand, setPayrollAttendanceSource } from "../actions";
import { PayrollDetailDialog } from "./payroll-detail-dialog";
import form from "@/app/payroll-concept/concept-payment-form.module.css";
import s from "./employee-pay.module.css";
const dateLabel = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("ru-RU", { timeZone: "UTC" });
export function EmployeePayConditions({ data, employee, month, onChange }: {
    data: PayrollData;
    employee: PayEmployee;
    month: string;
    onChange: () => Promise<void>;
}) {
    const [mode, setMode] = useState<"model" | "test" | "opening" | "attendance" | null>(null);
    const [busy, setBusy] = useState(false);
    const [model, setModel] = useState(employee.role_id ?? "");
    const [from, setFrom] = useState(month);
    const [until, setUntil] = useState("");
    const [reason, setReason] = useState("");
    const [attendanceSource,setAttendanceSource]=useState<"quickresto"|"schedule"|"excluded">("quickresto");
    const [opening, setOpening] = useState(String(employee.opening_balance));
    const configure = data.permissions.includes("payroll.configure");
    const assignments = data.assignments.filter(a => a.employee_id === employee.id).sort((a, b) => b.valid_from.localeCompare(a.valid_from));
    const qualifications = data.qualifications.filter(q => q.employee_id === employee.id).sort((a, b) => b.valid_from.localeCompare(a.valid_from));
    const monthEnd = new Date(`${month}T12:00:00Z`);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
    const lastDay = new Date(monthEnd.getTime() - 86400000).toISOString().slice(0, 10);
    const referenceDate = data.asOfDate && data.asOfDate < lastDay ? data.asOfDate : lastDay;
    const latestTest = latestQualification(qualifications, employee.id, referenceDate);
    const currentTest = qualificationAtDate(qualifications, employee.id, referenceDate);
    const testStatus = currentTest
        ? [currentTest.experience && "стаж", currentTest.knowledge && "знания"].filter(Boolean).join(" и ") || "Надбавки не подтверждены"
        : latestTest?.valid_until && latestTest.valid_until < referenceDate
          ? `Срок результатов истёк ${dateLabel(latestTest.valid_until)}`
          : "Тест не подтверждён";
    const sourceRule=attendanceRuleAtDate(data.attendanceRules??[],employee.id,new Date(monthEnd.getTime()-86400000).toISOString().slice(0,10));
    const latestSourceRule=(data.attendanceRules??[]).filter(r=>r.employee_id===employee.id).sort((a,b)=>b.valid_from.localeCompare(a.valid_from)||b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id))[0];
    const open = (next: typeof mode) => { setAttendanceSource(sourceRule?.source??"quickresto"); setModel(employee.role_id ?? ""); setOpening(String(employee.opening_balance)); setFrom(month); setUntil(""); setReason(""); setMode(next); };
    const save = async () => {
        setBusy(true);
        try {
            if(mode==="attendance") await setPayrollAttendanceSource(employee.id,attendanceSource,from,reason,latestSourceRule?.id??null);
            if (mode === "model")
                await assignPayrollPosition(employee.id, model, from);
            if (mode === "opening")
                await payrollCommand("employee", { id: employee.id, opening_balance: Number(opening), opening_confirmed: true });
            if (mode === "test")
                await payrollCommand("qualification", { employee_id: employee.id, valid_from: from, valid_until: until || null, knowledge: true, experience: true, reason });
            await onChange();
            setMode(null);
            toast.success("Условия сохранены");
        }
        catch (e) {
            toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
        }
        finally {
            setBusy(false);
        }
    };
    return <div className={s.settings}>
  <section className={s.setting}><div><h3>Основная должность</h3><p>{data.roles?.find(r => r.id === employee.role_id)?.name ?? "Не назначена"}</p><p>Ставки и проценты настраиваются в должности.</p></div><div className="flex shrink-0 flex-col items-end gap-2">{employee.role_id && <Button variant="outline" size="sm" asChild><Link href={`/people/roles/${employee.role_id}?tab=compensation`}>Оплата должности</Link></Button>}{configure && <Button variant="ghost" size="sm" onClick={() => open("model")}>Изменить должность</Button>}</div></section>
  <section className={s.setting}><div><h3>Факт работы</h3><p>{sourceRule?.source==="excluded"?"Не участвует в зарплатном учёте":employee.casual||sourceRule?.source==="schedule"?"По опубликованному графику":"По отметкам Quick Resto"}</p><p>{sourceRule?.source==="excluded"?"Начисления за работу с выбранной даты отключены. Прежняя история сохраняется.":employee.casual||sourceRule?.source==="schedule"?"Завершённая смена в графике учитывается как отработанная.":"График задаёт план, личная смена подтверждает выход."}</p></div>{configure&&!employee.casual&&<Button variant="outline" size="sm" onClick={()=>open("attendance")}>Изменить</Button>}</section>
  <section className={s.setting}><div><h3>Стаж и знания</h3><p>{currentTest && (currentTest.experience || currentTest.knowledge) ? "Подтверждено: " : ""}{testStatus}{currentTest && (currentTest.experience || currentTest.knowledge) && currentTest.valid_until ? ` · по ${dateLabel(currentTest.valid_until)}` : ""}</p><p>На {dateLabel(referenceDate)} · по правилам должности.</p></div>{configure && <Button variant="outline" size="sm" onClick={() => open("test")}>Подтвердить тест</Button>}</section>
  <section className={s.setting}><div><h3>Начальный остаток · {data.settings?.starts_on ? dateLabel(data.settings.starts_on) : "начало учёта"}</h3><p>{employee.opening_confirmed ? `${new Intl.NumberFormat("ru-RU").format(employee.opening_balance)} ₽ · подтверждён` : "Не указан"}</p><p>Используется при первом расчёте. Переносы между месяцами оформляются отдельно.</p></div>{configure && <Button variant="outline" size="sm" onClick={() => open("opening")}>{employee.opening_confirmed ? "Изменить" : "Указать"}</Button>}</section>
  <details className={s.issue}><summary>История условий и тестов</summary>{(data.attendanceRules??[]).filter(r=>r.employee_id===employee.id).map(r=><p key={r.id}>Факт работы с {dateLabel(r.valid_from)} · {r.source==="excluded"?"Не учитывать в зарплате":r.source==="schedule"?"График":"Quick Resto"} · {r.reason}</p>)}{assignments.map(a => <p key={a.id}>С {dateLabel(a.valid_from)} · {data.roles?.find(r => r.id === data.models.find(m => m.id === a.model_id)?.role_id)?.name ?? data.models.find(m => m.id === a.model_id)?.name ?? "Должность"}</p>)}{qualifications.map(q => <p key={q.id}>Подтверждение надбавок с {dateLabel(q.valid_from)}{q.valid_until ? ` по ${dateLabel(q.valid_until)}` : ""} · {q.reason}</p>)}{!assignments.length && !qualifications.length && <p>Сохранённых версий пока нет.</p>}</details>
  <PayrollDetailDialog open={Boolean(mode)} onOpenChange={v => { if (!v && !busy)
        setMode(null); }} title={mode==="attendance"?"Факт работы":mode === "model" ? "Основная должность" : mode === "test" ? "Результат теста" : "Начальный остаток"} description="Условия оплаты сотрудника" employee={{ name: employee.name, role: employee.role_name, avatarUrl: employee.avatar_url }} footer={<Button className="ml-auto" disabled={busy || (mode==="attendance"&&(!from||reason.trim().length<3)) || (mode === "model" && (!model || !from)) || (mode === "test" && (!from || reason.trim().length < 3 || (Boolean(until) && until < from))) || (mode === "opening" && (opening.trim() === "" || !Number.isFinite(Number(opening))))} onClick={() => void save()}>{busy ? "Сохраняем…" : "Сохранить"}</Button>}>
   <div className={form.form}>
    {mode==="attendance"&&<><div className="space-y-2"><Label>Источник</Label><Select value={attendanceSource} onValueChange={v=>setAttendanceSource(v as "quickresto"|"schedule"|"excluded")} disabled={busy}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="quickresto">Отметки Quick Resto</SelectItem><SelectItem value="schedule">Опубликованный график</SelectItem><SelectItem value="excluded">Не учитывать в зарплате</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Действует с</Label><DatePicker value={from} onChange={setFrom} clearable={false} disabled={busy}/></div><div className="space-y-2"><Label htmlFor="attendance-source-reason">Причина изменения</Label><Textarea id="attendance-source-reason" value={reason} onChange={e=>setReason(e.target.value)} disabled={busy}/></div></>}

    {mode === "model" && <><div className="space-y-2"><Label>Основная должность</Label><Select value={model} onValueChange={setModel} disabled={busy}><SelectTrigger><SelectValue placeholder="Выберите должность"/></SelectTrigger><SelectContent>{(data.roles ?? []).filter(r => data.models.some(m => m.role_id === r.id && m.is_role_default && !m.archived)).map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="employee-model-from">Действует с</Label><DatePicker id="employee-model-from" value={from} onChange={setFrom} clearable={false} disabled={busy}/></div></>}
    {mode === "test" && <><p className="text-[13px] leading-relaxed text-muted-foreground">Подтверждение включает надбавки за стаж и знания по правилам должности. Ранее утверждённые начисления сохраняются.</p><div className="space-y-2"><Label htmlFor="employee-test-from">Действует с</Label><DatePicker id="employee-test-from" value={from} onChange={setFrom} clearable={false} disabled={busy}/></div><div className="space-y-2"><Label htmlFor="employee-test-until">Действует до · необязательно</Label><DatePicker id="employee-test-until" value={until} onChange={setUntil} disabled={busy}/></div><div className="space-y-2"><Label htmlFor="employee-test-reason">Основание и результат</Label><Textarea id="employee-test-reason" value={reason} onChange={e => setReason(e.target.value)} disabled={busy}/></div></>}
    {mode === "opening" && <><p className="text-[13px] leading-relaxed text-muted-foreground">Долг заведения укажите положительной суммой, переплату сотруднику — отрицательной. Остаток изменится после сохранения.</p><div className="space-y-2"><Label htmlFor="employee-opening">Сумма, ₽</Label><Input id="employee-opening" inputMode="decimal" type="number" step="0.01" value={opening} onChange={e => setOpening(e.target.value)} disabled={busy}/></div></>}
   </div>
  </PayrollDetailDialog>
 </div>;
}
