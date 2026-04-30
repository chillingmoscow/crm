"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AmountInput } from "@/components/finance/amount-input";
import { BankAccountPicker } from "@/components/finance/bank-account-picker";
import { CategoryPicker } from "@/components/finance/category-picker";
import { CounterpartyPicker } from "@/components/finance/counterparty-picker";
import { DateRangePicker, type DateRangeValue } from "@/components/finance/date-range-picker";
import { LegalEntityPicker } from "@/components/finance/legal-entity-picker";
import { VenuePicker } from "@/components/finance/venue-picker";
import type {
  BankAccountRow,
  CounterpartyRow,
  FinanceCategoryRow,
  TransactionListFilters,
} from "@/types/finance";

const TYPE_ALL = "__all__";

type LegalEntityOption = {
  id: string;
  name: string;
  short_name?: string | null;
  inn?: string | null;
};

type VenueOption = { id: string; name: string };

type Props = {
  initial: TransactionListFilters;
  legalEntities: LegalEntityOption[];
  venues: VenueOption[];
  bankAccounts: BankAccountRow[];
  categories: FinanceCategoryRow[];
  counterparties: CounterpartyRow[];
};

/**
 * URL-state-driven filter bar for /finance/transactions. Mutations push
 * to the router which re-renders the server page with new searchParams.
 *
 * Lives in a single client component so we can apply changes only when
 * the user clicks «Применить» — saves a round-trip per keystroke on
 * search and number inputs. DateRange / pickers apply immediately
 * because they're discrete clicks.
 */
