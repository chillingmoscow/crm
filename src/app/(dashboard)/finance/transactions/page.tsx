import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { listLegalEntities, listAccountVenues } from "@/lib/org/legal-entities";
import { listBankAccounts, listBankAccountGroups } from "@/lib/finance/bank-accounts";
import {
  listFinanceCategories,
  listFinanceCategoryGroups,
} from "@/lib/finance/categories";
import {
  listCounterparties,
  listCounterpartyGroups,
} from "@/lib/finance/counterparties";
import { listTransactions } from "@/lib/finance/transactions";
import { getActiveFinanceLegalEntityId } from "@/lib/finance/active-legal-entity";
import { getActiveAccountAmountRoundingScale } from "@/lib/settings/account";
import type { TransactionListFilters, TransactionRow } from "@/types/finance";

import { TransactionsPage } from "./_components/transactions-page";

const DEFAULT_PAGE_SIZE = 25;
const ALLOWED_PAGE_SIZES = [25, 50, 100, 200];

const NO_CATEGORY_SENTINEL = "__no-category__";
const NO_COUNTERPARTY_SENTINEL = "__no-counterparty__";

type SearchParams = {
  type?: string;
  legal_entity_id?: string;
  venue_id?: string;
  bank_account_id?: string;
  category_id?: string;
  counterparty_id?: string;
  date_from?: string;
  date_to?: string;
  date_preset?: string;
  amount_min?: string;
  amount_max?: string;
  q?: string;
  page?: string;
  size?: string;
};

/**
 * Server entry for /finance/transactions.
 *
 * URL is the source of truth for filters and pagination — the client
 * mirrors searchParams into UI controls and calls router.push back.
 * Drawer-form / inline-create / multi-select-row state stays client-only.
 *
 * Permission contract:
 * - finance.view_transactions to enter the page (otherwise → /dashboard).
 * - finance.create_transaction to show the «+ Добавить операцию» CTA.
 * - finance.delete_transaction to show bulk-delete and the delete button
 *   inside the edit drawer.
 * - finance.export to show the export-CSV icon.
 */
export default async function TransactionsServerPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();

  const [
    { data: canView },
    { data: canCreate },
    { data: canDelete },
    { data: canExport },
  ] = await Promise.all([
    supabase.rpc("has_permission", { permission_code: "finance.view_transactions" }),
    supabase.rpc("has_permission", { permission_code: "finance.create_transaction" }),
    supabase.rpc("has_permission", { permission_code: "finance.delete_transaction" }),
    supabase.rpc("has_permission", { permission_code: "finance.export" }),
  ]);

  if (!canView) redirect("/dashboard");

  const cookieLegalEntityId = await getActiveFinanceLegalEntityId();
  const filters = parseFilters(sp);

  // Honour the LegalEntitySwitcher cookie when no explicit
  // ?legal_entity_id is in the URL — the cookie is the soft default,
  // a URL filter overrides it.
  const effectiveFilters: TransactionListFilters = {
    ...filters,
    legal_entity_id: filters.legal_entity_id ?? cookieLegalEntityId ?? undefined,
  };

  // parseInt is forgiving for "abc" → NaN, but accepts negatives. Manual
  // lower clamp here; upper bound applied below once we know the count.
  const requestedPage = parseInt(sp.page ?? "1", 10);
  const lowerClampedPage =
    Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const requestedSize = parseInt(sp.size ?? `${DEFAULT_PAGE_SIZE}`, 10);
  const pageSize = ALLOWED_PAGE_SIZES.includes(requestedSize)
    ? requestedSize
    : DEFAULT_PAGE_SIZE;

  const [
    txResult,
    { rows: legalEntities },
    { rows: venues },
    { rows: bankAccounts },
    { rows: bankAccountGroups },
    { rows: categories },
    { rows: categoryGroups },
    { rows: counterparties },
    { rows: counterpartyGroups },
    amountRoundingScale,
  ] = await Promise.all([
    listTransactions({
      filters: effectiveFilters,
      page: lowerClampedPage,
      pageSize,
    }),
    listLegalEntities(),
    listAccountVenues(),
    listBankAccounts({ include_deleted: false }),
    listBankAccountGroups(),
    listFinanceCategories({ include_inactive: false }),
    listFinanceCategoryGroups(),
    listCounterparties({ include_deleted: false }),
    listCounterpartyGroups(),
    getActiveAccountAmountRoundingScale(),
  ]);

  // Final page bounded above by totalPages → ?page=999 doesn't show
  // an empty table with a misleading "999 / 1" counter.
  const totalPages = Math.max(1, Math.ceil(txResult.total / pageSize));
  const page = Math.min(lowerClampedPage, totalPages);

  return (
    <TransactionsPage
      initialTransactions={txResult.rows}
      total={txResult.total}
      page={page}
      pageSize={pageSize}
      activeLegalEntityIdFromCookie={cookieLegalEntityId}
      filtersFromUrl={filters}
      datePresetFromUrl={sp.date_preset ?? null}
      legalEntities={legalEntities}
      venues={venues}
      bankAccounts={bankAccounts}
      bankAccountGroups={bankAccountGroups}
      categories={categories}
      categoryGroups={categoryGroups}
      counterparties={counterparties}
      counterpartyGroups={counterpartyGroups}
      canCreate={!!canCreate}
      canDelete={!!canDelete}
      canExport={!!canExport}
      amountRoundingScale={amountRoundingScale}
    />
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const ALLOWED_TYPES = new Set<TransactionRow["type"]>(["income", "expense", "transfer"]);

function parseFilters(sp: SearchParams): TransactionListFilters {
  const f: TransactionListFilters = {};

  if (sp.type && ALLOWED_TYPES.has(sp.type as TransactionRow["type"])) {
    f.type = sp.type as TransactionRow["type"];
  }

  if (sp.legal_entity_id) f.legal_entity_id = sp.legal_entity_id;
  if (sp.venue_id)        f.venue_id        = sp.venue_id;

  if (sp.bank_account_id) f.bank_account_id = splitCsv(sp.bank_account_id);

  // Category & counterparty: extract the "no-X" sentinel as a separate
  // boolean and pass real ids as an array. The lib then assembles the
  // proper `field.is.null OR field.in.(...)` PostgREST clause.
  const cat = splitCsv(sp.category_id);
  const catNo = cat.includes(NO_CATEGORY_SENTINEL);
  const realCats = cat.filter((id) => id !== NO_CATEGORY_SENTINEL);
  if (realCats.length > 0) f.category_id = realCats;
  if (catNo) f.category_include_none = true;

  const cp = splitCsv(sp.counterparty_id);
  const cpNo = cp.includes(NO_COUNTERPARTY_SENTINEL);
  const realCps = cp.filter((id) => id !== NO_COUNTERPARTY_SENTINEL);
  if (realCps.length > 0) f.counterparty_id = realCps;
  if (cpNo) f.counterparty_include_none = true;

  if (sp.date_from) f.date_from = sp.date_from;
  if (sp.date_to)   f.date_to   = sp.date_to;

  if (sp.amount_min) {
    const n = Number(sp.amount_min);
    if (Number.isFinite(n)) f.amount_min = n;
  }
  if (sp.amount_max) {
    const n = Number(sp.amount_max);
    if (Number.isFinite(n)) f.amount_max = n;
  }

  if (sp.q && sp.q.trim()) f.q = sp.q.trim();

  return f;
}

function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
