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
import type { OfficialInbox } from "@/lib/finance/official-inbox-data";
import type { PayoutAlertItem } from "@/lib/finance/payout-inbox-data";
import type { AccountVenueRow } from "@/lib/org/legal-entities";
import {
  initialOfficialDraft,
  officialMonthName,
  officialPayDate,
  type OfficialReviewDraft,
  type OfficialReviewItem,
} from "@/lib/payroll/official-review";
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
import { OfficialMonthCard, type OfficialResolution } from "./official-month-card";
import { PayoutAlertCard, type PayoutAlertResolution } from "./payout-alert-card";

/** Карточка очереди: ожидаемый платёж, официальная часть зарплаты или выплата по плану. */
type QueueEntry =
  | { type: "occurrence"; id: string; due: string; row: RecurringOccurrenceRow }
  | { type: "official"; id: string; due: string; row: OfficialReviewItem }
  | { type: "payout"; id: string; due: string; row: PayoutAlertItem };

type Props = {
  /** Ожидаемые платежи по сроку, старые первыми. */
  items: RecurringOccurrenceRow[];
  /** Официальная часть зарплаты активного заведения, не проведённая сама. */
  official: OfficialInbox;
  /** Права на выплаты зарплаты и на операции в финансах. */
  canResolveOfficial: boolean;
  /** Карточки выплат зарплаты по плану: сверка, нехватка наличных, перенос. */
  payout: PayoutAlertItem[];
  /** Право на выплаты зарплаты — закрыть карточку выплаты. */
  canResolvePayout: boolean;
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
 * В той же очереди, по сроку, — официальная часть зарплаты, которая не
 * провелась сама (`OfficialMonthCard`).
 */
export function InboxPage({
  items,
  official,
  canResolveOfficial,
  payout,
  canResolvePayout,
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
  const [drafts, setDrafts] = useState<Record<string, OccurrenceDraft>>({});
  const [officialDrafts, setOfficialDrafts] = useState<Record<string, OfficialReviewDraft>>({});

  // Одна очередь по сроку: у официальной части срок — день проведения за месяц.
  const entries = useMemo<QueueEntry[]>(
    () =>
      [
        ...official.items.map(
          (row): QueueEntry => ({
            type: "official",
            id: row.id,
            due: officialPayDate(row.month, official.settings.payDay),
            row,
          }),
        ),
        ...payout.map(
          (row): QueueEntry => ({ type: "payout", id: row.id, due: row.business_date ?? row.created_at.slice(0, 10), row }),
        ),
        ...items.map((row): QueueEntry => ({ type: "occurrence", id: row.id, due: row.due_date, row })),
      ].sort((a, b) => a.due.localeCompare(b.due)),
    [items, official, payout],
  );
  const [currentId, setCurrentId] = useState<string | null>(entries[0]?.id ?? null);

  // Открытие очереди порождает наступившие сроки — счётчик в сайдбаре мог отстать.
  useEffect(() => {
    notifyInboxChanged();
  }, [entries]);

  const queue = useMemo(() => entries.filter((entry) => !resolved.has(entry.id)), [entries, resolved]);
  const found = queue.findIndex((item) => item.id === currentId);
  const index = found === -1 ? 0 : found;
  const current = queue[index] ?? null;

  const accountById = useMemo(() => new Map(bankAccounts.map((b) => [b.id, b])), [bankAccounts]);
  const counterpartyById = useMemo(
    () => new Map(counterparties.map((c) => [c.id, c.name])),
    [counterparties],
  );

  /** Карточка разобрана: на её место встаёт следующая, а если она была последней — предыдущая. */
  const dismiss = (id: string) => {
    const next = queue[index + 1] ?? queue[index - 1] ?? null;
    setResolved((set) => new Set(set).add(id));
    setCurrentId(next?.id ?? null);
    setDrafts((all) => {
      const rest = { ...all };
      delete rest[id];
      return rest;
    });
    setOfficialDrafts((all) => {
      const rest = { ...all };
      delete rest[id];
      return rest;
    });
    notifyInboxChanged();
  };

  const resolveOfficial = (item: OfficialReviewItem, result: OfficialResolution) => {
    dismiss(item.id);
    const who = `${item.employee_name}, ${officialMonthName(item.month, today)}`;
    if (result.kind === "posted") {
      toast.success(`Официальная выплата проведена: ${who}`);
    } else if (result.kind === "gone") {
      toast("Карточка уже разобрана");
      router.refresh();
    } else {
      toast(`Официальная выплата пропущена: ${who}`);
    }
  };

  const resolvePayout = (item: PayoutAlertItem, result: PayoutAlertResolution) => {
    dismiss(item.id);
    if (result.kind === "gone") {
      toast("Карточка уже разобрана");
      router.refresh();
    } else {
      toast.success("Карточка закрыта");
    }
  };

  const resolve = (occurrence: RecurringOccurrenceRow, result: OccurrenceResolution) => {
    dismiss(occurrence.id);

    if (result.kind === "posted") {
      toast.success(`Платёж «${occurrence.name}» проведён`, {
        action: {
          label: "Открыть",
          onClick: () => router.push(`/finance/transactions?id=${result.transactionId}`),
        },
      });
    } else if (result.kind === "gone") {
      // Карточку уже разобрали в другом окне или другой сотрудник: сверяем очередь.
      toast("Платёж уже разобран");
      router.refresh();
    } else if (result.kind === "skipped") {
      toast(`Платёж «${occurrence.name}» пропущен`);
    } else {
      toast.success(
        `Платёж «${occurrence.name}» перенесён на ${formatDayMonth(result.to) ?? result.to}`,
      );
    }
  };

  let body: React.ReactNode;
  if (current?.type === "payout") {
    const item = current.row;
    body = (
      <PayoutAlertCard
        key={item.id}
        item={item}
        canResolve={canResolvePayout}
        onResolved={(result) => resolvePayout(item, result)}
        today={today}
      />
    );
  } else if (current?.type === "official") {
    const item = current.row;
    const fallback = () => initialOfficialDraft(item, official.settings, official.banks, today);
    body = (
      <OfficialMonthCard
        key={item.id}
        item={item}
        draft={officialDrafts[item.id] ?? fallback()}
        onDraftChange={(next) => setOfficialDrafts((all) => ({ ...all, [item.id]: next }))}
        onResolved={(result) => resolveOfficial(item, result)}
        banks={official.banks}
        payDay={official.settings.payDay}
        canResolve={canResolveOfficial}
        today={today}
      />
    );
  } else if (current) {
    const occurrence = current.row;
    const account = accountById.get(occurrence.bank_account_id);
    body = (
      <OccurrenceCard
        key={occurrence.id}
        occurrence={occurrence}
        draft={drafts[occurrence.id] ?? initialDraft(occurrence, today)}
        onDraftChange={(patch) =>
          setDrafts((all) => ({
            ...all,
            [occurrence.id]: { ...(all[occurrence.id] ?? initialDraft(occurrence, today)), ...patch },
          }))
        }
        onResolved={(result) => resolve(occurrence, result)}
        accountName={account?.name ?? null}
        currency={account?.currency ?? occurrence.currency}
        counterpartyName={
          occurrence.counterparty_id ? (counterpartyById.get(occurrence.counterparty_id) ?? null) : null
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
        description="Здесь появляются повторяющиеся платежи, когда наступает их срок, официальные выплаты, которые не провелись сами, и всё, что требует внимания в выплатах зарплаты"
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
              previous="Предыдущая карточка"
              next="Следующая карточка"
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
