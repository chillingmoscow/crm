import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { MetricStrip, Metric } from "@/components/shared/metric-strip";
import { Money } from "@/components/shared/money";
import { ProfileSection } from "@/components/shared/profile-section";
import type { CounterpartyActivity } from "@/lib/finance/activity";
import { formatDateCell } from "@/lib/format/date";
import { countRu } from "@/lib/format/plural";
import type { CounterpartyOperation } from "./counterparty-card";

/**
 * Вкладка «Операции»: итоги за всё время и последние операции. Полный
 * список с фильтрами — в «Транзакциях», туда ведёт кнопка.
 */
export function CounterpartyOperations({
  counterpartyId,
  activity,
  operations,
}: {
  counterpartyId: string;
  activity: CounterpartyActivity | null;
  operations: CounterpartyOperation[];
}) {
  const allHref = `/finance/transactions?counterparty_id=${counterpartyId}`;
  const total = activity?.operations ?? operations.length;

  return (
    <div className="flex flex-col gap-5">
      {activity ? (
        <MetricStrip label="Итоги по контрагенту за всё время">
          <Metric primary label="Оплачено" value={<Money value={activity.expenseTotal} />} />
          <Metric label="Получено" value={<Money value={activity.incomeTotal} />} />
          <Metric label="Операций" value={<span className="tabular-nums">{activity.operations}</span>} />
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
          <EmptyState
            icon={ArrowLeftRight}
            title="Операций пока нет"
            description="Операция появится здесь, когда в ней выберут этого контрагента"
          />
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
  );
}
