"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeftRight,
  Loader2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { AmountInput } from "@/components/finance/amount-input";
import { BankAccountPicker } from "@/components/finance/bank-account-picker";
import { CategoryPicker } from "@/components/finance/category-picker";
import { CounterpartyPicker } from "@/components/finance/counterparty-picker";
import { LegalEntityPicker } from "@/components/finance/legal-entity-picker";
import { VenuePicker } from "@/components/finance/venue-picker";
import {
  createTransaction,
  updateTransaction,
} from "@/lib/finance/transactions";
import type {
  BankAccountRow,
  CounterpartyRow,
  FinanceCategoryRow,
  TransactionFormInput,
  TransactionRow,
} from "@/types/finance";

type LegalEntityOption = {
  id: string;
  name: string;
  short_name?: string | null;
  inn?: string | null;
};

type VenueOption = { id: string; name: string };

type FormState = {
  type: TransactionRow["type"];
  legal_entity_id: string;
  venue_id: string | null;
  bank_account_id: string;
  amount: number | null;
  currency: string;
  date: string;
  description: string;
  // income / expense
  category_id: string | null;
  counterparty_id: string | null;
  // transfer
  to_bank_account_id: string | null;
  to_legal_entity_id: string | null;
};

type Props = {
  mode: "create" | "edit";
  transactionId?: string;
  initial?: TransactionRow;
  legalEntities: LegalEntityOption[];
  venues: VenueOption[];
  bankAccounts: BankAccountRow[];
  categories: FinanceCategoryRow[];
  counterparties: CounterpartyRow[];
  /** Where to redirect after successful save. Defaults to detail page. */
  successHref?: string;
};

