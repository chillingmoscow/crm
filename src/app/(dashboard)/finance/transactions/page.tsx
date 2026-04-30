import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { listLegalEntities, listAccountVenues } from "@/lib/org/legal-entities";
import { listBankAccounts } from "@/lib/finance/bank-accounts";
import { listFinanceCategories } from "@/lib/finance/categories";
import { listCounterparties } from "@/lib/finance/counterparties";
import { listTransactions } from "@/lib/finance/transactions";
import { getActiveFinanceLegalEntityId } from "@/lib/finance/active-legal-entity";
import { TransactionsList } from "./_components/transactions-list";
import type {
  TransactionListFilters,
  TransactionRow,
} from "@/types/finance";

const DEFAULT_PAGE_SIZE = 50;
const ALLOWED_PAGE_SIZES = [25, 50, 100, 200];

type SearchParams = {
  type?: string;
  legal_entity_id?: string;
  venue_id?: string;
  bank_account_id?: string;
  category_id?: string;
  counterparty_id?: string;
  date_from?: string;
  date_to?: string;
  amount_min?: string;
  amount_max?: string;
  q?: string;
  page?: string;
  size?: string;
};

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();

  // Permission gate up front. Soft-delete / restore UI + create form
  // land in stage 4.5b; for now we only need view.
  const { data: canView } = await supabase.rpc("has_permission", {
    permission_code: "finance.view_transactions",
  });
  if (!canView) redirect("/dashboard");

  const filters = parseFilters(sp);
  const page = parseInt(sp.page ?? "1", 10) || 1;
  const requestedSize = parseInt(sp.size ?? `${DEFAULT_PAGE_SIZE}`, 10);
  const pageSize = ALLOWED_PAGE_SIZES.includes(requestedSize)
    ? requestedSize
    : DEFAULT_PAGE_SIZE;

  // Honour the LegalEntitySwitcher cookie when no explicit
  // legal_entity_id filter is present in the URL — the cookie is the
  // soft default, the URL filter overrides it for this view.
  const cookieLegalEntityId = await getActiveFinanceLegalEntityId();
  const effectiveFilters: TransactionListFilters = {
    ...filters,
    legal_entity_id: filters.legal_entity_id ?? cookieLegalEntityId ?? undefined,
  };

  const [
    txResult,
    { rows: legalEntities },
    { rows: venues },
    { rows: bankAccounts },
    { rows: categories },
    { rows: counterparties },
  ] = await Promise.all([
    listTransactions({ filters: effectiveFilters, page, pageSize }),
    listLegalEntities(),
    listAccountVenues(),
    // Filter dropdowns only need active rows. Detail joins below pull
    // names by id from these arrays — we deliberately don't fetch the
    // full id→name map server-side because the lists are small.
    listBankAccounts({ include_deleted: false }),
    listFinanceCategories({ include_inactive: false }),
    listCounterparties({ include_deleted: false }),
  ]);

  return (
    <TransactionsList
      transactions={txResult.rows}
      total={txResult.total}
      page={page}
      pageSize={pageSize}
      filters={filters}
      activeLegalEntityIdFromCookie={cookieLegalEntityId}
      legalEntities={legalEntities}
      venues={venues}
      bankAccounts={bankAccounts}
      categories={categories}
      counterparties={counterparties}
    />
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const ALLOWED_TYPES = new Set<TransactionRow["type"]>(["income", "expense", "transfer"]);

function parseFilters(sp: SearchParams): TransactionListFilters {
  const f: TransactionListFilters = {};

  // Type — strict whitelist so a stray ?type=foo doesn't slip through.
  if (sp.type && ALLOWED_TYPES.has(sp.type as TransactionRow["type"])) {
    f.type = sp.type as TransactionRow["type"];
  }

  if (sp.legal_entity_id) f.legal_entity_id = sp.legal_entity_id;
  if (sp.venue_id)        f.venue_id        = sp.venue_id;
  if (sp.bank_account_id) f.bank_account_id = sp.bank_account_id;
  if (sp.category_id)     f.category_id     = sp.category_id;
  if (sp.counterparty_id) f.counterparty_id = sp.counterparty_id;
  if (sp.date_from)       f.date_from       = sp.date_from;
  if (sp.date_to)         f.date_to         = sp.date_to;

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
