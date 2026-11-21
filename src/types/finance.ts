// Domain types for the Finance block. Re-exports the generated
// `Tables<'...'>` rows under shorter aliases and adds form-input
// shapes that the UI/server-action layer accepts as patches.

import type { Tables } from "./database";

// ─── Row shapes (re-exports from generated database.ts) ─────────────────────

export type BankAccountGroupRow      = Tables<"bank_account_groups">;
// balance_anchor_at — контрольный остаток переноса (миграция 257), в сгенерированных типах его нет.
export type BankAccountRow           = Tables<"bank_accounts"> & { excluded_from_balance?: boolean; balance_anchor_at?: string | null };
// is_payroll — миграция 246 (группа «Фонд оплаты труда»), в сгенерированных типах её нет.
export type FinanceCategoryGroupRow  = Tables<"finance_category_groups"> & { is_payroll?: boolean };
// Adapter: миграция 202 заменила is_active на archived_at + archived_by;
// Database-типы ещё не регенерены. Берём базовый Tables-row и наслаиваем
// новые поля + убираем удалённые. Это идиоматичный паттерн для свежих миграций.
type FinanceCategoryRowBase = Omit<Tables<"finance_categories">, "is_active">;
export type FinanceCategoryRow = FinanceCategoryRowBase & {
  archived_at: string | null;
  archived_by: string | null;
  /** Статья ФОТ должности (миграция 246): название и группу ведёт должность. */
  payroll_role_id?: string | null;
};
export type CounterpartyGroupRow     = Tables<"counterparty_groups">;
export type CounterpartyRow          = Tables<"counterparties">;
export type TransactionRow           = Tables<"transactions">;
export type AccountFileRow           = Tables<"account_files">;
export type TransactionAttachmentRow = Tables<"transaction_attachments">;
export type CounterpartyAttachmentRow = Tables<"counterparty_attachments">;
export type LegalEntityAttachmentRow  = Tables<"legal_entity_attachments">;

// ─── Form-input shapes ───────────────────────────────────────────────────────
// Mirror the writable columns in each table. account_id, audit, and
// soft-delete columns are filled by the lib layer (see src/lib/finance/*).

export type BankAccountFormInput = {
  legal_entity_id: string;
  venue_id?: string | null;
  name: string;
  type: BankAccountRow["type"];
  currency?: string;
  description?: string | null;
  group_id?: string | null;

  bank_name?: string | null;
  bik?: string | null;
  account_number?: string | null;
  correspondent_account?: string | null;
  acquiring_percentage?: number | null;

  card_holder?: string | null;
  card_number_last4?: string | null;
};

export type FinanceCategoryFormInput = {
  name: string;
  type: FinanceCategoryRow["type"];
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  group_id?: string | null;
  sort_order?: number;
};

export type FinanceCategoryGroupFormInput = {
  name: string;
  type?: "income" | "expense" | "mixed" | null;
  sort_order?: number;
};

export type CounterpartyFormInput = {
  name: string;
  legal_form?: CounterpartyRow["legal_form"];
  inn?: string | null;
  kpp?: string | null;
  ogrn?: string | null;
  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  description?: string | null;
  group_id?: string | null;
};

export type CounterpartyGroupFormInput = {
  name: string;
  description?: string | null;
  sort_order?: number;
};

// ─── Transactions ────────────────────────────────────────────────────────────
// Three discriminated variants share `account_id`, `legal_entity_id`,
// `bank_account_id`, `amount`, `date`, etc. Transfer adds `to_bank_account_id`
// and `to_legal_entity_id`; income/expense forbid both. The DB enforces this
// via check constraints (migration 040), but we keep the variant separation
// at the type level so callers can't accidentally mix them up.

type TransactionCommon = {
  legal_entity_id: string;
  venue_id?: string | null;
  bank_account_id: string;
  amount: number;
  currency?: string;
  date: string;
  description?: string | null;
  source?: TransactionRow["source"];
  source_external_id?: string | null;
};

export type IncomeTransactionInput = TransactionCommon & {
  type: "income";
  category_id?: string | null;
  counterparty_id?: string | null;
};

export type ExpenseTransactionInput = TransactionCommon & {
  type: "expense";
  category_id?: string | null;
  counterparty_id?: string | null;
};

export type TransferTransactionInput = TransactionCommon & {
  type: "transfer";
  to_bank_account_id: string;
  to_legal_entity_id: string;
};

export type TransactionFormInput =
  | IncomeTransactionInput
  | ExpenseTransactionInput
  | TransferTransactionInput;


// ─── Повторяющиеся платежи ──────────────────────────────────────────────────

export type RecurringTemplateRow   = Tables<"finance_recurring_templates">;
export type RecurringOccurrenceRow = Tables<"finance_recurring_occurrences">;

/** Расписание шаблона: день месяца, день квартала или день недели (1 = пн … 7 = вс). */
export type RecurringSchedule =
  | { frequency: "monthly"; dayOfMonth: number }
  | { frequency: "quarterly"; dayOfMonth: number; quarterMonth: 1 | 2 | 3 }
  | { frequency: "weekly"; weekday: number };

export type RecurringTemplateInput = {
  name: string;
  type: "income" | "expense";
  legal_entity_id: string;
  venue_id: string | null;
  bank_account_id: string;
  category_id: string | null;
  counterparty_id: string | null;
  amount: number;
  amount_varies: boolean;
  description: string | null;
  schedule: RecurringSchedule;
  starts_on: string;
  ends_on: string | null;
  source_transaction_id?: string | null;
};

export type RecurringTemplateListItem = RecurringTemplateRow & { next_due: string | null };
