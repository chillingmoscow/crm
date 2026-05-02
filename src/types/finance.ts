// Domain types for the Finance block. Re-exports the generated
// `Tables<'...'>` rows under shorter aliases and adds form-input
// shapes that the UI/server-action layer accepts as patches.

import type { Tables } from "./database";

// ─── Row shapes (re-exports from generated database.ts) ─────────────────────

export type BankAccountGroupRow      = Tables<"bank_account_groups">;
export type BankAccountRow           = Tables<"bank_accounts">;
export type FinanceCategoryGroupRow  = Tables<"finance_category_groups">;
export type FinanceCategoryRow       = Tables<"finance_categories">;
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

export type BankAccountGroupFormInput = {
  name: string;
  description?: string | null;
  sort_order?: number;
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

export type TransactionListFilters = {
  legal_entity_id?: string;
  venue_id?: string;
  /** Single id (eq) or list (in). Used by /finance/transactions multi-select. */
  bank_account_id?: string | string[];
  category_id?: string | string[];
  counterparty_id?: string | string[];
  /** When true, also include rows where category_id IS NULL (combined OR with category_id). */
  category_include_none?: boolean;
  /** When true, also include rows where counterparty_id IS NULL (combined OR with counterparty_id). */
  counterparty_include_none?: boolean;
  type?: TransactionRow["type"];
  source?: TransactionRow["source"];
  /** ISO date (inclusive) */
  date_from?: string;
  /** ISO date (inclusive) */
  date_to?: string;
  amount_min?: number;
  amount_max?: number;
  /** Substring search over description */
  q?: string;
  /** When true, soft-deleted rows are included. Default: false. */
  include_deleted?: boolean;
};
