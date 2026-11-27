"use client";
import Link from "next/link";
import { Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatedMoney, AnimatedNumber } from "@/components/shared/animated-money";
import { Money } from "@/components/shared/money";
import { countRu } from "@/lib/format/plural";
import { planProgress, FORECAST_MIN_SHIFTS } from "@/lib/sales/plan";
import type { SalesDay } from "@/lib/sales/types";
import { cn } from "@/lib/utils";
import s from "./month-plan.module.css";

const percent = (ratio: number) => Math.round(ratio * 100);
const formatPercent = (n: number) => `${new Intl.NumberFormat("ru-RU").format(n)} %`;

/**
 * Кольцо «оборот к плану»: тёмная дуга — факт, светлая следом — прогноз на
 * конец месяца. Дуги рисуются от верхней точки по часовой стрелке
 * (docs/motion.md, «Кольцо плана»).
 */
function PlanRing({ ratio, forecast }: { ratio: number | null; forecast: number | null }) {
  const fact = Math.min(100, Math.max(0, (ratio ?? 0) * 100));
  const ahead = forecast === null ? 0 : Math.min(100, Math.max(0, forecast * 100));
  return (
    <div className="relative size-[88px] shrink-0">
      <svg viewBox="0 0 88 88" className="size-full -rotate-90" aria-hidden>
        <circle cx="44" cy="44" r="38" fill="none" strokeWidth="8" className="stroke-muted" />
        {ahead > fact && (
          <circle
            cx="44"
            cy="44"
            r="38"
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${ahead} 100`}
            className={cn(s.arc, s.ahead, "stroke-brand/25 dark:stroke-brand/35")}
          />
        )}
        {fact > 0 && (
          <circle
            cx="44"
            cy="44"
            r="38"
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${fact} 100`}
            className={cn(s.arc, "stroke-brand")}
          />
        )}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-base font-semibold">
        <AnimatedNumber value={ratio === null ? null : percent(ratio)} format={formatPercent} />
      </span>
    </div>
  );
}

/**
 * План месяца на «Сменах»: оборот к плану кольцом и прогноз на конец месяца.
 * Без плана кольца нет; тем, кто настраивает смены, — тихая ссылка «Задать план».
 */
export function MonthPlan({
  plan,
  month,
  today,
  days,
  canConfigure,
}: {
  /** `undefined` — план не загружали, `null` — плана нет. */
  plan: number | null | undefined;
  month: string;
  today: string;
  /** Все смены месяца, без фильтров таблицы. */
  days: SalesDay[];
  canConfigure: boolean;
}) {
  const settingsHref = `/sales/settings?plan=${month}#sales-plan`;
  if (plan === undefined) return null;
  if (plan === null)
    return canConfigure && month >= today.slice(0, 7) ? (
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" asChild>
          <Link href={settingsHref}>
            <Target />
            Задать план на месяц
          </Link>
        </Button>
      </div>
    ) : null;
  const p = planProgress({ plan, month, today, days });
  // Оборота нет — разницу с планом не считаем: неизвестное не равно нулю.
  const left = p.fact === null ? null : plan - p.fact;
  return (
    <section
      aria-label="План месяца"
      className={cn(s.card, "rounded-lg border bg-card p-4 sm:p-5")}
    >
      <div className={s.layout}>
      <div className={cn(s.main, "flex min-w-0 items-center gap-4")}>
        {/* Кольцо рисуется заново при смене месяца, числа — досчитываются
            от прежних значений (docs/motion.md). */}
        <PlanRing key={month} ratio={p.ratio} forecast={p.forecast?.ratio ?? null} />
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-muted-foreground">План месяца</p>
          <p className="flex flex-wrap items-baseline gap-x-1.5 text-lg font-semibold tabular-nums leading-tight">
            <AnimatedMoney value={p.fact} />
            <span className="text-sm font-normal text-muted-foreground">из</span>
            <Money value={plan} />
          </p>
          <p className="text-[13px] text-muted-foreground">
            {p.phase === "future" ? (
              "Месяц ещё не начался"
            ) : left === null ? (
              p.phase === "past" ? "Оборота за месяц нет" : "Оборота пока нет"
            ) : left > 0 ? (
              <>
                {p.phase === "past" ? "Не хватило" : "До плана"} <Money value={left} />
              </>
            ) : (
              <>
                План выполнен{left < 0 && <>, сверх плана <Money value={-left} /></>}
              </>
            )}
          </p>
        </div>
      </div>
      {p.phase === "current" && (
        <div className={cn(s.forecast, "min-w-0")}>
          {p.forecast ? (
            <>
              <p className="text-sm text-muted-foreground">Прогноз на конец месяца</p>
              <p className="mt-1 text-lg font-semibold tabular-nums leading-tight">
                <AnimatedMoney value={p.forecast.value} />
                <span className="ml-2 whitespace-nowrap text-sm font-normal text-muted-foreground">
                  {formatPercent(percent(p.forecast.ratio))} плана
                </span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Оборот на сейчас и средний оборот закрытой смены{" "}
                <Money value={p.forecast.pace} /> ×{" "}
                {p.forecast.remaining > 0
                  ? `ещё ${countRu(p.forecast.remaining, "смену", "смены", "смен")}`
                  : "0 смен"}
                . Сколько смен впереди, считаем по тому, как заведение работало
                в прошедшие дни месяца
              </p>
            </>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              Прогноз на конец месяца появится, когда закроются{" "}
              {countRu(FORECAST_MIN_SHIFTS, "смена", "смены", "смен")}
              {p.closedShifts > 0 ? `. Пока закрыто: ${p.closedShifts}` : ""}
            </p>
          )}
        </div>
      )}
      {canConfigure && (
        <Button
          variant="ghost"
          size="sm"
          className={cn(s.edit, "text-muted-foreground")}
          asChild
        >
          <Link href={settingsHref}>Изменить план</Link>
        </Button>
      )}
      </div>
    </section>
  );
}
