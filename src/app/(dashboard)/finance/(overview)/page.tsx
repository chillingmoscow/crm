import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  CreditCard,
  Landmark,
  Lock,
  TrendingDown,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { CategoryColorDot, CategoryShareBar } from "@/components/finance/category-color";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { Metric, MetricStrip } from "@/components/shared/metric-strip";
import { Money, formatRub } from "@/components/shared/money";
import { PageFrame } from "@/components/shared/page-frame";
import { Button } from "@/components/ui/button";
import { getActiveFinanceLegalEntityId } from "@/lib/finance/active-legal-entity";
import { listBankAccounts } from "@/lib/finance/bank-accounts";
import { listFinanceCategories } from "@/lib/finance/categories";
import {
  comparisonWindows,
  formatChange,
  type CompareMode,
  parseCompareMode,
  previousPeriodLabel,
  relativeChange,
} from "@/lib/finance/dashboard-compare";
import type { FlowSummary } from "@/lib/finance/dashboard-flow";
import { parseIsoDay, resolvePeriod } from "@/lib/finance/dashboard-period";
import {
  getPeriodFlow,
  getPeriodTotals,
  getRecentTransactions,
  listBalanceAccounts,
  type BalanceAccount,
  type RecentTransaction,
  type StatisticsRange,
} from "@/lib/finance/statistics";
import { formatDayMonth } from "@/lib/format/date";
import { dateInZone } from "@/lib/schedule/utils";
import { countRu } from "@/lib/format/plural";
import { signedAmountClass, type AmountRoundingScale } from "@/lib/format/amount";
import { listAccountVenues, listLegalEntities } from "@/lib/org/legal-entities";
import {
  getActiveAccountAmountRoundingScale,
  getActiveAccountTimezone,
} from "@/lib/settings/account";
import { calendarDateInZone } from "@/lib/format/zoned-day";
import { createClient, getCachedPermissionChecker } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { BankAccountType } from "@/types/database";

import { DashboardShell } from "../_components/dashboard-shell";
import { RetryButton } from "../_components/retry-button";

export const metadata: Metadata = { title: "Дашборд финансов" };

type SearchParams = {
  date_from?: string;
  date_to?: string;
  venue_id?: string;
  /** `year` — сравнивать с тем же периодом год назад; иначе с прошлым. */
  compare?: string;
};

const NO_CATEGORY = "__no-category__";

const ACCOUNT_TYPE: Record<BankAccountType, { label: string; icon: LucideIcon }> = {
  cash: { label: "Касса", icon: Wallet },
  checking: { label: "Расчётный счёт", icon: Landmark },
  debit_card: { label: "Карта", icon: CreditCard },
  fund: { label: "Фонд", icon: Banknote },
  safe: { label: "Сейф", icon: Lock },
};

