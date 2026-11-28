"use client";
import { useEffect, useState } from "react";
import { Info, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Field } from "@/components/ui/field";
import { DatePicker } from "@/components/ui/date-picker";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { ProfileTabsList, Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { MonthPicker } from "@/components/shared/month-picker";
import { PeriodStepper } from "@/components/shared/period-stepper";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { formatRub } from "@/components/shared/money";
import { unwrapAction } from "@/lib/actions/result";
import type { Forecast } from "@/lib/sales/forecast";
import type { MonthPlanView } from "@/lib/sales/plan-data";
import { OWNER_SEASON_NOTE } from "@/lib/sales/seasonality";
import { deletePriceChange, loadMonthPlan, saveMonthPlan, savePriceChange, saveSeasonality } from "../plan-actions";

export type PlanTab = "plan" | "prices" | "season";

const ESTIMATE: Record<string, string> = { yoy: "год к году", mom: "месяц к месяцу", level: "уровень" };
const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const pct = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
const signed = (p: number) => `${p > 0 ? "+" : ""}${p.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
const index = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/\s/g, "").replace(",", ".")));
const dayLabel = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).replace(" г.", "");
const shift = (ym: string, by: number) => {
  const d = new Date(`${ym}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
};
const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

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

/**
 * План продаж — одна панель с вкладками (как «Новый сотрудник»): план месяца,
 * изменения цен и сезонность. Цены и сезонность общие для всех месяцев и
 * влияют на прогноз плана, поэтому живут рядом с ним, а не в отдельных панелях.
 */
