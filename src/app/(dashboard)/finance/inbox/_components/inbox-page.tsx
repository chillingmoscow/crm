"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageFrame } from "@/components/shared/page-frame";
import { PeriodStepper } from "@/components/shared/period-stepper";
import { TablePageHeader } from "@/components/shared/table";
import { notifyInboxChanged } from "@/lib/finance/use-inbox-count";
import type { AmountRoundingScale } from "@/lib/format/amount";
import { formatDayMonth } from "@/lib/format/date";
import type { AccountVenueRow } from "@/lib/org/legal-entities";
import type {
  BankAccountRow,
  CounterpartyRow,
  FinanceCategoryRow,
  RecurringOccurrenceRow,
} from "@/types/finance";

import {
  OccurrenceCard,
  initialDraft,
  type OccurrenceDraft,
  type OccurrenceResolution,
} from "./occurrence-card";

type Props = {
  /** Ожидаемые платежи по сроку, старые первыми. */
  items: RecurringOccurrenceRow[];
  loadError: string | null;
  /** Все счета, статьи и контрагенты — включая архивные (для подписей). */
  bankAccounts: BankAccountRow[];
  categories: FinanceCategoryRow[];
  counterparties: CounterpartyRow[];
  /** Действующие заведения аккаунта. */
  venues: AccountVenueRow[];
  /** Заведения, которые можно выбрать на карточке. */
  formVenues: AccountVenueRow[];
  canResolve: boolean;
  amountRoundingScale: AmountRoundingScale;
  /** Сегодня `YYYY-MM-DD` в поясе аккаунта. */
  today: string;
};

/**
 * Очередь «На разбор» (Adesk-подобный разбор по одной карточке): шапка со
 * стрелками «назад/дальше» и счётчиком «Осталось N», одна карточка платежа.
 * Разобранный платёж уходит из очереди, на его месте — следующий; после
 * каждого разбора бейдж в сайдбаре перечитывается (`finance:inbox-changed`).
 */
export function InboxPage({
  items,
  loadError,
  bankAccounts,
  categories,
  counterparties,
  venues,
  formVenues,
  canResolve,
  amountRoundingScale,
  today,
}: Props) {
  const router = useRouter();
  const [resolved, setResolved] = useState<Set<string>>(() => new Set());
  const [currentId, setCurrentId] = useState<string | null>(items[0]?.id ?? null);
  const [drafts, setDrafts] = useState<Record<string, OccurrenceDraft>>({});

  // Открытие очереди порождает наступившие сроки — счётчик в сайдбаре мог отстать.
  useEffect(() => {
    notifyInboxChanged();
  }, [items]);

  const queue = useMemo(() => items.filter((item) => !resolved.has(item.id)), [items, resolved]);
  const found = queue.findIndex((item) => item.id === currentId);
  const index = found === -1 ? 0 : found;
  const current = queue[index] ?? null;

  const accountById = useMemo(() => new Map(bankAccounts.map((b) => [b.id, b])), [bankAccounts]);
  const counterpartyById = useMemo(
    () => new Map(counterparties.map((c) => [c.id, c.name])),
    [counterparties],
  );

  const resolve = (occurrence: RecurringOccurrenceRow, result: OccurrenceResolution) => {
    // На место разобранного встаёт следующий, а если он был последним — предыдущий.
    const next = queue[index + 1] ?? queue[index - 1] ?? null;
    setResolved((set) => new Set(set).add(occurrence.id));
    setCurrentId(next?.id ?? null);
    setDrafts((all) => {
      const rest = { ...all };
      delete rest[occurrence.id];
      return rest;
    });
    notifyInboxChanged();

    if (result.kind === "posted") {
      toast.success(`Платёж «${occurrence.name}» проведён`, {
        action: {
          label: "Открыть",
          onClick: () => router.push(`/finance/transactions?id=${result.transactionId}`),
        },
      });
    } else if (result.kind === "skipped") {
      toast(`Платёж «${occurrence.name}» пропущен`);
    } else {
      toast.success(
        `Платёж «${occurrence.name}» перенесён на ${formatDayMonth(result.to) ?? result.to}`,
      );
    }
  };

  let body: React.ReactNode;
  if (current) {
    const account = accountById.get(current.bank_account_id);
    body = (
      <OccurrenceCard
        key={current.id}
        occurrence={current}
        draft={drafts[current.id] ?? initialDraft(current, today)}
        onDraftChange={(patch) =>
          setDrafts((all) => ({
            ...all,
            [current.id]: { ...(all[current.id] ?? initialDraft(current, today)), ...patch },
          }))
        }
        onResolved={(result) => resolve(current, result)}
        accountName={account?.name ?? null}
        currency={account?.currency ?? current.currency}
        counterpartyName={
          current.counterparty_id ? (counterpartyById.get(current.counterparty_id) ?? null) : null
        }
        categories={categories}
        venues={formVenues}
        allVenues={venues}
        canResolve={canResolve}
        amountRoundingScale={amountRoundingScale}
        today={today}
      />
    );
  } else if (!loadError) {
    body = (
      <EmptyState
        icon={CheckCheck}
        title="Всё разобрано"
        description="Здесь появляются повторяющиеся платежи, когда наступает их срок"
        action={
          <Button asChild variant="outline">
            <Link href="/finance/recurring">Открыть повторяющиеся платежи</Link>
          </Button>
        }
      />
    );
  }

  return (
    <PageFrame className="flex min-w-0 flex-col gap-4">
      <Breadcrumbs items={[{ label: "Финансы" }, { label: "На разбор" }]} />
      <TablePageHeader
        title="На разбор"
        actions={
          queue.length > 0 ? (
            <PeriodStepper
              previous="Предыдущий платёж"
              next="Следующий платёж"
              previousDisabled={index === 0}
              nextDisabled={index >= queue.length - 1}
              onPrevious={() => setCurrentId(queue[index - 1]?.id ?? null)}
              onNext={() => setCurrentId(queue[index + 1]?.id ?? null)}
            >
              <span
                aria-live="polite"
                className="inline-flex h-full items-center whitespace-nowrap border-x border-brand/15 px-2.5 text-[13px] font-medium tabular-nums text-brand"
              >
                Осталось {queue.length.toLocaleString("ru-RU")}
              </span>
            </PeriodStepper>
          ) : undefined
        }
      />

      {loadError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm"
        >
          <p className="min-w-0 flex-1">Не удалось загрузить платежи. Проверьте соединение и повторите</p>
          <Button variant="outline" size="sm" className="h-8" onClick={() => router.refresh()}>
            Повторить
          </Button>
        </div>
      ) : null}

      <div className="min-w-0">{body}</div>
    </PageFrame>
  );
}