export function TransactionForm({
  mode,
  transactionId,
  initial,
  legalEntities,
  venues,
  bankAccounts,
  categories,
  counterparties,
  successHref,
}: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<FormState>({
    type:               initial?.type ?? "expense",
    legal_entity_id:    initial?.legal_entity_id ?? "",
    venue_id:           initial?.venue_id ?? null,
    bank_account_id:    initial?.bank_account_id ?? "",
    amount:             initial?.amount ?? null,
    currency:           initial?.currency ?? "RUB",
    date:               initial?.date ? toIsoDate(initial.date) : todayIso(),
    description:        initial?.description ?? "",
    category_id:        initial?.category_id ?? null,
    counterparty_id:    initial?.counterparty_id ?? null,
    to_bank_account_id: initial?.to_bank_account_id ?? null,
    to_legal_entity_id: initial?.to_legal_entity_id ?? null,
  });

  // When user changes the type, irrelevant fields get nulled out so a
  // type flip doesn't carry stale data into payload. The DB has check
  // constraints (migration 040) that would reject a transfer with a
  // category, etc.; clearing client-side keeps validation messages
  // honest too.
  const setType = (next: TransactionRow["type"]) => {
    setForm((f) => ({
      ...f,
      type: next,
      // Drop the existing category whenever it doesn't match the new
      // type — the picker is filtered by type, so an income → expense
      // (or vice versa) flip leaves an invisible, now-invalid id in
      // form state that would silently submit through. transfer also
      // clears it (no category column on transfer).
      category_id:
        next === "transfer"
          ? null
          : f.category_id &&
              categories.find((c) => c.id === f.category_id)?.type === next
            ? f.category_id
            : null,
      counterparty_id:    next === "transfer" ? null : f.counterparty_id,
      to_bank_account_id: next === "transfer" ? f.to_bank_account_id : null,
      to_legal_entity_id: next === "transfer" ? f.to_legal_entity_id : null,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    if (!form.legal_entity_id) return toast.error("Выберите юрлицо");
    if (!form.bank_account_id) return toast.error("Выберите счёт");
    if (form.amount === null || form.amount <= 0) {
      return toast.error("Укажите сумму больше нуля");
    }
    if (!form.date) return toast.error("Укажите дату");

    if (form.type === "transfer") {
      if (!form.to_bank_account_id) {
        return toast.error("Выберите счёт получателя");
      }
      if (!form.to_legal_entity_id) {
        return toast.error("Выберите юрлицо получателя");
      }
      if (form.to_bank_account_id === form.bank_account_id) {
        return toast.error("Счёт получателя должен отличаться от счёта-источника");
      }
    }

    setSaving(true);

    // Build the discriminated payload (lib expects TransactionFormInput).
    const common = {
      legal_entity_id: form.legal_entity_id,
      venue_id:        form.venue_id,
      bank_account_id: form.bank_account_id,
      amount:          form.amount,
      currency:        form.currency,
      date:            form.date,
      description:     form.description.trim() || null,
    };

    let payload: TransactionFormInput;
    if (form.type === "transfer") {
      payload = {
        ...common,
        type: "transfer",
        to_bank_account_id: form.to_bank_account_id!,
        to_legal_entity_id: form.to_legal_entity_id!,
      };
    } else {
      payload = {
        ...common,
        type: form.type,
        category_id:     form.category_id,
        counterparty_id: form.counterparty_id,
      };
    }

    if (mode === "create") {
      const { id, error } = await createTransaction(payload);
      setSaving(false);
      if (error || !id) {
        toast.error(error ?? "Не удалось создать транзакцию");
        return;
      }
      toast.success("Транзакция создана");
      router.push(successHref ?? `/finance/transactions/${id}`);
      return;
    }

    if (!transactionId) {
      setSaving(false);
      toast.error("Не задан id транзакции");
      return;
    }
    const { error } = await updateTransaction(transactionId, payload);
    setSaving(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Транзакция сохранена");
    router.push(successHref ?? `/finance/transactions/${transactionId}`);
  };

  // Categories filtered by current type (no income categories on
  // expense transactions and vice versa). Counterparties unfiltered.
  const filteredCategoryType =
    form.type === "transfer" ? undefined : form.type;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Type segmented control. Disabled on edit — changing type
          would need to wipe and re-pick category/counterparty/to_*
          fields, and the lib already normalises on update. */}
      <div className="grid grid-cols-3 gap-2">
        <TypePill
          active={form.type === "income"}
          disabled={mode === "edit"}
          onClick={() => setType("income")}
          icon={<TrendingUp className="h-4 w-4" />}
          accent="emerald"
        >
          Доход
        </TypePill>
        <TypePill
          active={form.type === "expense"}
          disabled={mode === "edit"}
          onClick={() => setType("expense")}
          icon={<TrendingDown className="h-4 w-4" />}
          accent="rose"
        >
          Расход
        </TypePill>
        <TypePill
          active={form.type === "transfer"}
          disabled={mode === "edit"}
          onClick={() => setType("transfer")}
          icon={<ArrowLeftRight className="h-4 w-4" />}
          accent="sky"
        >
          Перевод
        </TypePill>
      </div>
      {mode === "edit" && (
        <p className="-mt-3 text-xs text-muted-foreground">
          Тип транзакции нельзя изменить.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="tx-amount">Сумма</Label>
          <AmountInput
            id="tx-amount"
            value={form.amount}
            onChange={(v) => setForm((f) => ({ ...f, amount: v }))}
            currency={form.currency}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tx-date">Дата</Label>
          <Input
            id="tx-date"
            type="date"
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label>Юрлицо</Label>
          <LegalEntityPicker
            legalEntities={legalEntities}
            value={form.legal_entity_id || null}
            onChange={(v) =>
              setForm((f) => ({
                ...f,
                legal_entity_id: v ?? "",
                // Bank account belongs to a specific LE — clear it
                // when the LE switches so the user re-picks something
                // valid (composite FK migration 037).
                bank_account_id:
                  bankAccounts.find((b) => b.id === f.bank_account_id)?.legal_entity_id !==
                  v
                    ? ""
                    : f.bank_account_id,
              }))
            }
            placeholder="Выберите юрлицо"
            ariaLabel="Юрлицо"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Точка</Label>
          <VenuePicker
            venues={venues}
            value={form.venue_id}
            onChange={(v) => setForm((f) => ({ ...f, venue_id: v }))}
            placeholder="Без точки"
            allowClear
          />
        </div>

        <div className="space-y-1.5">
          <Label>{form.type === "transfer" ? "Счёт-источник" : "Счёт"}</Label>
          <BankAccountPicker
            bankAccounts={bankAccounts}
            value={form.bank_account_id || null}
            onChange={(v) => setForm((f) => ({ ...f, bank_account_id: v ?? "" }))}
            legalEntityId={form.legal_entity_id || undefined}
            placeholder="Выберите счёт"
          />
        </div>

        {form.type === "transfer" && (
          <>
            <div className="space-y-1.5">
              <Label>Юрлицо получателя</Label>
              <LegalEntityPicker
                legalEntities={legalEntities}
                value={form.to_legal_entity_id}
                onChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    to_legal_entity_id: v,
                    to_bank_account_id:
                      bankAccounts.find((b) => b.id === f.to_bank_account_id)?.legal_entity_id !==
                      v
                        ? null
                        : f.to_bank_account_id,
                  }))
                }
                placeholder="Выберите юрлицо"
                ariaLabel="Юрлицо получателя"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Счёт получателя</Label>
              <BankAccountPicker
                bankAccounts={bankAccounts}
                value={form.to_bank_account_id}
                onChange={(v) =>
                  setForm((f) => ({ ...f, to_bank_account_id: v }))
                }
                legalEntityId={form.to_legal_entity_id ?? undefined}
                excludeId={form.bank_account_id || null}
                placeholder="Выберите счёт"
              />
            </div>
          </>
        )}

        {form.type !== "transfer" && (
          <>
            <div className="space-y-1.5">
              <Label>Статья</Label>
              <CategoryPicker
                categories={categories}
                value={form.category_id}
                onChange={(v) => setForm((f) => ({ ...f, category_id: v }))}
                type={filteredCategoryType}
                placeholder="Без статьи"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Контрагент</Label>
              <CounterpartyPicker
                counterparties={counterparties}
                value={form.counterparty_id}
                onChange={(v) => setForm((f) => ({ ...f, counterparty_id: v }))}
                placeholder="Без контрагента"
              />
            </div>
          </>
        )}

        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="tx-description">Описание</Label>
          <Textarea
            id="tx-description"
            value={form.description}
            onChange={(e) =>
              setForm((f) => ({ ...f, description: e.target.value }))
            }
            rows={3}
            placeholder="Необязательно"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            router.push(
              mode === "edit" && transactionId
                ? `/finance/transactions/${transactionId}`
                : "/finance/transactions"
            )
          }
        >
          Отмена
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          {mode === "create" ? "Создать" : "Сохранить"}
        </Button>
      </div>
    </form>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function TypePill({
  active,
  disabled,
  onClick,
  icon,
  accent,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  accent: "emerald" | "rose" | "sky";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
        "disabled:opacity-60 disabled:cursor-not-allowed",
        active
          ? accent === "emerald"
            ? "border-emerald-300 bg-emerald-50 text-emerald-700"
            : accent === "rose"
              ? "border-rose-300 bg-rose-50 text-rose-700"
              : "border-sky-300 bg-sky-50 text-sky-700"
          : "border-border bg-background text-muted-foreground hover:bg-accent"
      )}
    >
      {icon}
      {children}
    </button>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function todayIso(): string {
  // Use the user's local calendar date, not UTC. `toISOString()`
  // converts to UTC first, which shifts the prefilled date forward
  // by a day for users west of UTC in the evening (e.g. PST 22:00
  // local → 05:00 UTC next day → "2026-05-02" instead of today's
  // 2026-05-01). Risky in finance flows where the date drives reports
  // and balances.
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toIsoDate(input: string): string {
  // Accept "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm:ssZ" — strip to date.
  return input.slice(0, 10);
}
