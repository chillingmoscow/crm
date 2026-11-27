"use client";
import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MonthPicker } from "@/components/shared/month-picker";
import { Money, formatRub } from "@/components/shared/money";
import { DatePicker } from "@/components/ui/date-picker";
import { unwrapAction } from "@/lib/actions/result";
import type { Forecast } from "@/lib/sales/forecast";
import type { MonthPlanView } from "@/lib/sales/plan-data";
import { OWNER_SEASON_NOTE } from "@/lib/sales/seasonality";
import { deletePriceChange, loadMonthPlan, saveMonthPlan, savePriceChange, saveSeasonality } from "../plan-actions";

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`);
const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/\s/g, "").replace(",", ".")));
const ESTIMATE: Record<string, string> = { yoy: "Год к году", mom: "Месяц к месяцу", level: "Уровень последних месяцев" };

/** Разбор прогноза: каждая оценка с основанием и весом. */
function ForecastBreakdown({ forecast, format }: { forecast: Forecast; format: (v: number) => React.ReactNode }) {
  if (forecast.value === null)
    return <p className="text-[13px] text-muted-foreground">Для прогноза пока мало данных — нужен хотя бы один полный месяц.</p>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Прогноз приложения:</span>
        <strong className="tabular-nums">{format(forecast.value)}</strong>
        {forecast.diverge && <StatusBadge tone="warning" tip="Оценки отличаются больше чем на 15% — проверьте каждую">Оценки расходятся</StatusBadge>}
      </div>
      <ul className="divide-y rounded-lg border text-[13px]">
        {forecast.estimates.map((e) => (
          <li key={e.key} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 p-2.5">
            <span className="font-medium">{ESTIMATE[e.key]}</span>
            <span className="tabular-nums">{format(e.value)} · вес {Math.round(e.weight * 100)}%</span>
            <span className="w-full text-muted-foreground">{e.basis}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * План месяца в «Статистике»: оборот и доля алкоголя с прогнозом, журнал цен и
 * сезонность — единственное место, где задаётся план продаж.
 */
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
  const [priceDate, setPriceDate] = useState("");
  const [pricePercent, setPricePercent] = useState("");
  const [priceNote, setPriceNote] = useState("");
  const [season, setSeason] = useState<string[]>([]);

  useEffect(() => setMonth(initialMonth), [initialMonth]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setView(null);
    setError("");
    loadMonthPlan(month).then(unwrapAction).then((v) => {
      if (!alive) return;
      apply(v);
    }).catch((e) => alive && setError(e instanceof Error ? e.message : "Не удалось загрузить план месяца"));
    return () => { alive = false; };
  }, [open, month]);

  function apply(v: MonthPlanView) {
    setView(v);
    setTurnover(String(v.turnover.plan ?? v.turnover.forecast.value ?? ""));
    setShare(String(v.alcoholShare.plan ?? v.alcoholShare.forecast.value ?? ""));
    setSeason(v.season.index.map((x) => String(x)));
  }

  const run = async (fn: () => Promise<MonthPlanView>, done: string) => {
    setBusy(true);
    try {
      apply(await fn());
      toast.success(done);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const t = num(turnover), sh = num(share);
    if (t !== null && (!Number.isFinite(t) || t <= 0)) return toast.error("План оборота должен быть больше нуля");
    if (sh !== null && (!Number.isFinite(sh) || sh < 0.1 || sh > 100)) return toast.error("Доля алкоголя — от 0,1 до 100%");
    void run(async () => unwrapAction(await saveMonthPlan({ month, turnover: t, alcoholShare: sh })), `План на ${monthLabel(month)} утверждён`);
  };

  const canEdit = view?.canEdit ?? false;
  return (
    <EditDrawer
      open={open}
      onOpenChange={(v) => { if (!busy) onOpenChange(v); }}
      title={`План на ${monthLabel(month)}`}
      description="Оборот и доля алкоголя в очищенном обороте — прогноз приложения можно поправить"
      footer={canEdit ? (
        <div className="flex w-full flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Закрыть</Button>
          <Button onClick={save} disabled={busy || !view}>{busy && <Loader2 className="size-4 animate-spin" />}Утвердить план</Button>
        </div>
      ) : undefined}
    >
      <div className="space-y-2">
        <Label>Месяц</Label>
        <MonthPicker variant="field" prefix="" ariaLabel="Месяц плана" value={`${month}-01`} min="2025-01-01" onChange={(v) => setMonth(v.slice(0, 7))} />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!view && !error && <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>}
      {view && (
        <Tabs defaultValue="plan" className="space-y-4">
          <TabsList aria-label="План месяца">
            <TabsTrigger value="plan">План</TabsTrigger>
            <TabsTrigger value="prices">Цены · {view.prices.length}</TabsTrigger>
            <TabsTrigger value="season">Сезонность</TabsTrigger>
          </TabsList>

          <TabsContent value="plan" className="space-y-6">
            <DrawerSection title="Оборот">
              <div className="space-y-2">
                <Label htmlFor="plan-turnover">План оборота, ₽</Label>
                <Input id="plan-turnover" type="number" inputMode="decimal" min={1} step="any" className="text-base sm:text-sm"
                  value={turnover} disabled={!canEdit} onChange={(e) => setTurnover(e.target.value)} placeholder="Не задан" />
                {view.turnover.fact !== null && (
                  <p className="text-[13px] text-muted-foreground">
                    Факт{month >= currentMonth ? " на сейчас" : ""}: {formatRub(view.turnover.fact)}
                    {view.turnover.plan ? ` · ${pct(Math.round((view.turnover.fact / view.turnover.plan) * 1000) / 10)} плана` : ""}
                  </p>
                )}
              </div>
              <ForecastBreakdown forecast={view.turnover.forecast} format={(v) => <Money value={v} />} />
            </DrawerSection>
            <DrawerSection title="Доля алкоголя">
              <div className="space-y-2">
                <Label htmlFor="plan-share">План, % очищенного оборота</Label>
                <Input id="plan-share" type="number" inputMode="decimal" min={0.1} max={100} step="0.1" className="text-base sm:text-sm"
                  value={share} disabled={!canEdit || view.alcoholShare.frozen} onChange={(e) => setShare(e.target.value)} placeholder="Не задан" />
                {view.alcoholShare.frozen && <p className="text-[13px] text-muted-foreground">Итоги KPI за этот месяц подведены — долю менять нельзя.</p>}
                {view.alcoholShare.fact !== null && (
                  <p className="text-[13px] text-muted-foreground">
                    Факт{view.alcoholShare.pending === "month" ? " на сейчас" : ""}: {pct(view.alcoholShare.fact)}
                  </p>
                )}
              </div>
              <ForecastBreakdown forecast={view.alcoholShare.forecast} format={(v) => pct(v)} />
            </DrawerSection>
          </TabsContent>

          <TabsContent value="prices" className="space-y-4">
            <p className="text-[13px] text-muted-foreground">
              Изменение цен — средний рост чека по всему меню. Прогноз учитывает его с даты, внутри месяца — по доле дней.
            </p>
            <ul className="divide-y rounded-lg border">
              {view.prices.length === 0 && <li className="p-3 text-sm text-muted-foreground">Изменений цен нет</li>}
              {view.prices.map((p) => (
                <li key={p.id} className="flex min-w-0 items-center gap-3 p-3 text-sm">
                  <span className="tabular-nums">{new Date(`${p.date}T12:00:00Z`).toLocaleDateString("ru-RU", { timeZone: "UTC" })}</span>
                  <strong className="tabular-nums">{p.percent > 0 ? "+" : ""}{pct(p.percent)}</strong>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{p.note}</span>
                  {canEdit && (
                    <Button variant="ghost" size="sm" className="w-9 px-0" aria-label="Удалить изменение цен" data-tip="Удалить" disabled={busy}
                      onClick={() => void run(async () => unwrapAction(await deletePriceChange(month, p.id)), "Изменение цен удалено")}>
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {canEdit && (
              <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
                <div className="space-y-1"><Label>С какого дня</Label><DatePicker value={priceDate} onChange={setPriceDate} /></div>
                <div className="space-y-1">
                  <Label htmlFor="price-percent">Рост чека, %</Label>
                  <Input id="price-percent" type="number" inputMode="decimal" step="0.1" className="text-base sm:text-sm" value={pricePercent} onChange={(e) => setPricePercent(e.target.value)} />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="price-note">Комментарий</Label>
                  <Input id="price-note" maxLength={300} className="text-base sm:text-sm" value={priceNote} onChange={(e) => setPriceNote(e.target.value)} placeholder="Например: бар +8%, в среднем по чеку +4%" />
                </div>
                <Button variant="outline" className="sm:col-span-2 sm:justify-self-start" disabled={busy || !priceDate || !pricePercent}
                  onClick={() => {
                    const p = num(pricePercent);
                    if (p === null || !Number.isFinite(p) || p === 0) return toast.error("Укажите рост чека в процентах");
                    void run(async () => {
                      const v = unwrapAction(await savePriceChange({ month, date: priceDate, percent: p, note: priceNote }));
                      setPriceDate(""); setPricePercent(""); setPriceNote("");
                      return v;
                    }, "Изменение цен добавлено");
                  }}>
                  <Plus className="size-4" />Добавить
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="season" className="space-y-4">
            <p className="text-[13px] text-muted-foreground">
              Индекс — средний оборот дня месяца к среднему дню года. По умолчанию — {view.season.source}. {view.season.note} Как вы описывали сезоны: {OWNER_SEASON_NOTE.charAt(0).toLowerCase() + OWNER_SEASON_NOTE.slice(1)}
            </p>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="text-left text-[13px] text-muted-foreground">
                  <tr><th className="p-2 font-medium">Месяц</th><th className="p-2 font-medium">По умолчанию</th><th className="p-2 font-medium">Ваши данные</th><th className="p-2 font-medium">В прогнозе</th></tr>
                </thead>
                <tbody className="divide-y">
                  {MONTHS.map((name, i) => (
                    <tr key={name}>
                      <td className="p-2 first-letter:uppercase">{name}</td>
                      <td className="p-2 tabular-nums">{view.season.industry[i].toLocaleString("ru-RU")}</td>
                      <td className="p-2 tabular-nums text-muted-foreground">{view.season.own[i] == null ? "—" : view.season.own[i]!.toLocaleString("ru-RU")}</td>
                      <td className="p-2">
                        <Input type="number" inputMode="decimal" step="0.01" min={0.01} className="h-8 w-24 text-base sm:text-sm" aria-label={`Индекс: ${name}`}
                          value={season[i] ?? ""} disabled={!canEdit} onChange={(e) => setSeason(season.map((v, j) => (j === i ? e.target.value : v)))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!view.season.own.some((v) => v !== null) && (
              <p className="text-[13px] text-muted-foreground">«Ваши данные» появятся, когда в приложении будет полный год своих продаж.</p>
            )}
            {canEdit && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={busy}
                  onClick={() => {
                    const values = season.map((v) => num(v));
                    if (values.some((v) => v === null || !Number.isFinite(v) || v <= 0)) return toast.error("Индексы — положительные числа");
                    void run(async () => unwrapAction(await saveSeasonality(month, values as number[])), "Сезонность сохранена");
                  }}>Сохранить сезонность</Button>
                {view.season.custom && (
                  <Button variant="ghost" disabled={busy}
                    onClick={() => void run(async () => unwrapAction(await saveSeasonality(month, null)), "Вернули сезонность по умолчанию")}>
                    Вернуть по умолчанию
                  </Button>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </EditDrawer>
  );
}
