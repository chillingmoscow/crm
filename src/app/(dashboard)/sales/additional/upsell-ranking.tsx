"use client";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmployeeIdentity } from "@/components/shared/employee-identity";
import { Money } from "@/components/shared/money";
import { unwrapAction } from "@/lib/actions/result";
import { countRu } from "@/lib/format/plural";
import { monthLabel } from "@/lib/sales/format";
import type { RankingEntry } from "@/lib/sales/upsell-ranking";
import { cn } from "@/lib/utils";
import { loadUpsellRanking, type UpsellRanking } from "./actions";

const share = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });

/** Сотрудник может получать прибавку по старому виду и по правилам подразделения — складываем. */
function mergeGroups(ranking: UpsellRanking, keys: string[]): RankingEntry[] {
  const byEmployee = new Map<string, RankingEntry>();
  for (const key of keys)
    for (const e of ranking.groups[key] ?? []) {
      const old = byEmployee.get(e.employeeId);
      byEmployee.set(
        e.employeeId,
        old
          ? {
              employeeId: e.employeeId,
              amount: Math.round((old.amount + e.amount) * 100) / 100,
              shifts: old.shifts + e.shifts,
              unknown: old.unknown + e.unknown,
            }
          : e,
      );
    }
  return [...byEmployee.values()].sort((a, b) => b.amount - a.amount || b.shifts - a.shifts);
}

function RankingSkeleton() {
  return (
    <div role="status" aria-label="Загружаем рейтинг" aria-busy className="divide-y">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 py-3">
          <Skeleton className="size-6 rounded-full" />
          <Skeleton className="size-9 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-1.5 w-full max-w-64" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

/**
 * Рейтинг сотрудников подразделения по прибавке за допродажи за месяц:
 * аватар, сумма, полоска доли от всей прибавки. Первые три места выделены
 * номером на светлом фоне бренда, без наград и медалей.
 */
export function UpsellRankingCard({
  venueId,
  month,
  groups,
}: {
  venueId: string;
  /** «2026-11». */
  month: string;
  /** Ключи подразделения вкладки: id и старый вид («legacy:bar»). */
  groups: string[];
}) {
  const [cache, setCache] = useState<Record<string, UpsellRanking>>({});
  // Ошибка — своего месяца: при переходе на уже загруженный месяц она не висит.
  const [failure, setFailure] = useState<{ month: string; text: string } | null>(null);
  const error = failure?.month === month ? failure.text : null;
  const [attempt, setAttempt] = useState(0);
  const data = cache[month] ?? null;
  useEffect(() => {
    if (cache[month]) return;
    let live = true;
    setFailure(null);
    loadUpsellRanking(venueId, month)
      .then(unwrapAction)
      .then((r) => live && setCache((c) => ({ ...c, [month]: r })))
      .catch(
        (e) =>
          live &&
          setFailure({
            month,
            text: e instanceof Error ? e.message : "Не удалось загрузить рейтинг сотрудников",
          }),
      );
    return () => {
      live = false;
    };
    // Месяц, который уже показывали, открывается из памяти (DS «Без „Загружаем…“»).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId, month, attempt]);
  const groupKey = groups.join("|");
  const entries = useMemo(
    () => (data ? mergeGroups(data, groupKey.split("|")) : []),
    [data, groupKey],
  );
  const total = entries.reduce((s, e) => s + e.amount, 0);
  const top = entries[0]?.amount ?? 0;
  return (
    <section
      aria-label="Рейтинг сотрудников по допродажам"
      className="min-w-0 rounded-lg border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">Рейтинг сотрудников</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Прибавка за допродажи за {monthLabel(month)}
          </p>
        </div>
        {entries.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Всего <Money className="font-medium text-foreground" value={total} />
          </p>
        )}
      </div>
      <div className="mt-3">
        {error ? (
          <div role="alert" className="space-y-3 py-2 text-sm">
            <p className="text-destructive">{error}</p>
            <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
              Повторить
            </Button>
          </div>
        ) : !data ? (
          <RankingSkeleton />
        ) : !data.allowed ? (
          <p className="py-2 text-sm text-muted-foreground">
            Рейтинг сотрудников виден с правом просмотра зарплаты
          </p>
        ) : !entries.length ? (
          <p className="py-2 text-sm text-muted-foreground">
            За этот месяц прибавку за допродажи ещё не начисляли
          </p>
        ) : (
          // `key` по месяцу и вкладке: полоски растут заново (docs/motion.md).
          <ol key={`${month}:${groupKey}`} className="divide-y">
            {entries.map((e, i) => {
              const person = data.people[e.employeeId];
              const part = total > 0 ? e.amount / total : 0;
              return (
                <li
                  key={e.employeeId}
                  className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 py-3"
                >
                  <span
                    aria-label={`${i + 1} место`}
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full text-xs tabular-nums",
                      i < 3 ? "bg-brand/10 font-semibold text-brand" : "text-muted-foreground",
                    )}
                  >
                    {i + 1}
                  </span>
                  <EmployeeIdentity
                    name={person?.name ?? "Сотрудник из расчёта"}
                    role={person?.position}
                    avatarUrl={person?.avatarUrl}
                    href={person?.href}
                  />
                  <span className="text-right">
                    <Money className="block text-sm font-medium" value={e.amount} />
                    <span className="block whitespace-nowrap text-xs text-muted-foreground">
                      {countRu(e.shifts, "смена", "смены", "смен")}
                      {e.unknown > 0 && ` · ${e.unknown} без суммы`}
                    </span>
                  </span>
                  <span className="col-start-2 col-end-4 flex items-center gap-3 sm:pl-12">
                    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <span
                        className={cn(
                          // Задержка — inline; при «уменьшить движение» снимаем её (!important бьёт style).
                          "chart-bar-grow-x block h-full rounded-full motion-reduce:![animation-delay:0ms]",
                          i < 3 ? "bg-brand" : "bg-brand/40",
                        )}
                        style={{
                          width: `${top > 0 ? (e.amount / top) * 100 : 0}%`,
                          animationDelay: `${200 + Math.min(i, 12) * 90}ms`,
                        }}
                      />
                    </span>
                    <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {share.format(part * 100)} %
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