export function TransactionsFilters({
  initial,
  legalEntities,
  venues,
  bankAccounts,
  categories,
  counterparties,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [type,           setType]           = useState<string>(initial.type ?? TYPE_ALL);
  const [legalEntityId,  setLegalEntityId]  = useState<string | null>(initial.legal_entity_id ?? null);
  const [venueId,        setVenueId]        = useState<string | null>(initial.venue_id ?? null);
  const [bankAccountId,  setBankAccountId]  = useState<string | null>(initial.bank_account_id ?? null);
  const [categoryId,     setCategoryId]     = useState<string | null>(initial.category_id ?? null);
  const [counterpartyId, setCounterpartyId] = useState<string | null>(initial.counterparty_id ?? null);
  const [range, setRange] = useState<DateRangeValue>({
    from: initial.date_from ?? null,
    to:   initial.date_to ?? null,
  });
  const [amountMin, setAmountMin] = useState<number | null>(initial.amount_min ?? null);
  const [amountMax, setAmountMax] = useState<number | null>(initial.amount_max ?? null);
  const [q, setQ] = useState<string>(initial.q ?? "");
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(
    !!(initial.legal_entity_id || initial.venue_id || initial.counterparty_id || initial.amount_min || initial.amount_max)
  );

  const apply = (overrides?: Partial<TransactionListFilters>) => {
    const merged: Record<string, string | null> = {
      type:            (overrides?.type            ?? (type === TYPE_ALL ? null : type)) ?? null,
      legal_entity_id: (overrides?.legal_entity_id ?? legalEntityId)  ?? null,
      venue_id:        (overrides?.venue_id        ?? venueId)        ?? null,
      bank_account_id: (overrides?.bank_account_id ?? bankAccountId)  ?? null,
      category_id:     (overrides?.category_id     ?? categoryId)     ?? null,
      counterparty_id: (overrides?.counterparty_id ?? counterpartyId) ?? null,
      date_from:       (overrides?.date_from       ?? range.from)     ?? null,
      date_to:         (overrides?.date_to         ?? range.to)       ?? null,
      amount_min:      (overrides?.amount_min      ?? amountMin)      != null
        ? String(overrides?.amount_min ?? amountMin)
        : null,
      amount_max:      (overrides?.amount_max      ?? amountMax)      != null
        ? String(overrides?.amount_max ?? amountMax)
        : null,
      q:               (overrides?.q ?? q)?.trim() || null,
    };

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
      if (value != null && value !== "") params.set(key, String(value));
    }
    // Preserve the user's chosen page size — applying filters resets
    // to page 1 (results don't align across filter sets) but a switch
    // to 100/200 rows per page should survive.
    const currentSize = searchParams.get("size");
    if (currentSize) params.set("size", currentSize);

    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/finance/transactions?${qs}` : "/finance/transactions");
    });
  };

  const reset = () => {
    setType(TYPE_ALL);
    setLegalEntityId(null);
    setVenueId(null);
    setBankAccountId(null);
    setCategoryId(null);
    setCounterpartyId(null);
    setRange({ from: null, to: null });
    setAmountMin(null);
    setAmountMax(null);
    setQ("");
    // Preserve the page-size preference on reset for the same reason
    // as in apply() — clearing filters shouldn't snap pagination back
    // to default.
    const currentSize = searchParams.get("size");
    const qs = currentSize ? `size=${currentSize}` : "";
    startTransition(() => {
      router.push(qs ? `/finance/transactions?${qs}` : "/finance/transactions");
    });
  };

  const hasActive =
    type !== TYPE_ALL ||
    legalEntityId ||
    venueId ||
    bankAccountId ||
    categoryId ||
    counterpartyId ||
    range.from ||
    range.to ||
    amountMin !== null ||
    amountMax !== null ||
    q.trim() !== "";

  return (
    <div className="space-y-3">
      {/* Primary row: search + type + period + apply */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
        className="flex flex-wrap items-center gap-3"
      >
        <div className="relative flex-1 min-w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск по описанию"
            className="pl-9"
          />
        </div>

        <div className="w-44">
          <Select value={type} onValueChange={setType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TYPE_ALL}>Все типы</SelectItem>
              <SelectItem value="income">Доходы</SelectItem>
              <SelectItem value="expense">Расходы</SelectItem>
              <SelectItem value="transfer">Переводы</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="w-72">
          <DateRangePicker value={range} onChange={setRange} />
        </div>

        <div className="w-56">
          <BankAccountPicker
            bankAccounts={bankAccounts}
            value={bankAccountId}
            onChange={setBankAccountId}
            placeholder="Все счета"
            allowClear
          />
        </div>

        <div className="w-56">
          <CategoryPicker
            categories={categories}
            value={categoryId}
            onChange={setCategoryId}
            placeholder="Все статьи"
          />
        </div>

        <Button type="submit" disabled={isPending}>
          Применить
        </Button>
        {hasActive && (
          <Button
            type="button"
            variant="ghost"
            onClick={reset}
            disabled={isPending}
          >
            <X className="mr-1.5 h-4 w-4" />
            Сбросить
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          {advancedOpen ? (
            <ChevronUp className="mr-1.5 h-4 w-4" />
          ) : (
            <ChevronDown className="mr-1.5 h-4 w-4" />
          )}
          Расширенные
        </Button>
      </form>

      {/* Secondary row: LE / venue / counterparty / amount range */}
      {advancedOpen && (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-4 rounded-md border bg-muted/30 p-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Юрлицо</Label>
            <LegalEntityPicker
              legalEntities={legalEntities}
              value={legalEntityId}
              onChange={setLegalEntityId}
              placeholder="Все"
              allowClear
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Точка</Label>
            <VenuePicker
              venues={venues}
              value={venueId}
              onChange={setVenueId}
              placeholder="Все"
              allowClear
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Контрагент</Label>
            <CounterpartyPicker
              counterparties={counterparties}
              value={counterpartyId}
              onChange={setCounterpartyId}
              placeholder="Все"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Сумма</Label>
            <div className="flex items-center gap-2">
              <AmountInput
                value={amountMin}
                onChange={setAmountMin}
                placeholder="от"
                aria-label="Сумма от"
              />
              <span className="text-muted-foreground">—</span>
              <AmountInput
                value={amountMax}
                onChange={setAmountMax}
                placeholder="до"
                aria-label="Сумма до"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
