"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  Download,
  Plus,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { TransactionsFilters } from "./transactions-filters";
import type {
  BankAccountRow,
  CounterpartyRow,
  FinanceCategoryRow,
  TransactionListFilters,
  TransactionRow,
} from "@/types/finance";

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

type LegalEntityOption = {
  id: string;
  name: string;
  short_name?: string | null;
  inn?: string | null;
};

type VenueOption = { id: string; name: string };

type Props = {
  transactions: TransactionRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: TransactionListFilters;
  /** Cookie-driven default LE; shown above the table as info if no URL filter is set. */
  activeLegalEntityIdFromCookie: string | null;
  legalEntities: LegalEntityOption[];
  venues: VenueOption[];
  bankAccounts: BankAccountRow[];
  categories: FinanceCategoryRow[];
  counterparties: CounterpartyRow[];
  canCreate: boolean;
  /** finance.delete_transaction — gates the «Показать удалённые» toggle. */
  canSeeDeleted: boolean;
  /** finance.export — gates the «Экспорт» button. */
  canExport: boolean;
};

export function TransactionsList({
  transactions,
  total,
  page,
  pageSize,
  filters,
  activeLegalEntityIdFromCookie,
  legalEntities,
  venues,
  bankAccounts,
  categories,
  counterparties,
  canCreate,
  canSeeDeleted,
  canExport,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Quick lookup maps for cell rendering — avoids repeated find().
  const legalEntityName = (id: string) =>
    legalEntities.find((le) => le.id === id)?.short_name ??
    legalEntities.find((le) => le.id === id)?.name ??
    "—";
  const bankAccountName = (id: string | null) =>
    id ? bankAccounts.find((b) => b.id === id)?.name ?? "—" : "—";
  const venueName = (id: string | null) =>
    id ? venues.find((v) => v.id === id)?.name ?? null : null;
  const categoryName = (id: string | null) =>
    id ? categories.find((c) => c.id === id)?.name ?? null : null;
  const counterpartyName = (id: string | null) =>
    id ? counterparties.find((c) => c.id === id)?.name ?? null : null;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const fromIndex = (page - 1) * pageSize + 1;
  const toIndex = Math.min(page * pageSize, total);

  const goToPage = (next: number) => {
    const clamped = Math.min(Math.max(1, next), totalPages);
    if (clamped === page) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(clamped));
    startTransition(() => {
      router.push(`/finance/transactions?${params.toString()}`);
    });
  };

  const setPageSize = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("size", next);
    params.set("page", "1");
    startTransition(() => {
      router.push(`/finance/transactions?${params.toString()}`);
    });
  };

  // Inform user the cookie-driven LE filter is in effect (no explicit
  // ?legal_entity_id=… in the URL but the table is still scoped).
  const cookieFilterActive =
    !filters.legal_entity_id && !!activeLegalEntityIdFromCookie;
  const cookieLEName = cookieFilterActive
    ? legalEntityName(activeLegalEntityIdFromCookie)
    : null;

  // Build the export URL from the current searchParams so the user
  // gets the same filtered set they're looking at. Plain anchor with
  // `download` — the browser navigates without leaving the page.
  const exportHref = (() => {
    const qs = searchParams.toString();
    return qs
      ? `/api/finance/transactions/export?${qs}`
      : "/api/finance/transactions/export";
  })();

  return (
    <div className="p-6 md:p-8 w-full max-w-7xl">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold">Транзакции</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Доходы, расходы и переводы. Балансы счетов пересчитываются автоматически.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canExport && (
            <Button asChild variant="outline">
              {/* Plain <a> + download attr — server route streams CSV
                  with Content-Disposition: attachment, browser handles
                  the save dialog. */}
              <a href={exportHref} download>
                <Download className="mr-1.5 h-4 w-4" />
                Экспорт CSV
              </a>
            </Button>
          )}
          {canCreate && (
            <Button asChild>
              <Link href="/finance/transactions/new">
                <Plus className="mr-1.5 h-4 w-4" />
                Создать
              </Link>
            </Button>
          )}
        </div>
      </div>

      <TransactionsFilters
        initial={filters}
        legalEntities={legalEntities}
        venues={venues}
        bankAccounts={bankAccounts}
        categories={categories}
        counterparties={counterparties}
      />

      <div className="mt-3 flex items-center gap-4 flex-wrap">
        {canSeeDeleted && (
          <IncludeDeletedToggle
            checked={!!filters.include_deleted}
            disabled={isPending}
          />
        )}
        {cookieFilterActive && (
          <div className="text-xs text-muted-foreground">
            Активное юрлицо: <span className="text-foreground font-medium">{cookieLEName}</span> — переключатель в шапке.
          </div>
        )}
      </div>

      <div className="mt-4 rounded-md border bg-background overflow-hidden">
        {transactions.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-muted-foreground">
              {total === 0 && Object.keys(filters).filter((k) => k !== "include_deleted").length === 0
                ? "Транзакций пока нет."
                : "По выбранным фильтрам ничего не нашлось."}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-muted-foreground">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Дата</th>
                <th className="px-3 py-2 font-medium">№</th>
                <th className="px-3 py-2 font-medium">Тип</th>
                <th className="px-3 py-2 font-medium text-right">Сумма</th>
                <th className="px-3 py-2 font-medium">Счёт</th>
                <th className="px-3 py-2 font-medium">Статья / Контрагент</th>
                <th className="px-3 py-2 font-medium">Описание</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => {
                const isDeleted = !!tx.deleted_at;
                return (
                  <tr
                    key={tx.id}
                    className={cn(
                      "border-t hover:bg-accent/40 transition-colors",
                      isDeleted && "opacity-60"
                    )}
                  >
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link
                        href={`/finance/transactions/${tx.id}`}
                        className="hover:underline"
                      >
                        {formatDate(tx.date)}
                      </Link>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground tabular-nums">
                      <Link
                        href={`/finance/transactions/${tx.id}`}
                        className="hover:underline"
                      >
                        #{tx.public_id}
                      </Link>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <TypeBadge type={tx.type} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                      <AmountCell tx={tx} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="truncate max-w-[180px]">
                        {bankAccountName(tx.bank_account_id)}
                      </div>
                      {tx.type === "transfer" && (
                        <div className="text-xs text-muted-foreground truncate max-w-[180px]">
                          → {bankAccountName(tx.to_bank_account_id)}
                        </div>
                      )}
                      {venueName(tx.venue_id) && (
                        <div className="text-xs text-muted-foreground truncate max-w-[180px]">
                          {venueName(tx.venue_id)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {categoryName(tx.category_id) && (
                        <div className="truncate max-w-[200px]">
                          {categoryName(tx.category_id)}
                        </div>
                      )}
                      {counterpartyName(tx.counterparty_id) && (
                        <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {counterpartyName(tx.counterparty_id)}
                        </div>
                      )}
                      {!categoryName(tx.category_id) &&
                        !counterpartyName(tx.counterparty_id) && (
                          <span className="text-muted-foreground">—</span>
                        )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="truncate max-w-[260px] text-muted-foreground">
                          {tx.description ?? "—"}
                        </div>
                        {isDeleted && (
                          <Badge variant="outline" className="text-xs font-normal shrink-0">
                            удалена
                          </Badge>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-muted-foreground">
            {fromIndex}–{toIndex} из {total}
          </div>
          <div className="flex items-center gap-3">
            <Select value={String(pageSize)} onValueChange={setPageSize}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s} / стр
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1 || isPending}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm tabular-nums px-2">
                {page} / {totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => goToPage(page + 1)}
                disabled={page >= totalPages || isPending}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function IncludeDeletedToggle({
  checked,
  disabled,
}: {
  checked: boolean;
  disabled: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const handleChange = (next: boolean) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next) {
      params.set("include_deleted", "1");
    } else {
      params.delete("include_deleted");
    }
    // Toggling reset filters list view — pagination indices tied to a
    // different result set become misleading otherwise.
    params.delete("page");
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/finance/transactions?${qs}` : "/finance/transactions");
    });
  };

  return (
    <Label className="flex items-center gap-2 text-sm text-muted-foreground font-normal cursor-pointer select-none">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => handleChange(v === true)}
        disabled={disabled}
      />
      Показать удалённые
    </Label>
  );
}

function TypeBadge({ type }: { type: TransactionRow["type"] }) {
  if (type === "income") {
    return (
      <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 font-normal">
        <TrendingUp className="mr-1 h-3 w-3" />
        Доход
      </Badge>
    );
  }
  if (type === "expense") {
    return (
      <Badge variant="secondary" className="bg-rose-100 text-rose-700 hover:bg-rose-100 font-normal">
        <TrendingDown className="mr-1 h-3 w-3" />
        Расход
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="bg-sky-100 text-sky-700 hover:bg-sky-100 font-normal">
      <ArrowLeftRight className="mr-1 h-3 w-3" />
      Перевод
    </Badge>
  );
}

function AmountCell({ tx }: { tx: TransactionRow }) {
  const formatted = formatRub(Number(tx.amount), tx.currency);
  if (tx.type === "income") {
    return <span className="text-emerald-700 font-medium">+{formatted}</span>;
  }
  if (tx.type === "expense") {
    return <span className="text-rose-700 font-medium">−{formatted}</span>;
  }
  return <span className="font-medium">{formatted}</span>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatRub(value: number, currency = "RUB"): string {
  const formatted = value.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  if (currency === "RUB") return `${formatted} ₽`;
  if (currency === "USD") return `${formatted} $`;
  if (currency === "EUR") return `${formatted} €`;
  return `${formatted} ${currency}`;
}
