"use client";
import { useEffect, useState } from "react";
import { Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Metric, MetricStrip } from "@/components/shared/metric-strip";
import { Money } from "@/components/shared/money";
import { unwrapAction } from "@/lib/actions/result";
import type { KpiMonthView } from "@/lib/payroll/kpi-month";
import { transferMonthLabel } from "@/lib/payroll/transfer-reason";
import { loadKpiMonth } from "../kpi-actions";
import { KpiChecklistDialog } from "./kpi-checklist-dialog";
import { AlcoholPlanDialog } from "./alcohol-plan-dialog";

const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });

/** Вкладка «KPI» зарплаты: итоги старших за месяц и план продаж алкоголя на следующий. */
export function KpiTab({ month }: { month: string }) {
  const [view, setView] = useState<KpiMonthView | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [planOpen, setPlanOpen] = useState<"this" | "next" | null>(null);

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
      <div className="mt-4 space-y-2" aria-label="Загрузка KPI">
        {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );

  const label = transferMonthLabel(view.month);
  if (!view.people.length)
    return (
      <EmptyState
        className="mt-6"
        icon={Target}
        title={`KPI за ${label} не подводятся`}
        description="Пункты KPI задаются в условиях оплаты должности: «Сотрудники» → «Должности» → должность → «Оплата». Итоги в приложении подводятся с ноября 2026."
      />
    );

  const done = view.people.filter((p) => p.review).length;
  const total = view.people.reduce((s, p) => s + (p.review?.total ?? 0), 0);
  const person = view.people.find((p) => p.employeeId === open) ?? null;
  const hasPlanItem = view.people.some((p) => p.items.some((i) => i.type === "plan"));
  const percent = view.plan.target && view.plan.actual != null
    ? `${(Math.floor((view.plan.actual / view.plan.target) * 10000) / 100).toLocaleString("ru-RU")}%`
    : null;

  return (
    <div className="mt-4 space-y-4">
      <MetricStrip label={`Итоги KPI за ${label}`}>
        <Metric primary label="Подведено" value={`${done} из ${view.people.length}`} />
        <Metric label="Премии KPI" value={<Money value={total} />} hint="Уходят во вторую выплату" />
        {hasPlanItem && (
          <Metric
            label="План алкоголя"
            value={view.plan.target != null ? <Money value={view.plan.target} /> : "Не задан"}
            hint={view.plan.actual != null ? `Факт ${view.plan.actual.toLocaleString("ru-RU")} ₽${percent ? ` · ${percent}` : ""}` : "Ждём отчёт Quick Resto"}
          />
        )}
      </MetricStrip>
      {view.blocked && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">{view.blocked}</p>}
      <ul className="divide-y rounded-lg border">
        {view.people.map((p) => (
          <li key={p.employeeId} className="flex min-w-0 flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
              <p className="truncate text-sm font-medium">{p.name}</p>
              <p className="text-[13px] text-muted-foreground">{p.roleName}{p.since ? ` с ${dayLabel(p.since)}` : ""}</p>
            </div>
            {p.review ? (
              <StatusBadge tone="success" className="mr-auto sm:mr-0">Подведены · <Money value={p.review.total} /></StatusBadge>
            ) : (
              <StatusBadge tone="warning" className="mr-auto sm:mr-0">Не подведены</StatusBadge>
            )}
            <Button size="sm" variant={p.review ? "outline" : "default"} onClick={() => setOpen(p.employeeId)}>
              {!view.canSave || view.blocked || p.blocked ? "Открыть" : p.review ? "Изменить" : "Подвести итоги"}
            </Button>
          </li>
        ))}
      </ul>
      {hasPlanItem && view.plan.target == null && (
        <section aria-label={`План продаж алкоголя на ${label}`} className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">План продаж алкоголя на {label} не задан</p>
            <p className="text-[13px] text-muted-foreground">
              {done > 0 ? "Итоги месяца уже подведены — план этого месяца больше не меняется" : "Без плана пункт «План продаж алкоголя» не засчитается"}
            </p>
          </div>
          {view.canSave && done === 0 && (
            <Button size="sm" variant="outline" onClick={() => setPlanOpen("this")}>Задать план</Button>
          )}
        </section>
      )}
      {hasPlanItem && (
        <section aria-label="План продаж алкоголя" className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border p-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">План продаж алкоголя на {transferMonthLabel(view.next.month)}</p>
            <p className="text-[13px] text-muted-foreground">
              {view.next.current != null ? <Money value={view.next.current} /> : "Не задан"}
              {view.next.current == null && view.next.suggestion.amount != null && (
                <> · приложение предлагает <Money value={view.next.suggestion.amount} /></>
              )}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setPlanOpen("next")}>
            {!view.canSave ? "Открыть" : view.next.current != null ? "Изменить план" : "Задать план"}
          </Button>
        </section>
      )}
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
            // План следующего месяца задаём сразу после итогов, если его ещё нет.
            if (next.next.current == null && hasPlanItem) setPlanOpen("next");
          }}
        />
      )}
      {planOpen && (
        <AlcoholPlanDialog
          key={planOpen}
          open
          which={planOpen}
          onOpenChange={(v) => { if (!v) setPlanOpen(null); }}
          view={view}
          onSaved={(next) => { setView(next); setPlanOpen(null); }}
        />
      )}
    </div>
  );
}