export default async function FinanceDashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const can = await getCachedPermissionChecker();
  if (!can("finance.view_dashboard")) redirect("/dashboard");
  // Строки дашборда — операции и счета, их RLS пускает только с этими
  // правами. Без права показываем прочерк с причиной, а не нули.
  const canSeeTransactions = can("finance.view_transactions");
  const canSeeAccounts = can("finance.view_bank_accounts");
  const canPickLegalEntity = can("finance.view_all_legal_entities");
  const canPickVenue = can("finance.view_all_venues");
  const canCreate = canSeeTransactions && can("finance.create_transaction");

  const sp = await searchParams;

  const [{ rows: legalEntities }, { rows: venues }, cookieLegalEntityId, scale, timeZone] =
    await Promise.all([
      listLegalEntities(),
      listAccountVenues({ liveOnly: true }),
      getActiveFinanceLegalEntityId(),
      getActiveAccountAmountRoundingScale(),
      getActiveAccountTimezone(),
    ]);

  // «Сегодня» — в поясе аккаунта, а не сервера (на проде он в UTC): иначе с
  // полуночи до трёх ночи первого числа сервер считал бы текущим прошлый
  // месяц, а шапка в браузере — новый. По этому же поясу режут периоды
  // `statistics.ts` и «Транзакции». Шапка получает этот же день.
  const todayIso = todayInZone(timeZone);
  const today = parseIsoDay(todayIso) ?? new Date();
  const { period } = resolvePeriod(sp.date_from, sp.date_to, today);

  // Выбор из адреса или cookie, которого нет среди доступных вариантов
  // (юрлицо в архиве, чужое заведение), не применяем: иначе данные были бы
  // отфильтрованы условием, которое на экране не видно.
  const legalEntityId =
    canPickLegalEntity && legalEntities.some((le) => le.id === cookieLegalEntityId)
      ? cookieLegalEntityId
      : null;
  const venueId =
    canPickVenue && venues.some((v) => v.id === sp.venue_id) ? sp.venue_id! : null;

  const range: StatisticsRange = {
    date_from: period.from,
    date_to: period.to,
    legal_entity_id: legalEntityId,
    venue_id: venueId,
  };

  // С чем сравнивать итоги — выбор в шапке: прошлый период или тот же
  // период год назад. Идущий период сравнивается по прошедшим дням. Когда
  // прошлый период и есть «год назад» (выбран год), выбирать нечего.
  const comparisons = canSeeTransactions ? comparisonWindows(period, today) : null;
  const compareMode = comparisons?.previous ? parseCompareMode(sp.compare) : "year";
  const compareWindow = comparisons
    ? compareMode === "previous"
      ? comparisons.previous
      : comparisons.lastYear
    : null;
  const windows = compareWindow ? [compareWindow] : [];

  const [
    balance,
    flowResult,
    recentResult,
    { rows: categories },
    { rows: bankAccounts },
    windowTotals,
  ] = await Promise.all([
      canSeeAccounts
        ? listBalanceAccounts({ legal_entity_id: legalEntityId })
        : Promise.resolve(null),
      canSeeTransactions
        ? getPeriodFlow(range, 5, comparisons?.cutoff ?? null)
        : Promise.resolve(null),
      canSeeTransactions ? getRecentTransactions(range, 8) : Promise.resolve(null),
      listFinanceCategories({ include_inactive: true }),
      // С удалёнными: последние операции могут ссылаться на удалённый счёт.
      listBankAccounts({ include_deleted: true }),
      Promise.all(
        windows.map((w) =>
          getPeriodTotals({ ...range, date_from: w.period.from, date_to: w.period.to }),
        ),
      ),
    ]);

  const recent = recentResult?.rows ?? [];
  const counterpartyNames = await loadCounterpartyNames(recent);

  const leName = new Map(legalEntities.map((le) => [le.id, le.short_name ?? le.name]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const categoryColor = new Map(categories.map((c) => [c.id, c.color]));
  const accountName = new Map(bankAccounts.map((a) => [a.id, a.name]));

  const flow = flowResult?.flow ?? null;
  const elapsed = flowResult?.elapsed ?? null;
  // Окно без итогов (ошибка чтения) просто не показывается: сравнение —
  // подсказка, а не сам показатель.
  const baselines = windows.flatMap((w, i) => {
    const summary = windowTotals[i]?.summary;
    return summary ? [{ label: w.label, summary }] : [];
  });
  const flowFailed = !!flowResult?.error;
  const balanceFailed = !!balance?.error;
  const totalBalance = balance && !balance.error
    ? balance.rows.reduce((sum, a) => sum + a.balance, 0)
    : null;

  const flowHint = (count: number | undefined) =>
    !canSeeTransactions
      ? "Нет доступа к операциям"
      : flowFailed
        ? "Не удалось загрузить"
        : countRu(count ?? 0, "операция", "операции", "операций");

  const transactionsHref = (extra: Record<string, string> = {}) =>
    `/finance/transactions?${new URLSearchParams({
      date_from: period.from,
      date_to: period.to,
      ...(venueId ? { venue_id: venueId } : {}),
      ...extra,
    })}`;

  return (
    <>
      <Breadcrumbs items={[{ label: "Финансы" }, { label: "Дашборд" }]} />
      <PageFrame>
        <DashboardShell
          today={todayIso}
          period={period}
          compare={
            comparisons?.previous
              ? { mode: compareMode, previousLabel: previousPeriodLabel(period) }
              : null
          }
          canCreate={canCreate}
          venueId={venueId}
          venues={
            canPickVenue && venues.length > 1
              ? venues.map((v) => ({ value: v.id, label: v.name }))
              : []
          }
          legalEntityId={legalEntityId}
          legalEntities={
            canPickLegalEntity && legalEntities.length > 1
              ? legalEntities.map((le) => ({ value: le.id, label: le.short_name ?? le.name }))
              : []
          }
        >
          <MetricStrip label="Итоги за период">
            <Metric
              primary
              label="На счетах"
              href={canSeeAccounts ? "/finance/accounts" : undefined}
              icon={canSeeAccounts ? <ArrowUpRight size={15} aria-hidden /> : undefined}
              value={<Money value={totalBalance} scale={scale} />}
              hint={
                !canSeeAccounts
                  ? "Нет доступа к счетам"
                  : balanceFailed
                    ? "Не удалось загрузить"
                    : venueId
                      ? "Сейчас, по всем заведениям"
                      : `Сейчас · ${countRu(balance?.rows.length ?? 0, "счёт", "счёта", "счетов")}`
              }
            />
            <Metric
              label="Доходы"
              href={flow ? transactionsHref({ type: "income" }) : undefined}
              icon={flow ? <ArrowUpRight size={15} aria-hidden /> : undefined}
              value={<Money value={flow?.summary.income} scale={scale} />}
              hint={
                (elapsed && changeLines("income", elapsed, baselines, scale, compareMode)) ??
                flowHint(flow?.summary.incomeCount)
              }
            />
            <Metric
              label="Расходы"
              href={flow ? transactionsHref({ type: "expense" }) : undefined}
              icon={flow ? <ArrowUpRight size={15} aria-hidden /> : undefined}
              value={<Money value={flow?.summary.expense} scale={scale} />}
              hint={
                (elapsed && changeLines("expense", elapsed, baselines, scale, compareMode)) ??
                flowHint(flow?.summary.expenseCount)
              }
            />
            <Metric
              label="Чистый поток"
              value={<Money value={flow?.summary.net} scale={scale} signed />}
              hint={
                (elapsed && changeLines("net", elapsed, baselines, scale, compareMode)) ??
                (flow ? "Без учёта переводов" : flowHint(undefined))
              }
            />
          </MetricStrip>

          {(canSeeTransactions || canSeeAccounts) && (
            <div className="grid gap-6 lg:grid-cols-2">
              {canSeeTransactions && (
                <Section
                  title="Расходы по статьям"
                  action={
                    flow && flow.summary.expenseCount > 0 ? (
                      <SectionLink href={transactionsHref({ type: "expense" })} label="Все расходы" />
                    ) : null
                  }
                >
                  {flowFailed ? (
                    <LoadError what="расходы" />
                  ) : !flow || flow.top.length === 0 ? (
                    <Empty>Расходов за период нет</Empty>
                  ) : (
                    <ul className="space-y-4">
                      {flow.top.map((c) => (
                        <CategoryBar
                          key={c.category_id ?? NO_CATEGORY}
                          href={transactionsHref({
                            type: "expense",
                            category_id: c.category_id ?? NO_CATEGORY,
                          })}
                          label={
                            c.category_id
                              ? (categoryName.get(c.category_id) ?? "Статья удалена")
                              : "Без статьи"
                          }
                          color={c.category_id ? (categoryColor.get(c.category_id) ?? null) : null}
                          amount={c.amount}
                          count={c.count}
                          share={c.share}
                          scale={scale}
                        />
                      ))}
                      {flow.rest ? (
                        <CategoryBar
                          label={`Остальные · ${countRu(flow.rest.categories, "статья", "статьи", "статей")}`}
                          amount={flow.rest.amount}
                          count={flow.rest.count}
                          share={flow.rest.share}
                          scale={scale}
                          muted
                        />
                      ) : null}
                    </ul>
                  )}
                </Section>
              )}

              {canSeeAccounts && (
                <Section
                  title="Остатки на счетах"
                  action={<SectionLink href="/finance/accounts" label="Все счета" />}
                >
                  {balanceFailed ? (
                    <LoadError what="счета" />
                  ) : !balance || balance.rows.length === 0 ? (
                    <Empty>Счетов пока нет</Empty>
                  ) : (
                    <AccountList
                      accounts={balance.rows}
                      legalEntityName={
                        // Юрлицо под названием нужно, только когда в списке их несколько.
                        new Set(balance.rows.map((a) => a.legal_entity_id)).size > 1
                          ? (id) => leName.get(id) ?? null
                          : () => null
                      }
                      scale={scale}
                    />
                  )}
                </Section>
              )}
            </div>
          )}

          {canSeeTransactions && (
            <Section
              title="Последние операции"
              action={
                recent.length > 0 ? (
                  <SectionLink href={transactionsHref()} label="Все операции" />
                ) : null
              }
            >
              {recentResult?.error ? (
                <LoadError what="операции" />
              ) : recent.length === 0 ? (
                <Empty>Операций за период нет</Empty>
              ) : (
                <ul className="-mx-2">
                  {recent.map((tx) => (
                    <RecentRow
                      key={tx.id}
                      tx={tx}
                      accountName={(id) => (id ? (accountName.get(id) ?? "Счёт удалён") : null)}
                      categoryName={(id) => (id ? (categoryName.get(id) ?? null) : null)}
                      categoryColor={(id) => (id ? (categoryColor.get(id) ?? null) : null)}
                      counterpartyName={(id) => (id ? (counterpartyNames.get(id) ?? null) : null)}
                      scale={scale}
                      timeZone={timeZone}
                    />
                  ))}
                </ul>
              )}
            </Section>
          )}
        </DashboardShell>
      </PageFrame>
    </>
  );
}

// ─── Данные ────────────────────────────────────────────────────────────────

/**
 * Сегодняшний день в поясе аккаунта. Незнакомое Intl значение бросило бы
 * RangeError и уронило страницу — тогда берём московское время.
 */
function todayInZone(timeZone: string): string {
  try {
    return dateInZone(new Date(), timeZone);
  } catch {
    return dateInZone(new Date(), "Europe/Moscow");
  }
}

/** Имена контрагентов только для показанных операций — справочник может быть большим. */
async function loadCounterpartyNames(rows: RecentTransaction[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((r) => r.counterparty_id).filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const supabase = await createClient();
  const { data } = await supabase.from("counterparties").select("id, name").in("id", ids);
  return new Map((data ?? []).map((c) => [c.id, c.name]));
}

// ─── Блоки ─────────────────────────────────────────────────────────────────

type Baseline = { label: string; summary: FlowSummary };

/**
 * Строки сравнения под показателем: «+12% к 1–21 октября», «−3% к ноябрю
 * 2025». Цвет — по смыслу, а не по знаку: рост расходов красный. У чистого
 * потока — разница в деньгах: процент от суммы, которая бывает минусовой,
 * ничего не значит. Окно без операций пропускается; если не осталось ни
 * одного — `null`, и под числом остаётся обычная подпись.
 */
function changeLines(
  kind: "income" | "expense" | "net",
  current: FlowSummary,
  baselines: Baseline[],
  scale: AmountRoundingScale,
  mode: CompareMode,
): ReactNode {
  if (baselines.length === 0) return null;
  const lines = baselines.flatMap(({ label, summary }) => {
    if (kind === "net") {
      if (summary.incomeCount + summary.expenseCount === 0) return [];
      return [
        <span key={label} className="block" data-tip={`Было: ${formatRub(summary.net, { scale })}`}>
          <Money value={current.net - summary.net} scale={scale} signed /> к {label}
        </span>,
      ];
    }
    const count = kind === "income" ? summary.incomeCount : summary.expenseCount;
    const change = relativeChange(current[kind], summary[kind]);
    if (count === 0 || change === null) return [];
    return [
      <span key={label} className="block" data-tip={`Было: ${formatRub(summary[kind], { scale })}`}>
        <span className={cn("tabular-nums", signedAmountClass(kind === "expense" ? -change : change))}>
          {formatChange(change)}
        </span>{" "}
        к {label}
      </span>,
    ];
  });
  // Выбранное окно без операций: говорим об этом, а не молча показываем
  // число операций — иначе непонятно, куда делось сравнение.
  if (lines.length) return <>{lines}</>;
  return mode === "year" ? "Год назад операций не было" : "В прошлом периоде операций не было";
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-lg border bg-card p-5" aria-label={title}>
      <div className="mb-4 flex min-h-8 items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-normal">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Переход к полному списку. На телефоне — «Все», чтобы заголовок блока не переносился. */
function SectionLink({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="outline" size="sm" className="shrink-0">
      <Link href={href} aria-label={label}>
        <span className="sm:hidden">Все</span>
        <span className="hidden sm:inline">{label}</span>
        <ArrowRight className="size-4" />
      </Link>
    </Button>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

function LoadError({ what }: { what: string }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
    >
      Не удалось загрузить {what}
      <RetryButton />
    </div>
  );
}

function CategoryBar({
  label,
  href,
  color = null,
  amount,
  count,
  share,
  scale,
  muted = false,
}: {
  label: string;
  href?: string;
  /** Цвет статьи; без него и у «Остальных» полоска нейтральная. */
  color?: string | null;
  amount: number;
  count: number;
  share: number;
  scale: AmountRoundingScale;
  muted?: boolean;
}) {
  const pct = Math.round(share * 100);
  return (
    <li className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex min-w-0 items-center gap-2">
          <CategoryColorDot color={color} size="md" />
          {href ? (
            <Link href={href} className="min-w-0 truncate hover:underline" data-tip={label} data-tip-overflow>
              {label}
            </Link>
          ) : (
            <span className={cn("min-w-0 truncate", muted && "text-muted-foreground")}>{label}</span>
          )}
        </span>
        <Money value={amount} scale={scale} className="shrink-0 font-medium" />
      </div>
      {/* Доля меньше процента всё равно видна тонкой полоской. */}
      <CategoryShareBar color={color} percent={Math.max(share * 100, share > 0 ? 1 : 0)} />
      <p className="text-xs text-muted-foreground tabular-nums">
        {pct < 1 && share > 0 ? "меньше 1%" : `${pct}%`} расходов ·{" "}
        {countRu(count, "операция", "операции", "операций")}
      </p>
    </li>
  );
}

function AccountList({
  accounts,
  legalEntityName,
  scale,
}: {
  accounts: BalanceAccount[];
  legalEntityName: (id: string) => string | null;
  scale: AmountRoundingScale;
}) {
  return (
    <ul className="-mx-2">
      {accounts.map((account) => {
        const type = ACCOUNT_TYPE[account.type] ?? ACCOUNT_TYPE.checking;
        const Icon = type.icon;
        const le = legalEntityName(account.legal_entity_id);
        return (
          <li key={account.id}>
            <Link
              href={`/finance/accounts/${account.id}`}
              className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/60"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{account.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {le ? `${type.label} · ${le}` : type.label}
                </span>
              </span>
              <Money
                value={account.balance}
                scale={scale}
                className={cn(
                  "shrink-0 text-sm font-medium",
                  // Минус на счёте — сигнал, а не знак потока: красим только его.
                  account.balance < 0 && signedAmountClass(account.balance),
                )}
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

const TX_ICON: Record<RecentTransaction["type"], { icon: LucideIcon; className: string; label: string }> = {
  income: {
    icon: TrendingUp,
    className: "bg-green-500/10 text-green-700 dark:text-green-400",
    label: "Доход",
  },
  expense: {
    icon: TrendingDown,
    className: "bg-red-500/10 text-red-700 dark:text-red-400",
    label: "Расход",
  },
  transfer: {
    icon: ArrowLeftRight,
    className: "bg-muted text-muted-foreground",
    label: "Перевод",
  },
};

function RecentRow({
  tx,
  accountName,
  categoryName,
  categoryColor,
  counterpartyName,
  scale,
  timeZone,
}: {
  tx: RecentTransaction;
  accountName: (id: string | null) => string | null;
  categoryName: (id: string | null) => string | null;
  categoryColor: (id: string | null) => string | null;
  counterpartyName: (id: string | null) => string | null;
  scale: AmountRoundingScale;
  timeZone: string;
}) {
  const kind = TX_ICON[tx.type];
  const Icon = kind.icon;
  const category = categoryName(tx.category_id);
  const counterparty = counterpartyName(tx.counterparty_id);
  const account =
    tx.type === "transfer"
      ? [accountName(tx.bank_account_id), accountName(tx.to_bank_account_id)]
          .filter(Boolean)
          .join(" → ")
      : accountName(tx.bank_account_id);
  const title = tx.description?.trim() || counterparty || category || kind.label;
  // Календарный день — в поясе аккаунта: у выплат зарплаты дата с часами.
  const day = formatDayMonth(calendarDateInZone(tx.date, timeZone));
  // Статья в строке подробностей — с точкой своего цвета, как в журнале.
  const showCategory = !!category && category !== title;
  const before = [day, account].filter(Boolean).join(" · ");
  const after = counterparty && counterparty !== title ? counterparty : null;
  const amount = Number(tx.amount);
  return (
    <li>
      <Link
        // Панель операции открывается в журнале по ?id=.
        href={`/finance/transactions?id=${tx.id}`}
        className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/60"
      >
        <span
          className={cn("grid size-9 shrink-0 place-items-center rounded-md", kind.className)}
          aria-label={kind.label}
          role="img"
        >
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm" data-tip={title} data-tip-overflow>
            {title}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {before}
            {showCategory ? (
              <>
                {" · "}
                <CategoryColorDot
                  color={categoryColor(tx.category_id)}
                  size="sm"
                  className="mr-1 align-middle"
                />
                {category}
              </>
            ) : null}
            {after ? ` · ${after}` : null}
          </span>
        </span>
        <Money
          value={tx.type === "expense" ? -amount : amount}
          scale={scale}
          signed={tx.type !== "transfer"}
          className={cn("shrink-0 text-sm font-medium", tx.type === "transfer" && "text-foreground")}
        />
      </Link>
    </li>
  );
}
