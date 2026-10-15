"use client";
import { useEffect, useState } from "react";
import { CalendarDays, Clock3, Percent, Layers3, Wallet, History } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import type { PayrollData, PayRule, Rates } from "@/lib/payroll/types";
import { effectivePayModel, selectRule, hasShiftPay } from "@/lib/payroll/calculate";
import { loadPayrollRules, saveRoleCompensation } from "../actions";
import { PayrollDetailDialog } from "./payroll-detail-dialog";
import { PayrollMonthPicker } from "./payroll-month-picker";
import { CompensationRow, CompensationRates } from "./compensation-summary";
import form from "@/app/payroll-concept/concept-payment-form.module.css";
import s from "./role-compensation.module.css";
type Panel = "salary" | "base" | "percent" | "extras" | "benefits" | "history" | null;
const titles = { salary: "Месячный оклад", base: "Выход за смену", percent: "Процент от выручки", extras: "Дополнительные продажи", benefits: "Надбавки и чаевые", history: "История условий" };
const bases = { none: "Без процента", turnover: "Вся выручка", hookah: "Продажи кальянов", bar: "Продажи бара" };
const weekdays = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const rub = (value: number) => `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)} ₽`;
const dateLabel = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString("ru-RU", { timeZone: "UTC" });
function NumberField({ label, value, onChange, percent = false }: {
    label: string;
    value: number | null;
    onChange: (value: number | null) => void;
    percent?: boolean;
}) {
    return <label className={s.field}><span>{label}</span><Input type="number" inputMode="decimal" min={0} max={percent ? 100 : 1000000} step="any" value={value ?? ""} placeholder="Не задано" onChange={e => onChange(e.target.value === "" ? null : Number(e.target.value))}/></label>;
}
export function RoleCompensation({ roleId }: {
    roleId: string;
}) {
    const [data, setData] = useState<PayrollData | null>(null), [error, setError] = useState("");
    const [panel, setPanel] = useState<Panel>(null), [busy, setBusy] = useState(false);
    const [draft, setDraft] = useState<PayRule | null>(null), [from, setFrom] = useState(""), [reason, setReason] = useState("");
    const [viewed, setViewed] = useState<PayRule | null>(null);
    const reload = async () => { const next = await loadPayrollRules(); setData(next); };
    useEffect(() => { let alive = true; loadPayrollRules().then(d => { if (alive)
        setData(d); }).catch(e => { if (alive)
        setError(e instanceof Error ? e.message : "Не удалось загрузить условия"); }); return () => { alive = false; }; }, [roleId]);
    if (error)
        return <p className={s.error}>{error}</p>;
    if (!data)
        return <div className={s.loading}>Загружаем условия оплаты…</div>;
    const model = data.models.find(m => m.role_id === roleId && m.is_role_default && !m.archived);
    const versions = data.rules.filter(r => r.model_id === model?.id && !r.employee_id).sort((a, b) => b.valid_from.localeCompare(a.valid_from) || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
    const today = new Date().toLocaleDateString("en-CA", { timeZone: data.timezone });
    const current = model ? selectRule(versions, { id: "", model_id: model.id } as Parameters<typeof selectRule>[1], today) : null;
    const latest = versions[0] ?? null;
    const effective = effectivePayModel(model ?? null, current);
    const shiftEnabled = hasShiftPay(model ?? null, current);
    const source = effective?.basis ?? "none";
    const canExtras = model && ["Мастер", "Бармен"].includes(model.role_name);
    const extrasEnabled = Boolean(canExtras && effective?.extras_enabled !== false);
    const defaultDraft = (): PayRule => ({ id: "", model_id: model?.id ?? "", employee_id: null, valid_from: today, created_at: "", rates: {}, experience_steps: {}, monthly_amount: 0, tenure_requires_exam: true, config: { basis: "none", tips: false, experience: false, shift_pay: false, extras_enabled: false, knowledge_amount: 0, food_amount: 0, cleaner_bonus: 0 } });
    const open = (next: Panel) => { setPanel(next); setViewed(null); setFrom(next === "salary" ? `${(latest && latest.valid_from > today ? latest.valid_from : today).slice(0, 7)}-01` : latest && latest.valid_from > today ? latest.valid_from : today); setReason(""); const base = latest ?? defaultDraft(); setDraft(structuredClone({ ...base, monthly_amount: base.monthly_amount ?? model?.monthly_amount ?? 0, config: { basis: model?.basis ?? "none", tips: model?.tips ?? false, experience: model?.experience ?? false, knowledge_amount: model?.knowledge_amount ?? 0, food_amount: model?.food_amount ?? 0, cleaner_bonus: model?.cleaner_bonus ?? 0, ...base.config } })); };
    const patchConfig = (patch: PayRule["config"]) => setDraft(d => d ? { ...d, config: { ...d.config, ...patch } } : d);
    const setRate = (count: string, day: string, key: "base" | "percent", value: number | null) => setDraft(d => d ? { ...d, rates: { ...d.rates, [count]: { ...d.rates[count], [day]: { base: d.rates[count]?.[day]?.base ?? null, percent: d.rates[count]?.[day]?.percent ?? null, [key]: value } } } } : d);
    const setWholeWeek = (count: string, key: "base" | "percent", value: number | null) => setDraft(d => {
        if (!d)
            return d;
        const rates: Rates = structuredClone(d.rates);
        for (let day = 1; day <= 7; day++)
            rates[count] = { ...rates[count], [day]: { base: rates[count]?.[day]?.base ?? null, percent: rates[count]?.[day]?.percent ?? null, [key]: value } };
        return { ...d, rates };
    });
    const range = (key: "base" | "percent", count: string) => {
        const values = weekdays.map((_, i) => current?.rates[count]?.[String(i + 1)]?.[key] ?? null);
        return values.every(v => v === values[0]) ? values[0] : null;
    };
    const varying = (key: "base" | "percent") => ["1", "2"].some(c => new Set(weekdays.map((_, i) => current?.rates[c]?.[String(i + 1)]?.[key] ?? null)).size > 1);
    const save = async () => {
        if (!draft)
            return;
        setBusy(true);
        try {
            await saveRoleCompensation(roleId, { valid_from: from, reason: reason.trim(), rates: draft.rates, monthly_amount: draft.monthly_amount, experience_steps: draft.experience_steps, tenure_requires_exam: draft.tenure_requires_exam, config: draft.config }, latest?.id ?? null);
            await reload();
            setPanel(null);
            toast.success("Новая версия условий сохранена");
        }
        catch (e) {
            toast.error(e instanceof Error ? e.message : "Не удалось сохранить условия");
        }
        finally {
            setBusy(false);
        }
    };
    const money = (key: "knowledge_amount" | "food_amount" | "cleaner_bonus") => effective?.[key] ?? 0;
    const benefitsTotal = money("knowledge_amount") + money("food_amount") + money("cleaner_bonus");
    const future = latest && latest.valid_from > today;
    return <div className={s.page}>
  <div className={s.top}><div><h2>Оплата должности</h2><p>{current ? `Действует с ${dateLabel(current.valid_from)}` : "Условия ещё не заданы"}{future ? ` · новая версия с ${dateLabel(latest.valid_from)}` : ""}</p></div><Button variant="outline" size="sm" onClick={() => open("history")}><History className="size-4"/>История условий</Button></div>
  <div className={s.card}>
   <CompensationRow title="Месячный оклад" hint="По основной должности, независимо от смен подмены" icon={<CalendarDays size={20}/>} onEdit={() => open("salary")}><strong className={s.value}>{rub(effective?.monthly_amount ?? 0)}</strong><small className={s.subvalue}>за месяц</small></CompensationRow>
  </div>
  <div className={s.section}><h3>За отработанные смены</h3><span>По должности в графике</span></div>
  <div className={s.card}>
   <CompensationRow title="Выход за смену" hint={varying("base") ? "Разные ставки по дням недели" : shiftEnabled ? (model?.role_name === "Мастер" ? "Все мастера за рабочий день" : model?.role_name === "Бармен" ? "Все бармены за рабочий день" : "Фиксированная сумма за выход") : "Сменная часть выключена"} icon={<Clock3 size={20}/>} onEdit={() => open("base")}>{!shiftEnabled ? <strong className={s.value}>Выключено</strong> : varying("base") ? <strong className={s.value}>По дням недели</strong> : <CompensationRates solo={range("base", "1")} team={range("base", "2")}/>}</CompensationRow>
   <CompensationRow title="Процент от выручки" hint={bases[source]} icon={<Percent size={20}/>} onEdit={() => open("percent")}>{!shiftEnabled || source === "none" ? <strong className={s.value}>Выключен</strong> : varying("percent") ? <strong className={s.value}>По дням недели</strong> : <CompensationRates solo={range("percent", "1")} team={range("percent", "2")} unit="%"/>}</CompensationRow>
   {canExtras && <CompensationRow title="Дополнительные продажи" hint="Общие допродажи делятся между сотрудниками за рабочий день" icon={<Layers3 size={20}/>} onEdit={() => open("extras")}><strong className={s.value}>{extrasEnabled ? "Поровну на смену" : "Выключены"}</strong></CompensationRow>}
   <CompensationRow title="Надбавки и чаевые" hint={[effective?.experience ? "Стаж" : null, money("knowledge_amount") ? "Знания" : null, money("food_amount") ? "Питание" : null, money("cleaner_bonus") ? "Клининг" : null, effective?.tips ? "Чаевые" : null].filter(Boolean).join(" · ") || "Не включены"} icon={<Wallet size={20}/>} onEdit={() => open("benefits")}><strong className={s.value}>{benefitsTotal ? rub(benefitsTotal) : effective?.experience ? "По стажу" : effective?.tips ? "Чаевые" : "Не включены"}</strong><small className={s.subvalue}>{benefitsTotal ? `по условиям смены${effective?.experience ? " + стаж" : ""}` : effective?.tips ? "чаевые распределяются поровну" : ""}</small></CompensationRow>
  </div>
  <PayrollDetailDialog open={Boolean(panel)} onOpenChange={v => { if (!v && !busy)
        setPanel(null); }} title={panel ? titles[panel] : "Оплата должности"} description={data.roles?.find(r => r.id === roleId)?.name ?? "Правила начисления зарплаты"} footer={panel !== "history" ? <Button className="ml-auto" disabled={busy || !from || reason.trim().length < 3} onClick={() => void save()}>{busy ? "Сохраняем…" : "Сохранить условия"}</Button> : undefined}>
   {panel === "history" ? <div className={s.history}>{versions.map(r => <button key={r.id} onClick={() => setViewed(viewed?.id === r.id ? null : r)}><span>С {dateLabel(r.valid_from)}</span><strong>{rub(r.monthly_amount ?? model?.monthly_amount ?? 0)} / месяц</strong><small>{r.change_reason ?? "Перенесённые условия"} · {new Date(r.created_at).toLocaleString("ru-RU", { timeZone: data.timezone })}{r.created_by ? ` · ${data.staff.find(p => p.user_id === r.created_by)?.name ?? "Пользователь системы"}` : r.change_reason ? " · система" : " · импорт"}</small>{viewed?.id === r.id && <div className={s.version}><p>{bases[r.config.basis ?? model?.basis ?? "none"]}</p>{Object.entries(r.rates).map(([count, days]) => <p key={count}>{count} сотрудника: {Object.entries(days).map(([day, rate]) => `${weekdays[Number(day) - 1]} ${rate.base ?? "—"} ₽ + ${rate.percent ?? "—"}%`).join("; ")}</p>)}<p>Стаж: {Object.entries(r.experience_steps).map(([m, n]) => `${m} мес. — ${n} ₽`).join("; ") || "нет шкалы"}</p><p>Знания: {r.config.knowledge_amount ?? model?.knowledge_amount ?? 0} ₽ · питание: {r.config.food_amount ?? model?.food_amount ?? 0} ₽ · клининг: {r.config.cleaner_bonus ?? model?.cleaner_bonus ?? 0} ₽</p></div>}</button>)}{!versions.length && <p>Первая версия появится после сохранения условий.</p>}</div> : draft && <div className={form.form}>
    {panel === "salary" && <NumberField label="Оклад за полный месяц, ₽" value={draft.monthly_amount ?? 0} onChange={v => setDraft({ ...draft, monthly_amount: v ?? 0 })}/>}
    {panel === "base" && <label className={s.toggle}><span>Начислять оплату за смены</span><Switch checked={draft.config.shift_pay ?? shiftEnabled} onCheckedChange={v => patchConfig({ shift_pay: v })}/></label>}
    {(panel === "base" || panel === "percent") && <>
     {panel === "percent" && <div className="space-y-2"><Label>От чего считать процент</Label><Select value={draft.config.basis ?? "none"} onValueChange={v => patchConfig({ basis: v as PayRule["config"]["basis"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(bases).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></div>}
     <div className={s.grid}>{["1", "2"].map(count => <NumberField key={count} label={count === "1" ? "В одиночку" : "Вдвоём"} percent={panel === "percent"} value={draft.rates[count]?.["1"]?.[panel] ?? null} onChange={v => setWholeWeek(count, panel, v)}/>)}</div>
     <details className={s.weekdays}><summary>Ставки по дням недели</summary>{["1", "2"].map(count => <div key={count}><h4>{count === "1" ? "В одиночку" : "Вдвоём"}</h4>{weekdays.map((day, i) => <NumberField key={day} label={day} percent={panel === "percent"} value={draft.rates[count]?.[String(i + 1)]?.[panel] ?? null} onChange={v => setRate(count, String(i + 1), panel, v)}/>)}</div>)}</details>
     {Object.keys(draft.rates).some(c => !["1", "2"].includes(c)) && <p className={s.note}>Прежние ставки для команд другого размера сохраняются в этой версии.</p>}
    </>}
    {panel === "extras" && <><label className={s.toggle}><span>Учитывать общие допродажи</span><Switch checked={draft.config.extras_enabled ?? extrasEnabled} onCheckedChange={v => patchConfig({ extras_enabled: v })}/></label><p className={s.note}>Сумма из отчёта продаж Quick Resto распределяется поровну между {model?.role_name === "Мастер" ? "мастерами" : "барменами"} за рабочий день.</p></>}
    {panel === "benefits" && <>
     <div className={s.grid}>{([['knowledge_amount', 'За подтверждённые знания, ₽'], ['food_amount', 'Питание за выход, ₽'], ['cleaner_bonus', 'Если нет клиннера, ₽']] as const).map(([key, label]) => <NumberField key={key} label={label} value={draft.config[key] ?? 0} onChange={v => patchConfig({ [key]: v ?? 0 })}/>)}</div>
     <label className={s.toggle}><span>Распределять чаевые</span><Switch checked={draft.config.tips ?? false} onCheckedChange={v => patchConfig({ tips: v })}/></label>
     <label className={s.toggle}><span>Надбавка за стаж</span><Switch checked={draft.config.experience ?? false} onCheckedChange={v => patchConfig({ experience: v })}/></label>
     {draft.config.experience && <><label className={s.toggle}><span>Стаж только после подтверждения теста</span><Switch checked={draft.tenure_requires_exam} onCheckedChange={v => setDraft({ ...draft, tenure_requires_exam: v })}/></label><details className={s.weekdays}><summary>Шкала стажа · {Object.keys(draft.experience_steps).length} ступеней</summary>{Object.entries(draft.experience_steps).sort((a, b) => Number(a[0]) - Number(b[0])).map(([months, amount]) => <NumberField key={months} label={`С ${months} мес., ₽ за смену`} value={amount} onChange={v => setDraft({ ...draft, experience_steps: { ...draft.experience_steps, [months]: v ?? 0 } })}/>)}<Button variant="outline" onClick={() => { const next = String(Math.max(0, ...Object.keys(draft.experience_steps).map(Number)) + 1); setDraft({ ...draft, experience_steps: { ...draft.experience_steps, [next]: 0 } }); }}>Добавить ступень</Button></details></>}
    </>}
    <div className={s.effective}><div className="space-y-2"><Label>{panel === "salary" ? "С какого месяца" : "Действует с"}</Label>{panel === "salary" ? <PayrollMonthPicker variant="field" prefix="" ariaLabel="Месяц начала оклада" value={from} min={data.settings?.starts_on ?? "2026-09-01"} onChange={setFrom}/> : <DatePicker value={from} onChange={setFrom} clearable={false}/>}</div><div className="space-y-2"><Label htmlFor="compensation-reason">Причина изменения</Label><Textarea id="compensation-reason" placeholder="Что изменилось и почему" value={reason} onChange={e => setReason(e.target.value)}/></div><p className={s.note}>Сохраняется новая версия условий. Утверждённые начисления остаются в истории.</p></div>
   </div>}
  </PayrollDetailDialog>
 </div>;
}
