"use client";
import { useEffect, useState } from "react";
import { Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Metric, MetricStrip } from "@/components/shared/metric-strip";
import { Money } from "@/components/shared/money";
import { EmployeeIdentity } from "@/components/shared/employee-identity";
import { unwrapAction } from "@/lib/actions/result";
import { kpiResult, type KpiAnswers } from "@/lib/payroll/kpi";
import type { KpiMonthPerson, KpiMonthView } from "@/lib/payroll/kpi-month";
import { transferMonthLabel } from "@/lib/payroll/transfer-reason";
import { loadKpiMonth } from "../kpi-actions";
import { KpiChecklistDialog } from "./kpi-checklist-dialog";

const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
const pct = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
const points = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "пункта" : "пунктов");

/** Сколько пунктов выполнено: по сохранённым ответам и текущему плану. */
function progress(person: KpiMonthPerson, view: KpiMonthView): { done: number; total: number } {
  const answers: KpiAnswers = person.review?.answers ?? {};
  try {
    const { lines } = kpiResult(person.items, answers, view.plan);
    return { done: lines.filter((l) => l.counted).length, total: person.items.length };
  } catch {
    return { done: 0, total: person.items.length };
  }
}

function PersonCard({ person, view, onOpen }: { person: KpiMonthPerson; view: KpiMonthView; onOpen: () => void }) {
  const p = progress(person, view);
  const editable = view.canSave && !view.blocked && !person.blocked;
  // Пока месяц идёт, отмеченные итоги — нормальное состояние: план досчитаем после конца месяца.
  const waiting = person.review?.needsRecount && view.inProgress;
  const status = waiting
    ? <StatusBadge tone="neutral" tip="План по алкоголю засчитаем после конца месяца">Отмечено</StatusBadge>
    : person.review?.needsRecount
    ? <StatusBadge tone="warning" tip="План засчитаем, когда придёт отчёт продаж за месяц">Досчитать план</StatusBadge>
    : person.review
      ? <StatusBadge tone="success">Подведены</StatusBadge>
      : <StatusBadge tone="warning">Не подведены</StatusBadge>;
  return (
    <li className="flex min-w-0 flex-col gap-4 rounded-lg border bg-card p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <EmployeeIdentity
          name={person.name}
          role={person.since ? `${person.roleName} с ${dayLabel(person.since)}` : person.roleName}
          avatarUrl={person.avatarUrl}
        />
        {status}
      </div>
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-muted-foreground">{p.done} из {p.total} {points(p.total)}</span>
          <strong className="tabular-nums"><Money value={person.review?.total ?? 0} /></strong>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} />
        </div>
      </div>
      <Button size="sm" variant={person.review && (waiting || !person.review.needsRecount) ? "outline" : "default"} className="self-start" onClick={onOpen}>
        {!editable ? "Открыть" : waiting ? "Изменить" : person.review?.needsRecount ? "Досчитать" : person.review ? "Изменить" : "Отметить итоги"}
      </Button>
    </li>
  );
}

/** Вкладка «KPI» зарплаты: итоги старших за месяц; план доли алкоголя — из «Статистики». */
export function KpiTab({ month }: { month: string }) {
  const [view, setView] = useState<KpiMonthView | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setView(null);
    setError("");
    loadKpiMonth(month)
      .then(unwrapAction)
      .then((v) => { if (alive) setView(v); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : "Не удалось загрузить KPI"); });
    return () => { alive = false; };
  }, [month]);

  if (error) return <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">{error}</p>;
  if (!view)
    return (
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Загрузка KPI">
        {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-40 w-full" />)}
      </div>
    );

  const label = transferMonthLabel(view.month);
  if (!view.people.length)
    return (
      <EmptyState
        className="mt-6"
        icon={Target}
        title={`KPI за ${label} не подводятся`}
        description="Пункты KPI задаются в условиях оплаты должности: «Люди» → «Должности» → должность → «Оплата труда». Итоги в приложении подводятся с ноября 2026."
      />
    );

  const done = view.people.filter((p) => p.review && !p.review.needsRecount).length;
  const total = view.people.reduce((s, p) => s + (p.review?.total ?? 0), 0);
  const person = view.people.find((p) => p.employeeId === open) ?? null;
  const hasPlanItem = view.people.some((p) => p.items.some((i) => i.type === "plan"));
  const planHref = view.canPlan ? `/sales/statistics?plan=${view.month.slice(0, 7)}` : undefined;
  const shareHint = view.plan.target === null
    ? (view.canPlan ? "Задайте в «Статистике»" : "План месяца ещё не задан")
    : view.plan.actual !== null
      ? `Факт ${pct(view.plan.actual)}${view.plan.actual >= view.plan.target ? " · выполнен" : " · не выполнен"}`
      : view.plan.pending === "month"
        ? `Сейчас ${view.plan.now !== null ? pct(view.plan.now) : "—"} · засчитаем после конца месяца`
        : "Ждём отчёт Quick Resto";
  const caption = view.blocked ?? (view.inProgress ? `${label.replace(/^./, (c) => c.toUpperCase())} идёт: итоги можно отмечать уже сейчас, план по алкоголю засчитаем после конца месяца.` : null);

  return (
    <div className="mt-4 space-y-4">
      <MetricStrip label={`Итоги KPI за ${label}`}>
        <Metric primary label="Подведено" value={`${done} из ${view.people.length}`} />
        <Metric label="Премии KPI" value={<Money value={total} />} hint="Уходят во вторую выплату" />
        {hasPlanItem && (
          <Metric
            label="Доля алкоголя"
            value={view.plan.target !== null ? `план ${pct(view.plan.target)}` : "Не задан"}
            hint={shareHint}
            href={planHref}
          />
        )}
      </MetricStrip>
      {caption && <p className="text-[13px] text-muted-foreground">{caption}</p>}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {view.people.map((p) => (
          <PersonCard key={p.employeeId} person={p} view={view} onOpen={() => setOpen(p.employeeId)} />
        ))}
      </ul>
      {person && (
        <KpiChecklistDialog
          key={person.employeeId}
          open
          onOpenChange={(v) => { if (!v) setOpen(null); }}
          view={view}
          person={person}
          onSaved={(next) => {
            setView(next);
            setOpen(null);
          }}
        />
      )}
    </div>
  );
}
