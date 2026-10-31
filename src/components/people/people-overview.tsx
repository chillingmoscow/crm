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
                    aria-label={`${item.description}: ${item.values.map((s) => `${s.label} — ${s.count}`).join(", ")}`}
                  >
                    {item.values.map((series) => (
                      <span className={styles.columnTrack} key={series.label}>
                        <span
                          className={cn(styles.columnBar, series.color)}
                          style={{
                            height: `${(series.count / ceiling) * 100}%`,
                          }}
                        >
                          <span className={styles.columnValue}>
                            {series.count}
                          </span>
                        </span>
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
function OverviewBody({ data }: { data: PeopleOverviewData }) {
  if (data.kind === "staff")
    return (
      <>
        <dl className={styles.metrics}>
          <Metric
            label="Работают"
            value={data.working}
            hint="Действующие сотрудники выбранного заведения на сегодня. Приглашения не входят в численность."
          />
          <Metric
            label="Принято за месяц"
            value={data.hired}
            hint="Сотрудники заведения с датой трудоустройства в выбранном месяце, включая впоследствии уволенных. Дата создания профиля не используется."
          />
          <Metric
            label="Средний стаж"
            value={overviewTenure(data.average_days)}
            hint={`Среднее время с даты найма у действующих сотрудников на ${new Date(`${data.today}T12:00:00Z`).toLocaleDateString("ru-RU", { timeZone: "UTC" })}. Учитываются указанные в карточках даты, которые уже наступили.`}
          />
        </dl>
        <div className={styles.charts}>
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
            <p className={styles.caption}>
              Стаж рассчитан для {data.dated_staff} из {data.working}{" "}
              {data.working % 10 === 1 && data.working % 100 !== 11
                ? "сотрудника"
                : "сотрудников"}
              .
            </p>
          </section>
          <section>
            <div className={styles.chartHeading}>
              <h3>Движение команды</h3>
              <div className={styles.legend}>
                <span>
                  <i className="bg-brand/85" />
                  Принято
                </span>
                <span>
                  <i className="bg-muted-foreground/45" />
                  Уволено
                </span>
              </div>
            </div>
            {data.movement.some((item) => item.hired || item.fired) ? (
              <ColumnChart
                items={data.movement.map((item) => ({
                  label: overviewMonth(item.month, true),
                  description: overviewMonth(item.month),
                  values: [
                    {
                      label: "Принято",
                      count: item.hired,
                      color: "bg-brand/85",
                    },
                    {
                      label: "Уволено",
                      count: item.fired,
                      color: "bg-muted-foreground/45",
                    },
                  ],
                }))}
              />
            ) : (
              <EmptyChart>
                За эти месяцы приёмов и увольнений не записано
              </EmptyChart>
            )}
            <p className={styles.caption}>
              Приём по датам найма в карточках, увольнения по датам и журналу.
            </p>
          </section>
        </div>
      </>
    );
  return (
    <>
      <dl className={styles.metrics}>
        <Metric
          label="Поступило"
          value={data.received}
          hint="Все сохранённые анкеты, поступившие в выбранном месяце, включая принятых сотрудников. Удалённые и архивные анкеты не учитываются."
        />
        <Metric
          label="Новые анкеты"
          value={data.new}
          hint="Анкеты выбранного месяца, которые сейчас находятся на этапе «Новая анкета»."
        />
        <Metric
          label="Принято"
          value={data.hired}
          hint="Успешно принятые сотрудники из анкет выбранного месяца. Найм мог завершиться позже месяца поступления."
        />
      </dl>
      <div className={styles.charts}>
        <section>
          <h3>Анкеты по текущим этапам</h3>
          {data.received > data.hired ? (
            <HorizontalBars
              items={data.stages.map((item) => ({
                ...item,
                label: STATUSES[item.id],
                color: stageColors[item.id],
              }))}
            />
          ) : (
            <EmptyChart>
              {data.received
                ? "Все анкеты этого месяца завершились наймом"
                : "В этом месяце анкет не поступало"}
            </EmptyChart>
          )}
          <p className={styles.caption}>
            Этапы анкет выбранного месяца. Принятые сотрудники учтены выше.
          </p>
        </section>
        <section>
          <h3>Поступление анкет</h3>
          {data.received > 0 ? (
            <ColumnChart
              items={data.arrivals.map((item) => ({
                label: `${Number(item.from.slice(-2))}–${Number(item.to.slice(-2))}`,
                description: `${item.from.split("-").reverse().join(".")} — ${item.to.split("-").reverse().join(".")}`,
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
            {overviewMonth(data.month)} · календарные недели
          </p>
        </section>
      </div>
    </>
  );
}
function OverviewSkeleton() {
  return (
    <div className={styles.skeleton} aria-label="Загружаем обзор">
      <div className="grid grid-cols-3 gap-6">
        {[0, 1, 2].map((i) => (
          <div className="h-12 rounded bg-muted" key={i} />
        ))}
      </div>
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
                ? "По всему выбранному заведению. Численность и стаж на сегодня; приём за выбранный месяц, движение за три месяца. Поиск и фильтры таблицы не меняют обзор."
                : "По анкетам всего аккаунта, поступившим в выбранном месяце. Поиск и фильтры таблицы не меняют обзор."
            }
          />
        </div>
        <div className={styles.period}>
          {month && scopedData && (
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
