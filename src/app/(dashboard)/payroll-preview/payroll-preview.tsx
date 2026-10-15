"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, ArrowRight, CalendarDays, Check, ChevronRight, History, Plus, Clock3, Percent, Wallet, Layers3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PageBreadcrumb } from "@/components/shared/page-header-actions";
import { PageFrame } from "@/components/shared/page-frame";
import { PayrollDetailDialog } from "@/app/(dashboard)/people/payroll/_components/payroll-detail-dialog";
import { PayrollEmployeeCell } from "@/app/(dashboard)/people/payroll/_components/payroll-employee-cell";
import { PayrollTable } from "@/app/(dashboard)/people/payroll/_components/payroll-table";
import s from "./payroll-preview.module.css";
import { CompensationRow as RuleSummary, CompensationRates as RatePair } from "@/app/(dashboard)/people/payroll/_components/compensation-summary";

type View = "role" | "employee";
type Basis = "total" | "hookah" | "bar";
type Panel = "allowance" | "premium" | "correction" | "history" | "conditions" | "payment" | "shift" | "breakdown" | "salaryRule" | "percentRule" | "shiftRule" | "extrasRule" | "supplementsRule" | null;
type RuleSet = { salary: number; salaryEnabled: boolean; solo: number; team: number; percentEnabled: boolean; basis: Basis; shiftSolo: number; shiftTeam: number; shiftEnabled: boolean; extrasEnabled: boolean; knowledge: number; food: number; cleaner: number };
type Shift = { date: string; role: string; sales: Record<Basis, number>; crew: 1 | 2; substitute?: boolean; fixed?: number; extras: number; tips: number; cleanerAbsent?: boolean };
const master = "Старший кальянный мастер";
const identity = { name: "Никита Волков", role: master };
const rub = (n: number) => `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n)} ₽`;
const basisLabels: Record<Basis, string> = { total: "Вся выручка", hookah: "Продажи кальянов", bar: "Продажи бара" };
const initialRules: RuleSet = { salary: 20000, salaryEnabled: true, solo: 8, team: 6, percentEnabled: true, basis: "hookah", shiftSolo: 1500, shiftTeam: 1000, shiftEnabled: true, extrasEnabled: true, knowledge: 300, food: 200, cleaner: 600 };
// All shifts and transactions are illustrative. Changes stay in component state.
const shifts: Shift[] = [
  { date: "02.10.2026", role: master, sales: { hookah: 80000, bar: 80000, total: 160000 }, crew: 1, extras: 1200, tips: 1000 },
  { date: "05.10.2026", role: master, sales: { hookah: 90000, bar: 80000, total: 170000 }, crew: 2, extras: 1800, tips: 1100 },
  { date: "08.10.2026", role: "Менеджер", sales: { hookah: 0, bar: 0, total: 0 }, crew: 1, substitute: true, fixed: 4500, extras: 0, tips: 900 },
  { date: "11.10.2026", role: master, sales: { hookah: 100000, bar: 100000, total: 200000 }, crew: 2, extras: 3200, tips: 1200, cleanerAbsent: true },
];
const tableLabels = { date: "Дата", role: "Должность", base: "Выход", percent: "Процент", extras: "Допродажи", supplements: "Надбавки", amount: "Начислено", tips: "Чаевые" };
const hiddenShiftColumns = ["tips"];
const numericShiftColumns = ["base", "percent", "extras", "supplements", "amount", "tips"];
function Line({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <div className={s.line}><div><span>{label}</span>{hint && <small>{hint}</small>}</div><strong>{children}</strong></div>;
}
function NumericField({ id, label, value, onChange, unit = "₽", max }: { id: string; label: string; value: number; onChange: (v: number) => void; unit?: string; max?: number }) {
  return <div className={s.field}><Label htmlFor={id}>{label}</Label><div className={s.numberInput}><Input id={id} type="number" min={0} max={max} step={1} value={value} onChange={event => onChange(Math.max(0, Math.min(max ?? Infinity, Number(event.target.value))))} /><span>{unit}</span></div></div>;
}
function TeamRates({ id, solo, team, onChange, unit = "₽" }: { id: string; solo: number; team: number; onChange: (solo: number, team: number) => void; unit?: string }) {
  return <div className={s.rateFields}><NumericField id={`${id}-solo`} label="В одиночку" value={solo} onChange={value => onChange(value, team)} unit={unit} max={unit === "%" ? 100 : undefined} /><NumericField id={`${id}-team`} label="Вдвоём" value={team} onChange={value => onChange(solo, value)} unit={unit} max={unit === "%" ? 100 : undefined} /></div>;
}


export function PayrollPreview({ initialView }: { initialView: View }) {
  const [view, setView] = useState<View>(initialView);
  const [rules, setRules] = useState(initialRules);
  const [draft, setDraft] = useState(initialRules);
  const [panel, setPanel] = useState<Panel>(null);
  const [selectedShift, setSelectedShift] = useState(shifts[0]);
  const [employeeTab, setEmployeeTab] = useState("shifts");
  const [allowance, setAllowance] = useState(3500);
  const [premium, setPremium] = useState(1500);
  const [correction, setCorrection] = useState(0);
  const [entryAmount, setEntryAmount] = useState(3500);
  const [entryReason, setEntryReason] = useState("Выполнение KPI за октябрь");
  const [allowanceReason, setAllowanceReason] = useState("Выполнение KPI за октябрь");
  const [premiumReason, setPremiumReason] = useState("За помощь с обучением команды");
  const [correctionReason, setCorrectionReason] = useState("");
  const [entryError, setEntryError] = useState("");
  const [changes, setChanges] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const salary = rules.salaryEnabled ? rules.salary : 0;
  const percentage = (shift: Shift) => rules.percentEnabled ? Math.round(shift.sales[rules.basis] * (shift.crew === 1 ? rules.solo : rules.team) / 100) : 0;
  const shiftRate = (shift: Shift) => rules.shiftEnabled ? (shift.crew === 1 ? rules.shiftSolo : rules.shiftTeam) : 0;
  const extrasAmount = (shift: Shift) => !shift.substitute && rules.extrasEnabled ? Math.round(shift.extras / shift.crew) : 0;
  const supplements = (shift: Shift) => shift.substitute ? 0 : rules.knowledge + rules.food + (shift.cleanerAbsent ? rules.cleaner : 0);
  const shiftAmount = (shift: Shift) => shift.substitute ? shift.fixed ?? 0 : percentage(shift) + shiftRate(shift) + extrasAmount(shift) + supplements(shift);
  const tipsTotal = shifts.reduce((sum, shift) => sum + shift.tips, 0);
  const totalComponent = (component: (shift: Shift) => number) => shifts.reduce((sum, shift) => sum + (shift.substitute ? 0 : component(shift)), 0);
  const shiftTotal = shifts.reduce((sum, shift) => sum + shiftAmount(shift), 0);
  const earned = salary + shiftTotal + allowance + premium - 800 + correction;
  const paid = 20000;
  const dirty = JSON.stringify(rules) !== JSON.stringify(draft);
  const editable = panel === "allowance" || panel === "premium" || panel === "correction";
  const ruleEditing = panel === "salaryRule" || panel === "percentRule" || panel === "shiftRule" || panel === "extrasRule" || panel === "supplementsRule";
  const titles: Record<Exclude<Panel, null>, string> = { allowance: "Надбавка за месяц", premium: "Разовая премия", correction: "Корректировка начисления", history: "История условий", conditions: "Условия сотрудника", payment: "Выплата зарплаты", shift: "Расчёт смены", breakdown: "Начисления за октябрь", salaryRule: "Месячный оклад", percentRule: "Процент от выручки", shiftRule: "Выход за смену", extrasRule: "Дополнительные продажи", supplementsRule: "Надбавки за смену" };
  const open = (next: Panel) => {
    setDraft(rules); setPanel(next); setEntryError("");
    if (next === "allowance") { setEntryAmount(allowance); setEntryReason(allowanceReason); }
    if (next === "premium") { setEntryAmount(premium); setEntryReason(premiumReason); }
    if (next === "correction") { setEntryAmount(correction); setEntryReason(correctionReason); }
  };
  const saveEntry = () => {
    if (!editable) return;
    if (!entryReason.trim()) { setEntryError("Укажите основание начисления"); return; }
    if (panel === "allowance") { setAllowance(entryAmount); setAllowanceReason(entryReason.trim()); }
    if (panel === "premium") { setPremium(entryAmount); setPremiumReason(entryReason.trim()); }
    if (panel === "correction") { setCorrection(entryAmount); setCorrectionReason(entryReason.trim()); }
    setChanges(previous => [`${titles[panel]}: изменено в макете`, ...previous]); setNotice("Изменения сохранены в макете"); setPanel(null);
  };
  const saveRules = () => { setRules(draft); setChanges(previous => ["Изменены условия оплаты должности", ...previous]); setNotice("Условия сохранены в макете"); setPanel(null); };
  const selectView = (next: View) => { setView(next); setNotice(""); };
  const columns: ColumnDef<Shift>[] = [
    { id: "date", header: "Дата", accessorFn: shift => shift.date.split(".").reverse().join("-"), cell: ({ row }) => <button className="text-left" aria-label={`Расчёт за ${row.original.date}`} onClick={event => { event.stopPropagation(); setSelectedShift(row.original); open("shift"); }}>{row.original.date}</button> },
    { id: "role", header: "Должность", accessorKey: "role", cell: ({ row }) => <span className={s.shiftRole}>{row.original.role}{row.original.substitute && <small className={s.substitute}>Подмена</small>}</span> },
    { id: "base", header: "Выход", accessorFn: shift => shift.substitute ? shift.fixed ?? 0 : shiftRate(shift), cell: ({ row }) => rub(row.original.substitute ? row.original.fixed ?? 0 : shiftRate(row.original)) },
    { id: "percent", header: "Процент", accessorFn: shift => shift.substitute ? 0 : percentage(shift), cell: ({ row }) => row.original.substitute ? "—" : rub(percentage(row.original)) },
    { id: "extras", header: "Допродажи", accessorFn: extrasAmount, cell: ({ row }) => row.original.substitute ? "—" : rub(extrasAmount(row.original)) },
    { id: "supplements", header: "Надбавки", accessorFn: supplements, cell: ({ row }) => row.original.substitute ? "—" : rub(supplements(row.original)) },
    { id: "amount", header: "Начислено", accessorFn: shiftAmount, cell: ({ row }) => <button className={s.totalCell} aria-label={`Состав начисления за ${row.original.date}`} onClick={event => { event.stopPropagation(); setSelectedShift(row.original); open("shift"); }}><strong>{rub(shiftAmount(row.original))}</strong><ChevronRight size={13} /></button> },
    { id: "tips", header: "Чаевые", accessorKey: "tips", cell: ({ row }) => rub(row.original.tips) },
  ];

  return <PageFrame className={s.page}>
    <PageBreadcrumb><Link href="/payroll-concept" className={s.back}><ArrowLeft size={15} />Зарплата</Link></PageBreadcrumb>
    <div className={s.previewBar}><nav aria-label="Макеты зарплаты"><button aria-current={view === "role" ? "page" : undefined} onClick={() => selectView("role")}>Оплата должности</button><button aria-current={view === "employee" ? "page" : undefined} onClick={() => selectView("employee")}>Расчёт сотрудника</button></nav><span>Макет · пример данных</span></div>
    {view === "role" ? <>
      <header className={s.heading}><div><h1>{master}</h1><p>Оплата труда</p></div><Button variant="outline" onClick={() => open("history")}><History />История</Button></header>
      <div className={s.periodRow}><span className={s.date}><CalendarDays size={15} />С 1 октября 2026</span></div>
      <section className={s.monthlySection} aria-labelledby="monthly-title"><div className={s.sectionHeading}><h2 id="monthly-title">За месяц</h2></div><div className={s.monthlyRule}><RuleSummary title="Оклад" hint="По основной должности" icon={<Wallet size={20} />} onEdit={() => open("salaryRule")}><strong className={s.monthlyAmount}>{rules.salaryEnabled ? rub(rules.salary) : "Выключен"}</strong></RuleSummary></div></section>
      <section className={s.shiftSection} aria-labelledby="shift-rules-title"><div className={s.sectionHeading}><h2 id="shift-rules-title">За смену</h2><span>Кальянные мастера</span></div><div className={s.ruleList}>
        <RuleSummary title="Выход" hint="Фиксированная сумма за смену" icon={<Clock3 size={19} />} onEdit={() => open("shiftRule")}>{rules.shiftEnabled ? <RatePair solo={rules.shiftSolo} team={rules.shiftTeam} /> : <span className={s.offValue}>Выключен</span>}</RuleSummary>
        <RuleSummary title="Процент от выручки" hint={basisLabels[rules.basis]} icon={<Percent size={19} />} onEdit={() => open("percentRule")}>{rules.percentEnabled ? <RatePair solo={rules.solo} team={rules.team} unit="%" /> : <span className={s.offValue}>Выключен</span>}</RuleSummary>
        <RuleSummary title="Дополнительные продажи" hint="Общая сумма за рабочий день" icon={<Layers3 size={19} />} onEdit={() => open("extrasRule")}><span className={s.textValue}>{rules.extrasEnabled ? "Поровну на смену" : "Выключены"}</span></RuleSummary>
        <RuleSummary title="Надбавки" hint="Знания · питание · клининг" icon={<Plus size={19} />} onEdit={() => open("supplementsRule")}><span className={s.supplementValues}><span>{rub(rules.knowledge)}<small>знания</small></span><span>{rub(rules.food)}<small>питание</small></span><span>{rub(rules.cleaner)}<small>клининг</small></span></span></RuleSummary>
      </div></section>
    </> : <>
      <header className={s.heading}><div className={s.employeeHeading}><span className={s.avatar}>НВ</span><div><h1>Никита Волков</h1><p>{master}</p></div></div><Button variant="outline" onClick={() => open("conditions")}>Условия сотрудника</Button></header>
      <div className={s.periodRow}><span className={s.date}><CalendarDays size={15} />Октябрь 2026</span><div id="preview-employee-controls" className={s.tableControls} /><DropdownMenu><DropdownMenuTrigger asChild><Button><Plus />Добавить</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => open("allowance")}>Надбавка за месяц</DropdownMenuItem><DropdownMenuItem onSelect={() => open("premium")}>Премия</DropdownMenuItem><DropdownMenuItem onSelect={() => open("correction")}>Корректировка</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
      <div className={s.stats}><button onClick={() => open("breakdown")}><span>Начислено<ChevronRight size={15} /></span><strong>{rub(earned)}</strong></button><button onClick={() => open("payment")}><span>Выплачено<ChevronRight size={15} /></span><strong>{rub(paid)}</strong></button><div><span>Осталось выплатить</span><strong>{rub(earned - paid)}</strong></div><div className={s.tipsMetric}><span>Чаевые</span><strong>{rub(tipsTotal)}</strong></div></div>
      <div className={s.meta}><span>4 смены · 1 подмена</span></div>
      <Tabs value={employeeTab} onValueChange={setEmployeeTab} className={s.tabs}><TabsList aria-label="Зарплата сотрудника"><TabsTrigger value="shifts">Смены</TabsTrigger><TabsTrigger value="operations">Операции</TabsTrigger></TabsList>
        <TabsContent value="shifts"><PayrollTable id="payroll-preview-shifts-v3" rows={shifts} columns={columns} labels={tableLabels} numeric={numericShiftColumns} hiddenColumns={hiddenShiftColumns} defaultSort="date" defaultSortDesc scrollMode="page" minWidth={880} searchText={shift => `${shift.date} ${shift.role}`} onRow={shift => { setSelectedShift(shift); open("shift"); }} toolbarTargetId="preview-employee-controls" /></TabsContent>
        <TabsContent value="operations"><div className={s.operations}>
          <button className={s.operationRow} onClick={() => open("payment")}><span className={s.opDate}>15.10.2026</span><div><strong>Выплата зарплаты</strong><small>За октябрь 2026 · касса CHILLING</small></div><strong>{rub(paid)}</strong><span className={s.status}>Проведено</span><ChevronRight size={15} /></button>
          <button className={s.operationRow} onClick={() => open("allowance")}><span className={s.opDate}>14.10.2026</span><div><strong>Надбавка за месяц</strong><small>{allowanceReason}</small></div><strong>+ {rub(allowance)}</strong><ChevronRight size={15} /></button>
          <button className={s.operationRow} onClick={() => open("premium")}><span className={s.opDate}>12.10.2026</span><div><strong>Премия</strong><small>{premiumReason}</small></div><strong className={s.positive}>+ {rub(premium)}</strong><ChevronRight size={15} /></button>
        </div></TabsContent>
      </Tabs>
    </>}
    {notice && <p role="status" className={s.notice}><Check size={15} />{notice}</p>}
    <PayrollDetailDialog open={panel !== null} onOpenChange={isOpen => { if (!isOpen) setPanel(null); }} title={panel ? titles[panel] : ""} description={editable || ruleEditing ? "Изменения применяются только к макету" : "Демонстрационный пример"} footer={editable || ruleEditing ? <><Button variant="ghost" onClick={() => setPanel(null)}>Отмена</Button><Button onClick={ruleEditing ? saveRules : saveEntry} disabled={ruleEditing && !dirty}>Сохранить в макете</Button></> : undefined}>
      {panel === "breakdown" && <div className={s.panelStack}><PayrollEmployeeCell {...identity} /><Line label="Оклад">{rub(salary)}</Line><Line label="Выходы">{rub(shifts.reduce((sum, shift) => sum + (shift.substitute ? shift.fixed ?? 0 : shiftRate(shift)), 0))}</Line><Line label="Процент от выручки">{rub(totalComponent(percentage))}</Line><Line label="Дополнительные продажи">{rub(totalComponent(extrasAmount))}</Line><Line label="Надбавки за смены">{rub(totalComponent(supplements))}</Line><button className={s.detailLink} onClick={() => open("allowance")}><span>Надбавка за месяц</span><strong>{rub(allowance)}<ChevronRight size={14} /></strong></button><button className={s.detailLink} onClick={() => open("premium")}><span>Премия</span><strong className={s.positive}>+ {rub(premium)}<ChevronRight size={14} /></strong></button><Line label="Штраф"><span className={s.negative}>− {rub(800)}</span></Line>{!!correction && <Line label="Корректировка">{rub(correction)}</Line>}<div className={s.panelTotal}><span>Итого начислено</span><strong>{rub(earned)}</strong></div></div>}
      {editable && <div className={s.panelStack}><PayrollEmployeeCell {...identity} /><Line label="Месяц начисления">Октябрь 2026</Line><div className={s.field}><Label htmlFor="entry-amount">Сумма, ₽</Label><Input id="entry-amount" type="number" min={panel === "correction" ? undefined : 0} value={entryAmount} onChange={event => setEntryAmount(panel === "correction" ? Number(event.target.value) : Math.max(0, Number(event.target.value)))} /></div><div className={s.field}><Label htmlFor="entry-reason">{panel === "allowance" ? "Основание / KPI" : "Основание"}</Label><Textarea id="entry-reason" value={entryReason} onChange={event => setEntryReason(event.target.value)} rows={3} aria-invalid={!!entryError} />{entryError && <p role="alert" className={s.negative}>{entryError}</p>}</div></div>}
      {panel === "conditions" && <div className={s.panelStack}><PayrollEmployeeCell {...identity} /><Line label="Основная должность">{master}</Line><Line label="Оклад за месяц">{rub(salary)}</Line><Line label="Сменная часть">По должности в смене</Line><Button variant="outline" onClick={() => { setPanel(null); selectView("role"); }}>Оплата должности<ArrowRight /></Button></div>}
      {panel === "shift" && <div className={s.panelStack}><PayrollEmployeeCell name={identity.name} role={selectedShift.role} /><div className={s.shiftContext}><span>{selectedShift.date}</span><span>{selectedShift.crew === 1 ? "В одиночку" : "Вдвоём"}</span></div><div className={s.shiftBreakdown}>
        <Line label="Выход" hint={selectedShift.substitute ? "По условиям менеджера" : selectedShift.crew === 1 ? "Ставка одиночной смены" : "Ставка командной смены"}>{rub(selectedShift.substitute ? selectedShift.fixed ?? 0 : shiftRate(selectedShift))}</Line>
        {!selectedShift.substitute && <><Line label="Процент от выручки" hint={rules.percentEnabled ? `${basisLabels[rules.basis]}: ${rub(selectedShift.sales[rules.basis])} × ${selectedShift.crew === 1 ? rules.solo : rules.team}%` : "Начисление выключено"}>{rub(percentage(selectedShift))}</Line><Line label="Дополнительные продажи" hint={rules.extrasEnabled ? `${rub(selectedShift.extras)} / ${selectedShift.crew} ${selectedShift.crew === 1 ? "сотрудник" : "сотрудника"}` : "Начисление выключено"}>{rub(extrasAmount(selectedShift))}</Line><Line label="Знания" hint="Тест подтверждён">{rub(rules.knowledge)}</Line><Line label="Питание">{rub(rules.food)}</Line>{selectedShift.cleanerAbsent && <Line label="Клининг" hint="Клиннер отсутствовал">{rub(rules.cleaner)}</Line>}</>}
        </div><div className={s.panelTotal}><span>Начислено за смену</span><strong>{rub(shiftAmount(selectedShift))}</strong></div><div className={s.tipLine}><span>Чаевые</span><strong>{rub(selectedShift.tips)}</strong></div></div>}
      {panel === "salaryRule" && <div className={s.panelStack}><div className={s.enableRule}><Label htmlFor="salary-enabled">Начислять месячный оклад</Label><Switch id="salary-enabled" checked={draft.salaryEnabled} onCheckedChange={checked => setDraft({ ...draft, salaryEnabled: checked })} /></div>{draft.salaryEnabled && <NumericField id="salary-amount" label="Сумма за месяц" value={draft.salary} onChange={value => setDraft({ ...draft, salary: value })} />}<Line label="Начало действия">1 октября 2026</Line></div>}
      {panel === "shiftRule" && <div className={s.panelStack}><div className={s.enableRule}><Label htmlFor="shift-enabled">Оплачивать выход</Label><Switch id="shift-enabled" checked={draft.shiftEnabled} onCheckedChange={checked => setDraft({ ...draft, shiftEnabled: checked })} /></div>{draft.shiftEnabled && <TeamRates id="shift-rate" solo={draft.shiftSolo} team={draft.shiftTeam} onChange={(shiftSolo, shiftTeam) => setDraft({ ...draft, shiftSolo, shiftTeam })} />}</div>}
      {panel === "percentRule" && <div className={s.panelStack}><div className={s.enableRule}><Label htmlFor="percent-enabled">Начислять процент</Label><Switch id="percent-enabled" checked={draft.percentEnabled} onCheckedChange={checked => setDraft({ ...draft, percentEnabled: checked })} /></div>{draft.percentEnabled && <><div className={s.field}><Label htmlFor="sales-basis">База расчёта</Label><Select value={draft.basis} onValueChange={value => setDraft({ ...draft, basis: value as Basis })}><SelectTrigger id="sales-basis" className="h-10 shadow-none"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(basisLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div><TeamRates id="percent" solo={draft.solo} team={draft.team} onChange={(solo, team) => setDraft({ ...draft, solo, team })} unit="%" /></>}</div>}
      {panel === "extrasRule" && <div className={s.panelStack}><div className={s.enableRule}><Label htmlFor="extras-enabled">Учитывать дополнительные продажи</Label><Switch id="extras-enabled" checked={draft.extrasEnabled} onCheckedChange={checked => setDraft({ ...draft, extrasEnabled: checked })} /></div><Line label="Источник">Quick Resto</Line><Line label="Распределение">Поровну между мастерами</Line><Line label="Состав команды">За рабочий день</Line></div>}
      {panel === "supplementsRule" && <div className={s.panelStack}><NumericField id="knowledge-amount" label="За знания, после подтверждения теста" value={draft.knowledge} onChange={knowledge => setDraft({ ...draft, knowledge })} /><NumericField id="food-amount" label="На питание за смену" value={draft.food} onChange={food => setDraft({ ...draft, food })} /><NumericField id="cleaner-amount" label="За клининг, если нет клиннера" value={draft.cleaner} onChange={cleaner => setDraft({ ...draft, cleaner })} /></div>}

      {panel === "history" && <div className={s.panelStack}>{changes.map((change, index) => <div key={`${index}-${change}`} className={s.historyItem}><strong>{change}</strong><small>Текущий сеанс · пример</small></div>)}<div className={s.historyItem}><strong>Создан пример условий должности</strong><small>Оклад 20 000 ₽ · процент 6% / 8%</small></div></div>}
      {panel === "payment" && <div className={s.panelStack}><PayrollEmployeeCell {...identity} /><div className={s.panelTotal}><span>Выплата зарплаты</span><strong>{rub(paid)}</strong></div><Line label="Дата выплаты">15 октября 2026</Line><Line label="За какой месяц">Октябрь 2026</Line><Line label="Счёт списания">Касса CHILLING</Line><Line label="Статья расхода">ФОТ / {master}</Line><span className={s.status}>Проведено</span></div>}
    </PayrollDetailDialog>
  </PageFrame>;
}
