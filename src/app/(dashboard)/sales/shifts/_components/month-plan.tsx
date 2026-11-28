"use client";
import Link from "next/link";
import { Metric } from "@/components/shared/metric-strip";
import { AnimatedMoney } from "@/components/shared/animated-money";
import { countRu } from "@/lib/format/plural";
import { planProgress, FORECAST_MIN_SHIFTS } from "@/lib/sales/plan";
import type { SalesDay } from "@/lib/sales/types";
import s from "./month-plan.module.css";

const rub = (n: number) =>
  `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n)} ₽`;
const percent = (ratio: number) =>
  `${new Intl.NumberFormat("ru-RU").format(Math.round(ratio * 100))} %`;

/**
 * Плитка «Оборот» в итогах месяца на «Сменах». С планом под суммой —
 * полоска «оборот к плану» (тёмная часть — факт, светлая следом — прогноз
 * на конец месяца), «87 % из 3 800 000 ₽» и «Прогноз 93 % плана»; как
 * считается прогноз — в подсказке. Без плана — число смен и, тем, кто задаёт план,
 * ссылка «Задать план».
 */
export function TurnoverMetric({
  label,
  value,
  fallbackHint,
  plan,
  month,
  today,
  days,
  canConfigure,
}: {
  label: string;
  value: number | null;
  /** Подпись под суммой без плана: «За 28 смен», «С учётом фильтров». */
  fallbackHint: string;
  /** `undefined` — план не загружали, `null` — плана нет. */
  plan: number | null | undefined;
  month: string;
  today: string;
  /** Все смены месяца, без фильтров таблицы. */
  days: SalesDay[];
  canConfigure: boolean;
}) {
  // План месяца задаётся в «Статистике» (вместе с долей алкоголя и прогнозом).
  const settingsHref = `/sales/statistics?plan=${month}`;
  const planLink = canConfigure && plan !== undefined && (plan !== null || month >= today.slice(0, 7)) ? (
    <Link
      href={settingsHref}
      className="text-xs font-normal text-brand hover:underline"
    >
      {plan === null ? "Задать план" : "План"}
    </Link>
  ) : null;
  if (!plan)
    return (
      <Metric
        primary
        label={label}
        icon={planLink}
        value={<AnimatedMoney value={value} />}
        hint={fallbackHint}
      />
    );
  const p = planProgress({ plan, month, today, days });
  const fact = p.ratio ?? 0;
  const forecast = p.forecast?.ratio ?? null;
  const forecastTip = p.forecast
    ? `Прогноз на конец месяца ${rub(p.forecast.value)}: оборот на сейчас и средний оборот закрытой смены ${rub(p.forecast.pace)} × ${
        p.forecast.remaining > 0
          ? `ещё ${countRu(p.forecast.remaining, "смену", "смены", "смен")}`
          : "0 смен"
      }. Сколько смен впереди, считаем по тому, как заведение работало в прошедшие дни месяца`
    : `Прогноз появится, когда закроются ${countRu(FORECAST_MIN_SHIFTS, "смена", "смены", "смен")}`;
  const left = p.fact === null ? null : plan - p.fact;
  const text =
    p.phase === "future"
      ? `План ${rub(plan)}, месяц ещё не начался`
      : p.ratio === null
        ? `План ${rub(plan)}, оборота пока нет`
        : left !== null && left <= 0
          ? `План ${rub(plan)} выполнен · ${percent(p.ratio)}`
          : `${percent(p.ratio)} из ${rub(plan)}`;
  return (
    <Metric
      primary
      label={label}
      icon={planLink}
      value={<AnimatedMoney value={value} />}
      hint={
        <>
          <span
            className={s.bar}
            role="progressbar"
            aria-label="Оборот к плану месяца"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(Math.min(fact, 1) * 100)}
          >
            {forecast !== null && (
              <span
                key={`f-${month}`}
                className={s.forecast}
                style={{ width: `${Math.min(forecast, 1) * 100}%` }}
              />
            )}
            <span
              key={`a-${month}`}
              className={s.fact}
              style={{ width: `${Math.min(fact, 1) * 100}%` }}
            />
          </span>
          <span className="block">{text}</span>
          {p.phase === "current" && p.ratio !== null && (left === null || left > 0) && (
            <span className="block">
              <span
                data-tip={forecastTip}
                className="underline decoration-dotted underline-offset-2"
              >
                {p.forecast
                  ? `Прогноз ${percent(p.forecast.ratio)} плана`
                  : "Прогноза пока нет"}
              </span>
            </span>
          )}
        </>
      }
    />
  );
}
