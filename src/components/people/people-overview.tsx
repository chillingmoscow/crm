"use client";
import { useEffect, useId, useState } from "react";
import {
  ChartNoAxesColumnIncreasing,
  ChevronUp,
  Info,
  RotateCcw,
} from "lucide-react";
import { getPeopleOverview } from "@/app/(dashboard)/people/overview-actions";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MonthPicker } from "@/components/shared/month-picker";
import { STATUSES } from "@/lib/candidates/types";
import {
  chartCeiling,
  overviewMonth,
  overviewTenure,
  type CandidateOverview,
  type OverviewKind,
  type PeopleOverviewData,
} from "@/lib/people/overview";
import { cn } from "@/lib/utils";
import styles from "./people-overview.module.css";

type Series = { label: string; count: number; color: string };
type Column = { label: string; description: string; values: Series[] };
function Hint({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={text}
          className="inline-flex shrink-0 rounded text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-xs leading-relaxed">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint: string;
}) {
  return (
    <div className={styles.metric}>
      <dt>
        <span>{label}</span>
        <Hint text={hint} />
      </dt>
      <dd>{value}</dd>
    </div>
  );
}
function EmptyChart({ children }: { children: React.ReactNode }) {
  return <p className={styles.empty}>{children}</p>;
}
function HorizontalBars({ items }: { items: (Series & { id: string })[] }) {
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <ul className={styles.horizontal}>
      {items.map((item) => (
        <li key={item.id}>
          <span className={styles.barLabel}>{item.label}</span>
          <span className={styles.barTrack} aria-hidden="true">
            <span
              className={cn(styles.bar, item.color)}
              style={{ width: `${(item.count / max) * 100}%` }}
            />
          </span>
          <span className={styles.count}>{item.count}</span>
        </li>
      ))}
    </ul>
  );
}
function ColumnChart({ items }: { items: Column[] }) {
  const ceiling = chartCeiling(
    items.flatMap((item) => item.values.map((s) => s.count)),
  );
  const ticks = [...new Set([ceiling, Math.floor(ceiling / 2), 0])];
  return (
    <div className={styles.columns}>
      <div className={styles.axis} aria-hidden="true">
        {ticks.map((value) => (
          <span key={value} style={{ top: `${(1 - value / ceiling) * 100}%` }}>
            {value}
          </span>
        ))}
      </div>
      <div className={styles.plot}>
        <div className={styles.guides} aria-hidden="true">
          {ticks.map((value) => (
            <span
              key={value}
              style={{ top: `${(1 - value / ceiling) * 100}%` }}
            />
          ))}
        </div>
        <div className={styles.groups}>
          {items.map((item) => (
            <div key={item.description} className={styles.columnGroup}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={styles.inspectColumn}
                    aria-label={`${item.description}: ${item.values.map((s) => `${s.label}: ${s.count}`).join(", ")}`}
                  >
                    {item.values.map((series) => (
                      <span className={styles.columnTrack} key={series.label}>
                        <span
                          className={cn(styles.columnBar, series.color)}
                          style={{
                            height: `${(series.count / ceiling) * 100}%`,
                          }}
                        />
                      </span>
                    ))}
                  </button>
                </TooltipTrigger>
                <TooltipContent className="text-xs">
                  <p className="font-medium">{item.description}</p>
                  {item.values.map((series) => (
                    <p key={series.label}>
                      {series.label}: {series.count}
                    </p>
                  ))}
                </TooltipContent>
              </Tooltip>
              <span className={styles.columnLabel}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
const tenureLabels = {
  under_month: "До месяца",
  one_three: "1–3 месяца",
  three_twelve: "3–12 месяцев",
  over_year: "Больше года",
};
const stageColors = {
  new: "bg-muted-foreground/45",
  review: "bg-amber-400/80",
  interview: "bg-brand/80",
  trial: "bg-emerald-400/80",
  rejected: "bg-rose-400/75",
};
const funnelLabels = {
  received: "Получены анкеты",
  review: "Рассмотрение",
  interview: "Собеседование",
  trial: "Стажировка",
  hired: "Приняты",
};
const percent = new Intl.NumberFormat("ru-RU", {
  style: "percent",
  maximumFractionDigits: 1,
});
function RecruitingFunnel({ data }: { data: CandidateOverview }) {
  return (
    <section>
      <div className={styles.chartHeading}>
        <h3>Воронка подбора</h3>
        <Hint text="Каждый кандидат учитывается один раз на достигнутом этапе и на всех предыдущих. Отказ и отмена не стирают пройденный путь. Собеседование и стажировка учитываются с момента назначения. Воронка включает принятых сотрудников, которых список уже скрывает." />
      </div>
      <ol className={styles.funnel}>
        {data.funnel.map((step) => (
          <li key={step.id}>
            <span className={styles.barLabel}>{funnelLabels[step.id]}</span>
            <span className={styles.funnelTrack} aria-hidden="true">
              <span
                className={cn(
                  styles.bar,
                  step.id === "hired" ? "bg-emerald-500/80" : "bg-brand/80",
                )}
                style={{
                  width: `${data.received ? (step.count / data.received) * 100 : 0}%`,
                }}
              />
            </span>
            <span className={styles.count}>{step.count}</span>
            <span className={styles.funnelPercent}>
              {data.received ? percent.format(step.count / data.received) : "—"}
            </span>
          </li>
        ))}
      </ol>
      <p className={styles.caption}>Доля от всех анкет выбранного месяца.</p>
      {data.legacy_count > 0 && (
        <p className={styles.historyNote}>
          <Hint text={`Анкет из Notion: ${data.legacy_count}. Их этапы до переноса могли не сохраниться. Учитываем известный этап и последующие изменения в Sheerly, без восстановления неизвестных переходов у отказов.`} />
          История до переноса из Notion неполная
        </p>
      )}
    </section>
  );
}
function OverviewBody({ data }: { data: PeopleOverviewData }) {
  if (data.kind === "staff")
    return (
      <div className={styles.staffBody}>
        <section>
          <h3>Стаж команды</h3>
          {data.dated_staff > 0 ? (
            <HorizontalBars
              items={data.tenure.map((item) => ({
                ...item,
                label: tenureLabels[item.id],
                color: "bg-brand/85",
              }))}
            />
          ) : (
            <EmptyChart>
              {data.working
                ? "Укажите даты трудоустройства в карточках сотрудников"
                : "В заведении пока нет действующих сотрудников"}
            </EmptyChart>
          )}
        </section>
        <dl className={styles.staffAverage}>
          <Metric
            label="Средний стаж"
            value={overviewTenure(data.average_days)}
            hint={`Среднее время с даты найма у действующих сотрудников на ${new Date(`${data.today}T12:00:00Z`).toLocaleDateString("ru-RU", { timeZone: "UTC" })}. В расчёте: ${data.dated_staff} из ${data.working}. Записи без даты трудоустройства и с будущей датой не учитываются.`}
          />
        </dl>
      </div>
    );
  return (
    <>
      <div className={styles.charts}>
        <section>
          <h3>Поступление анкет</h3>
          {data.received > 0 ? (
            <ColumnChart
              items={data.arrivals.map((item, index, items) => ({
                label:
                  index === 0 ||
                  ((index + 1) % 5 === 0 && index < items.length - 3) ||
                  index === items.length - 1
                    ? String(Number(item.from.slice(-2)))
                    : "",
                description: new Date(`${item.from}T12:00:00Z`).toLocaleDateString(
                  "ru-RU",
                  { day: "numeric", month: "long", timeZone: "UTC" },
                ),
                values: [
                  { label: "Анкеты", count: item.count, color: "bg-brand/85" },
                ],
              }))}
            />
          ) : (
            <EmptyChart>
              Выберите другой месяц, чтобы посмотреть поступление анкет
            </EmptyChart>
          )}
          <p className={styles.caption}>
            {overviewMonth(data.month)} · по дням
          </p>
        </section>
        <RecruitingFunnel data={data} />
      </div>
      <section
        className={styles.currentStages}
        aria-label="Анкеты по текущим этапам"
      >
        <h3>Анкеты по текущим этапам</h3>
        {data.received > data.hired ? (
          <>
            <div className={styles.stageTrack} aria-hidden="true">
              {data.stages.map((item) => (
                <span
                  key={item.id}
                  className={stageColors[item.id]}
                  style={{
                    width: `${(item.count / (data.received - data.hired)) * 100}%`,
                  }}
                />
              ))}
            </div>
            <ul className={styles.stageLegend}>
              {data.stages.map((item) => (
                <li key={item.id}>
                  <i className={stageColors[item.id]} aria-hidden="true" />
                  <span>{STATUSES[item.id]}</span>
                  <strong>{item.count}</strong>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className={styles.caption}>
            {data.received
              ? "Все анкеты этого месяца завершились наймом"
              : "В этом месяце анкет не поступало"}
          </p>
        )}
      </section>
    </>
  );
}
function OverviewSkeleton() {
  return (
    <div className={styles.skeleton} aria-label="Загружаем обзор">
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="h-40 rounded bg-muted/60" />
        <div className="h-40 rounded bg-muted/60" />
      </div>
    </div>
  );
}
/** Shared disclosure/controller; always collapsed on page entry and never requests data while closed. */
export function usePeopleOverview(
  kind: OverviewKind,
  scopeId: string,
  revision = "",
) {
  const id = useId();
  const [open, setOpen] = useState(false),
    [period, setPeriod] = useState<string | null>(null),
    [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<PeopleOverviewData | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const scopedData =
    data?.scope_id === scopeId && data.kind === kind ? data : null;
  useEffect(() => {
    setOpen(false);
    setPeriod(null);
    setData(null);
    setError(false);
  }, [kind, scopeId]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBusy(true);
    setError(false);
    getPeopleOverview({ kind, scopeId, month: period })
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, period, refresh, kind, scopeId, revision]);
  useEffect(() => {
    if (!open) return;
    const focused = () => setRefresh((value) => value + 1);
    window.addEventListener("focus", focused);
    return () => window.removeEventListener("focus", focused);
  }, [open]);
  useEffect(() => {
    if (kind !== "candidates") return;
    const changed = () => setRefresh((value) => value + 1);
    window.addEventListener("candidates:incoming", changed);
    window.addEventListener("candidates:changed", changed);
    return () => {
      window.removeEventListener("candidates:incoming", changed);
      window.removeEventListener("candidates:changed", changed);
    };
  }, [kind]);
  const button = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={kind === "staff" ? "Обзор команды" : "Обзор кандидатов"}
      aria-expanded={open}
      aria-controls={open ? id : undefined}
      onClick={() => setOpen((value) => !value)}
      className={cn(
        "size-8 p-0 sm:h-9 sm:w-auto sm:gap-2 sm:px-3",
        open
          ? "border-brand text-brand hover:text-brand"
          : "text-muted-foreground",
      )}
    >
      <ChartNoAxesColumnIncreasing className="size-4" />
      <span className="hidden sm:inline">Обзор</span>
    </Button>
  );
  const month = period ?? scopedData?.month;
  const panel = open ? (
    <section
      id={id}
      className={styles.panel}
      aria-label={kind === "staff" ? "Обзор команды" : "Обзор кандидатов"}
      aria-busy={busy}
    >
      <header className={styles.header}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h2>{kind === "staff" ? "Обзор команды" : "Обзор кандидатов"}</h2>
          <Hint
            text={
              kind === "staff"
                ? "Стаж действующих сотрудников выбранного заведения на сегодня. Поиск, фильтры и список уволенных не меняют обзор."
                : "По анкетам всего аккаунта, поступившим в выбранном месяце. Поиск и фильтры таблицы не меняют обзор."
            }
          />
        </div>
        <div className={styles.period}>
          {kind === "candidates" && month && scopedData && (
            <MonthPicker
              value={month}
              onChange={setPeriod}
              min="2000-01-01"
              max={scopedData.current_month}
              prefix=""
              ariaLabel="Месяц обзора"
              variant="toolbar"
            />
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          aria-label="Свернуть обзор"
          onClick={() => setOpen(false)}
        >
          <ChevronUp className="size-4" />
        </Button>
      </header>
      {error ? (
        <div className={styles.error} role="alert">
          <p>Не удалось загрузить обзор</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setRefresh((value) => value + 1)}
          >
            <RotateCcw className="mr-2 size-3.5" />
            Повторить
          </Button>
        </div>
      ) : !scopedData || (period && scopedData.month !== period) ? (
        <OverviewSkeleton />
      ) : (
        <OverviewBody data={scopedData} />
      )}
    </section>
  ) : null;
  return { button, panel };
}
