"use client";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Field } from "@/components/ui/field";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { MonthPicker } from "@/components/shared/month-picker";
import { PeriodStepper } from "@/components/shared/period-stepper";
import { formatRub } from "@/components/shared/money";
import { unwrapAction } from "@/lib/actions/result";
import type { Forecast } from "@/lib/sales/forecast";
import type { MonthPlanView } from "@/lib/sales/plan-data";
import { loadMonthPlan, saveMonthPlan } from "../plan-actions";

const ESTIMATE: Record<string, string> = { yoy: "год к году", mom: "месяц к месяцу", level: "уровень" };
const pct = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/\s/g, "").replace(",", ".")));
const shift = (ym: string, by: number) => {
  const d = new Date(`${ym}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
};

/** Строка под полем: прогноз и факт. Из чего сложен прогноз — в подсказке, а не текстом в панели. */
function ForecastLine({ forecast, format, fact }: { forecast: Forecast; format: (v: number) => string; fact: string | null }) {
  const parts = forecast.estimates.map((e) => `${ESTIMATE[e.key]} ${format(e.value)} (${Math.round(e.weight * 100)}%)`);
  return (
    <span>
      {forecast.value === null ? (
        "Для прогноза мало данных"
      ) : (
        <span className="cursor-help underline decoration-dotted underline-offset-2" data-tip={`Прогноз: ${parts.join(" · ")}`}
          data-tip-sub="Учтены сезонность, изменения цен и дни недели">
          Прогноз {format(forecast.value)}
        </span>
      )}
      {forecast.diverge && <span className="text-amber-700 dark:text-amber-400"> · оценки расходятся</span>}
      {fact && <> · {fact}</>}
    </span>
  );
}

/** План месяца: оборот и доля алкоголя в очищенном обороте, с прогнозом приложения. */
export function MonthPlanDrawer({ open, onOpenChange, month: initialMonth, currentMonth, onSaved }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** «2026-12» */
  month: string;
  currentMonth: string;
  onSaved: () => void;
}) {
  const [month, setMonth] = useState(initialMonth);
  const [view, setView] = useState<MonthPlanView | null>(null);
  const [error, setError] = useState("");
  const [turnover, setTurnover] = useState("");
  const [share, setShare] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) setMonth(initialMonth); }, [open, initialMonth]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setView(null);
    setError("");
    loadMonthPlan(month).then(unwrapAction).then((v) => {
      if (!alive) return;
      setView(v);
      setTurnover(v.turnover.plan != null ? String(v.turnover.plan) : "");
      setShare(v.alcoholShare.plan != null ? String(v.alcoholShare.plan) : "");
    }).catch((e) => alive && setError(e instanceof Error ? e.message : "Не удалось загрузить план месяца"));
    return () => { alive = false; };
  }, [open, month]);

  const canEdit = view?.canEdit ?? false;
  const frozen = view?.alcoholShare.frozen ?? false;

  const save = async () => {
    if (!view) return;
    const t = num(turnover);
    // Замороженная доля (итоги KPI подведены) уходит как есть.
    const sh = frozen ? view.alcoholShare.plan : num(share);
    if (t !== null && (!Number.isFinite(t) || t <= 0)) return toast.error("План оборота должен быть больше нуля");
    if (sh !== null && (!Number.isFinite(sh) || sh < 0.1 || sh > 100)) return toast.error("Доля алкоголя — от 0,1 до 100%");
    setBusy(true);
    try {
      setView(unwrapAction(await saveMonthPlan({ month, turnover: t, alcoholShare: sh })));
      toast.success("План утверждён");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить план");
    } finally {
      setBusy(false);
    }
  };

  const factTurnover = view?.turnover.fact != null
    ? `факт${month >= currentMonth ? " на сейчас" : ""} ${formatRub(view.turnover.fact)}${view.turnover.plan ? ` (${Math.round((view.turnover.fact / view.turnover.plan) * 100)}%)` : ""}`
    : null;
  const factShare = view?.alcoholShare.fact != null ? `факт${view.alcoholShare.pending === "month" ? " на сейчас" : ""} ${pct(view.alcoholShare.fact)}` : null;
  // Действие над значением поля — текстовая ссылка справа в строке подписи (DS «Боковая панель»).
  const fill = (value: number | null, set: (v: string) => void) =>
    value !== null && canEdit ? (
      <button type="button" className="text-[13px] font-normal text-brand hover:underline" onClick={() => set(String(value))}>
        Подставить прогноз
      </button>
    ) : null;

  return (
    <EditDrawer
      open={open}
      onOpenChange={(v) => { if (!busy) onOpenChange(v); }}
      title="План месяца"
      footer={canEdit ? (
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Отмена</Button>
          <Button onClick={save} disabled={busy || !view}>
            {busy && <Loader2 className="size-4 animate-spin" />}{busy ? "Утверждаем…" : "Утвердить план"}
          </Button>
        </>
      ) : undefined}
    >
      <div className="flex">
      <PeriodStepper
        previous="Предыдущий месяц"
        next="Следующий месяц"
        previousDisabled={month <= "2025-01"}
        onPrevious={() => setMonth(shift(month, -1))}
        onNext={() => setMonth(shift(month, 1))}
      >
        <MonthPicker variant="period" prefix="" ariaLabel="Месяц плана" value={`${month}-01`} min="2025-01-01" onChange={(v) => setMonth(v.slice(0, 7))} />
      </PeriodStepper>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!view && !error && <div className="space-y-4">{[0, 1].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div>}
      {view && (
        <>
          <DrawerSection title="Оборот">
            <Field
              label={<span className="flex w-full items-center justify-between gap-3"><span>План, ₽</span>{fill(view.turnover.forecast.value, setTurnover)}</span>}
              hint={<ForecastLine forecast={view.turnover.forecast} format={(v) => formatRub(v)} fact={factTurnover} />}
            >
              {(control) => (
                <Input {...control} type="number" inputMode="decimal" min={1} step="any" className="text-base sm:text-sm"
                  value={turnover} disabled={!canEdit} placeholder="Не задан" onChange={(e) => setTurnover(e.target.value)} />
              )}
            </Field>
          </DrawerSection>
          <DrawerSection title="Доля алкоголя">
            <Field
              label={<span className="flex w-full items-center justify-between gap-3">
                <span className="cursor-help" data-tip="Продажи алкоголя по отчёту Quick Resto к очищенному обороту" data-tip-sub="Без столов сотрудников, депозитов, парковки, чаевых и сервисного сбора">
                  План, % оборота
                </span>
                {!frozen && fill(view.alcoholShare.forecast.value, setShare)}
              </span>}
              hint={frozen
                ? "Итоги KPI за этот месяц подведены — долю не меняем"
                : <ForecastLine forecast={view.alcoholShare.forecast} format={pct} fact={factShare} />}
            >
              {(control) => (
                <Input {...control} type="number" inputMode="decimal" min={0.1} max={100} step="0.1" className="text-base sm:text-sm"
                  value={share} disabled={!canEdit || frozen} placeholder="Не задан" onChange={(e) => setShare(e.target.value)} />
              )}
            </Field>
          </DrawerSection>
        </>
      )}
    </EditDrawer>
  );
}
