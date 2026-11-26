"use client";

import { useMemo, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeftRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { AnimatedMoney, AnimatedNumber } from "@/components/shared/animated-money";
import { MetricStrip, Metric } from "@/components/shared/metric-strip";
import { Money } from "@/components/shared/money";
import { ProfileSection } from "@/components/shared/profile-section";
import { DirectoryPeriodPicker } from "@/components/finance/period-picker";
import type { CounterpartyActivity } from "@/lib/finance/activity";
import { formatDateCell } from "@/lib/format/date";
import { countRu } from "@/lib/format/plural";
import {
  parsePeriod,
  periodParam,
  periodPhrase,
  transactionsHref,
  type DirectoryPeriod,
} from "@/lib/finance/period";
import { cn } from "@/lib/utils";
import type { CounterpartyOperation } from "./counterparty-card";

/**
 * Вкладка «Операции»: итоги и последние операции за период (по умолчанию —
 * всё время). Период — в адресе (`?period=`), как в списке контрагентов.
 * Полный список с фильтрами — в «Транзакциях», туда ведёт кнопка.
 */
export function CounterpartyOperations({
  counterpartyId,
  activity,
  operations,
  period: periodValue,
  today,
}: {
  counterpartyId: string;
  activity: CounterpartyActivity | null;
  operations: CounterpartyOperation[];
  period: string | null;
  today: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const period = useMemo(() => parsePeriod(periodValue), [periodValue]);
  const phrase = periodPhrase(period);
  const allHref = transactionsHref({ counterparty_id: counterpartyId }, period);
  const total = activity?.operations ?? operations.length;
  const changePeriod = (next: DirectoryPeriod) => {
    const param = periodParam(next);
    startTransition(() => router.push(param ? `${pathname}?period=${param}` : pathname, { scroll: false }));
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <DirectoryPeriodPicker
          value={period}
          today={today}
          onChange={changePeriod}
          ariaLabel="Период операций с контрагентом"
        />
      </div>
      <div aria-busy={pending} className={cn("flex flex-col gap-5 transition-opacity", pending && "opacity-60")}>
        {activity ? (
          <MetricStrip label={`Итоги по контрагенту ${phrase}`}>
            <Metric primary label="Оплачено" value={<AnimatedMoney value={activity.expenseTotal} />} />
            <Metric label="Получено" value={<AnimatedMoney value={activity.incomeTotal} />} />
            <Metric label="Операций" value={<AnimatedNumber value={activity.operations} />} />
            <Metric
              label="Последняя"
              value={
                activity.lastDate ? (
                  <span className="tabular-nums">{formatDateCell(activity.lastDate)}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )
              }
            />
          </MetricStrip>
        ) : (
          <div role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            Не удалось посчитать итоги по контрагенту. Последние операции ниже, обновите страницу позже
          </div>
        )}

        <ProfileSection
          title="Последние операции"
          description={
            total > operations.length
              ? `Показаны ${operations.length} из ${total}. Остальные в «Транзакциях»`
              : undefined
          }
          actions={
            operations.length > 0 ? (
              <Button asChild variant="outline" size="sm">
                <Link href={allHref}>Все операции</Link>
              </Button>
            ) : undefined
          }
        >
          {operations.length === 0 ? (
            period.kind === "all" ? (
              <EmptyState
                icon={ArrowLeftRight}
                title="Операций пока нет"
                description="Операция появится здесь, когда в ней выберут этого контрагента"
              />
            ) : (
              <EmptyState
                icon={ArrowLeftRight}
                title={`Нет операций ${phrase}`}
                description={
                  activity?.lastDate
                    ? `Последняя операция до этого периода: ${formatDateCell(activity.lastDate)}`
                    : "Выберите другой период или «Всё время»"
                }
              />
            )
          ) : (
            <ul className="flex flex-col divide-y" aria-label={countRu(operations.length, "операция", "операции", "операций")}>
              {operations.map((operation) => {
                const meta = [operation.categoryName ?? "Без статьи", operation.accountName].filter(Boolean).join(" · ");
                return (
                  <li key={operation.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <span className="w-20 shrink-0 text-[13px] tabular-nums text-muted-foreground">
                      {formatDateCell(operation.date)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm" data-tip={meta}>
                        {meta}
                      </span>
                      {operation.description ? (
                        <span className="block truncate text-[13px] text-muted-foreground" data-tip={operation.description}>
                          {operation.description}
                        </span>
                      ) : null}
                    </span>
                    <Money
                      value={operation.type === "income" ? operation.amount : -operation.amount}
                      signed
                      className="shrink-0 text-sm"
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </ProfileSection>
      </div>
    </div>
  );
}