export function MonthPlanDrawer({ open, onOpenChange, month: initialMonth, currentMonth, onSaved }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** «2026-12» */
  month: string;
  currentMonth: string;
  onSaved: () => void;
}) {
  const [tab, setTab] = useState<PlanTab>("plan");
  const [month, setMonth] = useState(initialMonth);
  const [view, setView] = useState<MonthPlanView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"plan" | "price" | "season" | "reset" | null>(null);
  // План
  const [turnover, setTurnover] = useState("");
  const [share, setShare] = useState("");
  // Цены
  const [day, setDay] = useState("");
  const [percent, setPercent] = useState("");
  const [note, setNote] = useState("");
  // Сезонность
  const [season, setSeason] = useState<string[]>([]);
  const { confirm, dialog } = useConfirm();

  const showPlan = (v: MonthPlanView) => {
    setTurnover(v.turnover.plan != null ? String(v.turnover.plan) : "");
    setShare(v.alcoholShare.plan != null ? String(v.alcoholShare.plan) : "");
  };
  const showSeason = (v: MonthPlanView) => setSeason(v.season.index.map((x) => String(x)));

  useEffect(() => {
    if (!open) return;
    setTab("plan");
    setMonth(initialMonth);
    setDay(""); setPercent(""); setNote("");
  }, [open, initialMonth]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setView(null);
    setError("");
    loadMonthPlan(month).then(unwrapAction).then((v) => {
      if (!alive) return;
      setView(v);
      showPlan(v);
      showSeason(v);
    }).catch((e) => alive && setError(message(e, "Не удалось загрузить план месяца")));
    return () => { alive = false; };
  }, [open, month]);

  const canEdit = view?.canEdit ?? false;
  const frozen = view?.alcoholShare.frozen ?? false;

  const savePlan = async () => {
    if (!view) return;
    const t = num(turnover);
    // Замороженная доля (итоги KPI подведены) уходит как есть.
    const sh = frozen ? view.alcoholShare.plan : num(share);
    if (t !== null && (!Number.isFinite(t) || t <= 0)) return toast.error("План оборота должен быть больше нуля");
    if (sh !== null && (!Number.isFinite(sh) || sh < 0.1 || sh > 100)) return toast.error("Доля алкоголя — от 0,1 до 100%");
    setBusy("plan");
    try {
      setView(unwrapAction(await saveMonthPlan({ month, turnover: t, alcoholShare: sh })));
      toast.success("План утверждён");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(message(e, "Не удалось сохранить план"));
    } finally {
      setBusy(null);
    }
  };

  const addPrice = async () => {
    const p = num(percent);
    if (!day) return toast.error("Укажите, с какого дня");
    if (p === null || !Number.isFinite(p) || p === 0) return toast.error("Укажите рост чека в процентах");
    setBusy("price");
    try {
      // Цены и сезонность меняют прогноз: берём свежий экран, введённый план не трогаем.
      setView(unwrapAction(await savePriceChange({ month, date: day, percent: p, note })));
      setDay(""); setPercent(""); setNote("");
      toast.success("Изменение цен записано");
    } catch (e) {
      toast.error(message(e, "Не удалось записать изменение цен"));
    } finally {
      setBusy(null);
    }
  };
  const removePrice = async (id: string, label: string) => {
    if (!(await confirm({ title: "Удалить изменение цен?", description: label, confirmLabel: "Удалить изменение", destructive: true }))) return;
    try {
      setView(unwrapAction(await deletePriceChange(month, id)));
    } catch (e) {
      toast.error(message(e, "Не удалось удалить изменение цен"));
    }
  };

  const saveSeason = async (reset: boolean) => {
    let values: number[] | null = null;
    if (!reset) {
      const parsed = season.map((v) => Number(v.replace(",", ".")));
      if (parsed.some((v) => !Number.isFinite(v) || v <= 0)) return toast.error("Индексы — положительные числа");
      values = parsed;
    }
    setBusy(reset ? "reset" : "season");
    try {
      const v = unwrapAction(await saveSeasonality(month, values));
      setView(v);
      showSeason(v);
      toast.success(reset ? "Вернули сезонность Росстата" : "Сезонность сохранена");
    } catch (e) {
      toast.error(message(e, "Не удалось сохранить сезонность"));
    } finally {
      setBusy(null);
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
  const hasOwnSeason = view?.season.own.some((v) => v !== null) ?? false;
  const spinner = (kind: typeof busy) => busy === kind && <Loader2 className="size-4 animate-spin" />;

  const cancel = <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy !== null}>Отмена</Button>;
  const footer = !canEdit ? undefined : tab === "plan" ? (
    <>
      {cancel}
      <Button onClick={() => void savePlan()} disabled={busy !== null || !view}>
        {spinner("plan")}{busy === "plan" ? "Утверждаем…" : "Утвердить план"}
      </Button>
    </>
  ) : tab === "prices" ? (
    <>
      {cancel}
      <Button onClick={() => void addPrice()} disabled={busy !== null || !view}>
        {spinner("price")}{busy === "price" ? "Записываем…" : "Записать изменение"}
      </Button>
    </>
  ) : (
    <>
      {view?.season.custom ? (
        <Button variant="outline" onClick={() => void saveSeason(true)} disabled={busy !== null}>
          {spinner("reset")}Вернуть Росстат
        </Button>
      ) : cancel}
      <Button onClick={() => void saveSeason(false)} disabled={busy !== null || !view}>
        {spinner("season")}{busy === "season" ? "Сохраняем…" : "Сохранить сезонность"}
      </Button>
    </>
  );

  const loading = (h: string) =>
    error ? <p role="alert" className="text-sm text-destructive">{error}</p> : <Skeleton className={`${h} w-full`} />;

  return (
    <EditDrawer
      open={open}
      onOpenChange={(v) => { if (!busy) onOpenChange(v); }}
      title="План продаж"
      footer={footer}
    >
      <Tabs value={tab} onValueChange={(v) => setTab(v as PlanTab)}>
        <ProfileTabsList>
          <TabsTrigger value="plan" disabled={busy !== null}>План</TabsTrigger>
          <TabsTrigger value="prices" disabled={busy !== null}>Цены</TabsTrigger>
          <TabsTrigger value="season" disabled={busy !== null}>Сезонность</TabsTrigger>
        </ProfileTabsList>

        <TabsContent value="plan" className="mt-5 grid gap-5">
          <div className="flex">
            <PeriodStepper
              previous="Предыдущий месяц"
              next="Следующий месяц"
              previousDisabled={month <= "2025-01" || busy !== null}
              nextDisabled={busy !== null}
              onPrevious={() => setMonth(shift(month, -1))}
              onNext={() => setMonth(shift(month, 1))}
            >
              <MonthPicker variant="period" prefix="" ariaLabel="Месяц плана" value={`${month}-01`} min="2025-01-01" onChange={(v) => setMonth(v.slice(0, 7))} />
            </PeriodStepper>
          </div>
          {!view ? loading("h-48") : (
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
        </TabsContent>

        <TabsContent value="prices" className="mt-5 grid gap-5">
          {!view ? loading("h-48") : (
            <>
              {canEdit && (
                <DrawerSection title="Новое изменение">
                  <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
                    <Field label="С какого дня">{(control) => <DatePicker {...control} value={day} onChange={setDay} />}</Field>
                    <Field label={<span className="cursor-help" data-tip="Средний рост чека по всему меню" data-tip-sub="Подняли часть меню — пересчитайте в средний рост чека">Рост чека, %</span>}>
                      {(control) => <Input {...control} type="number" inputMode="decimal" step="0.1" className="text-base sm:text-sm" value={percent} onChange={(e) => setPercent(e.target.value)} />}
                    </Field>
                  </div>
                  <Field label="Комментарий">
                    {(control) => <Input {...control} maxLength={300} className="text-base sm:text-sm" value={note} placeholder="Бар +8%" onChange={(e) => setNote(e.target.value)} />}
                  </Field>
                </DrawerSection>
              )}
              <DrawerSection title="Записанные">
                {view.prices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Изменений цен нет</p>
                ) : (
                  <ul className="divide-y">
                    {[...view.prices].reverse().map((p) => (
                      <li key={p.id} className="flex min-w-0 items-center gap-3 py-2.5 text-sm">
                        <span className="w-36 shrink-0 tabular-nums">{dayLabel(p.date)}</span>
                        <span className="w-16 shrink-0 font-medium tabular-nums">{signed(p.percent)}</span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">{p.note}</span>
                        {canEdit && (
                          <Button variant="ghost" size="sm" className="w-9 shrink-0 px-0 text-destructive touch-target" aria-label="Удалить изменение цен" data-tip="Удалить"
                            onClick={() => void removePrice(p.id, `${dayLabel(p.date)}, ${signed(p.percent)}`)}>
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </DrawerSection>
            </>
          )}
        </TabsContent>

        <TabsContent value="season" className="mt-5">
          {!view ? loading("h-96") : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">
                    <span className="inline-flex cursor-help items-center gap-1" data-tip="Оборот дня месяца к среднему дню года" data-tip-sub="Прогноз плана переносит прошлые месяцы на нужный по этим индексам">
                      Месяц <Info className="size-3.5" aria-hidden />
                    </span>
                  </th>
                  <th className="pb-2 font-medium">
                    <span className="inline-flex cursor-help items-center gap-1" data-tip={`${view.season.source}. ${view.season.note}`} data-tip-sub={OWNER_SEASON_NOTE}>
                      Росстат <Info className="size-3.5" aria-hidden />
                    </span>
                  </th>
                  {hasOwnSeason && <th className="pb-2 font-medium">Ваши данные</th>}
                  <th className="pb-2 text-right font-medium">В прогнозе</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {MONTHS.map((name, i) => (
                  <tr key={name}>
                    <td className="py-1.5">{name}</td>
                    <td className="py-1.5 tabular-nums text-muted-foreground">{index(view.season.industry[i])}</td>
                    {hasOwnSeason && <td className="py-1.5 tabular-nums text-muted-foreground">{view.season.own[i] == null ? "—" : index(view.season.own[i]!)}</td>}
                    <td className="py-1.5 text-right">
                      <Input type="number" inputMode="decimal" step="0.01" min={0.01} aria-label={`Индекс: ${name}`}
                        className="ml-auto h-9 w-24 text-right text-base tabular-nums sm:text-sm"
                        value={season[i] ?? ""} disabled={!canEdit} onChange={(e) => setSeason(season.map((v, j) => (j === i ? e.target.value : v)))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TabsContent>
      </Tabs>
      {dialog}
    </EditDrawer>
  );
}
