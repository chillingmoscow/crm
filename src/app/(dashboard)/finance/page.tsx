import Link from "next/link";
import {
  ArrowLeftRight,
  ArrowRight,
  Banknote,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listLegalEntities, listAccountVenues } from "@/lib/org/legal-entities";
import { listBankAccounts } from "@/lib/finance/bank-accounts";
import { listFinanceCategories } from "@/lib/finance/categories";
import {
  getBalanceByLegalEntity,
  getIncomeExpenseSummary,
  getRecentTransactions,
  getTopExpenseCategories,
} from "@/lib/finance/statistics";
import { DashboardPeriodFilter } from "./_components/dashboard-period-filter";
import type { TransactionRow } from "@/types/finance";

type SearchParams = {
  date_from?: string;
  date_to?: string;
  venue_id?: string;
};

export default async function FinanceDashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;

  // Default range: current month. Stops the page from looking empty
  // on first visit and matches the «Этот месяц» preset so the filter
  // bar reflects the active state.
  const today = new Date();
  const monthStart = isoLocal(new Date(today.getFullYear(), today.getMonth(), 1));
  const monthEnd   = isoLocal(new Date(today.getFullYear(), today.getMonth() + 1, 0));

  // Sanitise once and re-use. `sanitiseIsoDate` returns null for
  // anything that isn't a real ISO calendar date, so a malformed deep
  // link (e.g. /finance?date_from=foo or 2026-13-40) silently falls
  // back to the default month range without crashing the picker.
  const overrideDateFrom = sanitiseIsoDate(sp.date_from);
  const overrideDateTo   = sanitiseIsoDate(sp.date_to);
  const venueId          = sp.venue_id ?? null;

  const dateFrom = overrideDateFrom ?? monthStart;
  const dateTo   = overrideDateTo   ?? monthEnd;

  const [
    { rows: legalEntities },
    { rows: venues },
    { rows: bankAccounts },
    { rows: categories },
    balanceResult,
    summaryResult,
    topResult,
    recentResult,
  ] = await Promise.all([
    listLegalEntities(),
    listAccountVenues(),
    listBankAccounts({ include_deleted: false }),
    listFinanceCategories({ include_inactive: true }),
    getBalanceByLegalEntity(),
    getIncomeExpenseSummary({ date_from: dateFrom, date_to: dateTo, venue_id: venueId ?? undefined }),
    getTopExpenseCategories(
      { date_from: dateFrom, date_to: dateTo, venue_id: venueId ?? undefined },
      5
    ),
    getRecentTransactions(10),
  ]);

  const leNameById = new Map(legalEntities.map((le) => [le.id, le.short_name ?? le.name]));
  const venueNameById = new Map(venues.map((v) => [v.id, v.name]));
  const bankAccountNameById = new Map(bankAccounts.map((b) => [b.id, b.name]));
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

  // Total balance — sum of per-LE balances (in RUB; mixed currencies
  // are summed naively per the lib's MVP spec).
  const totalBalance = balanceResult.rows.reduce((acc, r) => acc + r.balance, 0);

  const summary = summaryResult.summary;
  const topCategories = topResult.rows;
  const recent = recentResult.rows;

  return (
    <div className="p-6 md:p-8 w-full max-w-7xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Дашборд</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Сводка финансов: балансы, доходы и расходы за период, последняя активность.
        </p>
      </div>

      {/* Period filter */}
      <Card>
        <CardContent className="pt-6">
          {/*
            Forwarding raw `sp.date_from` / `sp.date_to` from the URL
            into DateRangePicker would crash the dashboard on a
            malformed deep-link (e.g. `/finance?date_from=foo`) because
            the picker calls format(parseISO(value)) and parseISO of
            "foo" returns Invalid Date, which format() throws on.
            Pass the sanitised values — invalid input shows as empty
            without breaking render.
          */}
          <DashboardPeriodFilter
            initialDateFrom={overrideDateFrom}
            initialDateTo={overrideDateTo}
            initialVenueId={venueId}
            venues={venues}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Показатели рассчитываются за {formatRange(dateFrom, dateTo)}.
            {venueId && venueNameById.get(venueId)
              ? ` Точка: ${venueNameById.get(venueId)}.`
              : " Все точки."}
          </p>
        </CardContent>
      </Card>

      {/* Total balance + per-LE breakdown */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <Wallet className="h-4 w-4" />
              Общий баланс
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {formatRub(totalBalance)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Сумма по всем активным счетам
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
              Доходы за период
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums text-emerald-700">
              {formatRub(summary.income)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {summary.count} транзакций без переводов
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <TrendingDown className="h-4 w-4 text-rose-600" />
              Расходы за период
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums text-rose-700">
              {formatRub(summary.expense)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {/* Net = income - expense; negative means в минус. */}
              Чистый поток: {summary.net >= 0 ? "+" : "−"}
              {formatRub(Math.abs(summary.net))}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <Banknote className="h-4 w-4" />
              Юрлиц с балансом
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {balanceResult.rows.length}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              из {legalEntities.length} в аккаунте
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Per-LE balance breakdown */}
      {balanceResult.rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Балансы по юрлицам</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-md border bg-background">
              {balanceResult.rows
                .slice()
                .sort((a, b) => b.balance - a.balance)
                .map((row) => (
                  <li
                    key={row.legal_entity_id}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <Link
                      href={`/org/legal-entities/${row.legal_entity_id}`}
                      className="hover:underline truncate"
                    >
                      {leNameById.get(row.legal_entity_id) ?? "—"}
                    </Link>
                    <span className="tabular-nums font-medium">
                      {formatRub(row.balance)}
                    </span>
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Top expense categories */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Топ-{topCategories.length || 5} статей расходов
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topCategories.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                За выбранный период расходов нет.
              </p>
            ) : (
              <CategoryBars
                rows={topCategories.map((c) => ({
                  id:    c.category_id,
                  label: c.category_id
                    ? categoryNameById.get(c.category_id) ?? "—"
                    : "Без статьи",
                  amount: c.amount,
                  count:  c.count,
                }))}
                total={topCategories.reduce((a, c) => a + c.amount, 0)}
              />
            )}
          </CardContent>
        </Card>

        {/* Recent transactions */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Последние транзакции</CardTitle>
            <Link
              href="/finance/transactions"
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              Все
              <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                Пока нет транзакций.
              </p>
            ) : (
              <ul className="divide-y rounded-md border bg-background">
                {recent.map((tx) => (
                  <li key={tx.id}>
                    <Link
                      href={`/finance/transactions/${tx.id}`}
                      className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-accent transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <TypeIcon type={tx.type} />
                        <div className="min-w-0">
                          <div className="text-sm truncate">
                            {bankAccountNameById.get(tx.bank_account_id) ?? "—"}
                            {tx.description ? ` — ${tx.description}` : ""}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatDate(tx.date)}
                            {tx.category_id
                              ? ` • ${categoryNameById.get(tx.category_id) ?? "статья"}`
                              : ""}
                          </div>
                        </div>
                      </div>
                      <div
                        className={`text-sm font-medium tabular-nums shrink-0 ${
                          tx.type === "income"
                            ? "text-emerald-700"
                            : tx.type === "expense"
                              ? "text-rose-700"
                              : ""
                        }`}
                      >
                        {tx.type === "income" ? "+" : tx.type === "expense" ? "−" : ""}
                        {formatRub(Number(tx.amount))}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function CategoryBars({
  rows,
  total,
}: {
  rows: { id: string | null; label: string; amount: number; count: number }[];
  total: number;
}) {
  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const pct = total > 0 ? Math.round((row.amount / total) * 100) : 0;
        return (
          <li key={row.id ?? "__none__"} className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate flex items-center gap-2">
                {row.label}
                <Badge variant="secondary" className="text-xs font-normal">
                  {row.count}
                </Badge>
              </span>
              <span className="tabular-nums font-medium shrink-0">
                {formatRub(row.amount)}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-rose-500/70"
                style={{ width: `${pct}%` }}
                aria-hidden
              />
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {pct}% от показанных
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function TypeIcon({ type }: { type: TransactionRow["type"] }) {
  if (type === "income") {
    return (
      <span className="inline-flex aspect-square size-8 items-center justify-center rounded-md bg-emerald-50 text-emerald-700 shrink-0">
        <TrendingUp className="h-4 w-4" />
      </span>
    );
  }
  if (type === "expense") {
    return (
      <span className="inline-flex aspect-square size-8 items-center justify-center rounded-md bg-rose-50 text-rose-700 shrink-0">
        <TrendingDown className="h-4 w-4" />
      </span>
    );
  }
  return (
    <span className="inline-flex aspect-square size-8 items-center justify-center rounded-md bg-sky-50 text-sky-700 shrink-0">
      <ArrowLeftRight className="h-4 w-4" />
    </span>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function isoLocal(d: Date): string {
  // Local-calendar YYYY-MM-DD — same logic as transaction-form
  // todayIso. UTC truncation would shift dates for users west of UTC.
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function sanitiseIsoDate(value: string | undefined | null): string | null {
  if (!value) return null;
  // Shape check first — cheap and rules out most garbage.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  // Then reality check: `2026-13-40` matches the regex but is not a
  // real calendar date. JS `Date` overflows month/day silently
  // (becomes the next year, etc.), so round-trip through UTC and
  // compare. If the parsed date doesn't match the original, the
  // string was nonsense; reject it. Postgres date filters reject
  // these literals too — silent zero values in widgets otherwise.
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}` === value ? value : null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatRange(from: string, to: string): string {
  const fromD = new Date(from);
  const toD = new Date(to);
  const fmt = (d: Date) =>
    d.toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  if (from === to) return fmt(fromD);
  return `${fmt(fromD)} — ${fmt(toD)}`;
}

function formatRub(value: number): string {
  const formatted = value.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${formatted} ₽`;
}
