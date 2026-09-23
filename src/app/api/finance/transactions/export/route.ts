import { NextResponse } from "next/server";

import {
  createClient,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import { listLegalEntities, listAccountVenues } from "@/lib/org/legal-entities";
import { listBankAccounts } from "@/lib/finance/bank-accounts";
import { listFinanceCategories } from "@/lib/finance/categories";
import { listCounterparties } from "@/lib/finance/counterparties";
import { listTransactions } from "@/lib/finance/transactions";
import { getActiveFinanceLegalEntityId } from "@/lib/finance/active-legal-entity";
import type {
  TransactionListFilters,
  TransactionRow,
} from "@/types/finance";

/**
 * Hard cap on rows per export — protects the server / browser from
 * trying to materialise a 100k-row CSV when the filter is too loose.
 * 10k covers a couple of years of transactions for a typical RU
 * F&B account; if a user hits this they should narrow the date range.
 */
const MAX_EXPORT_ROWS = 10_000;

const ALLOWED_TYPES = new Set<TransactionRow["type"]>(["income", "expense", "transfer"]);

const TYPE_LABEL: Record<TransactionRow["type"], string> = {
  income:   "Доход",
  expense:  "Расход",
  transfer: "Перевод",
};

const SOURCE_LABEL: Record<TransactionRow["source"], string> = {
  manual:     "Вручную",
  quickresto: "QuickResto",
  import:     "Импорт",
  bank_sync:  "Банк-синк",
};

/**
 * GET /api/finance/transactions/export?<same searchParams as the list page>
 *
 * Returns CSV with the same filter set as /finance/transactions. Gated
 * on finance.export (matrix: owner / admin / accountant; manager does
 * not have it). RLS still applies on top of the permission check.
 *
 * Format: semicolon-separated (Russian Excel default), UTF-8 with BOM
 * so Excel auto-detects encoding. Decimals stay as dots so spreadsheets
 * can do arithmetic without locale parsing — the user can column-format
 * them later.
 */
export async function GET(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const can = await getCachedPermissionChecker();
  if (!can("finance.export")) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  const canSeeDeleted = can("finance.delete_transaction");

  const sp = new URL(request.url).searchParams;
  const filters = parseFilters(sp, canSeeDeleted);

  // Honour the LegalEntitySwitcher cookie like the list page does.
  const cookieLegalEntityId = await getActiveFinanceLegalEntityId();
  const effectiveFilters: TransactionListFilters = {
    ...filters,
    legal_entity_id: filters.legal_entity_id ?? cookieLegalEntityId ?? undefined,
  };

  // Pull lookups + first page concurrently. The page fetch tells us
  // the total; if it exceeds MAX_EXPORT_ROWS we fail fast with a
  // helpful message so the user narrows the filter.
  const [
    firstPage,
    { rows: legalEntities },
    { rows: venues },
    { rows: bankAccounts },
    { rows: categories },
    { rows: counterparties },
  ] = await Promise.all([
    listTransactions({ filters: effectiveFilters, page: 1, pageSize: 200 }),
    listLegalEntities(),
    listAccountVenues(),
    listBankAccounts({ include_deleted: true }),
    listFinanceCategories({ include_inactive: true }),
    listCounterparties({ include_deleted: true }),
  ]);

  if (firstPage.error) {
    return NextResponse.json({ error: firstPage.error }, { status: 500 });
  }

  if (firstPage.total > MAX_EXPORT_ROWS) {
    return NextResponse.json(
      {
        error: `Слишком много транзакций для одной выгрузки (${firstPage.total}). Сузьте период до ${MAX_EXPORT_ROWS}.`,
      },
      { status: 413 }
    );
  }

  // Pull the rest of the pages. Total ≤ 10k → at most 50 round-trips
  // at 200 rows each. listTransactions already orders date desc,
  // public_id desc — preserve that across pages by re-using the same
  // filter set with bumped page numbers.
  const allRows: TransactionRow[] = [...firstPage.rows];
  const totalPages = Math.ceil(firstPage.total / 200);
  for (let p = 2; p <= totalPages; p++) {
    const { rows, error } = await listTransactions({
      filters: effectiveFilters,
      page: p,
      pageSize: 200,
    });
    if (error) {
      return NextResponse.json({ error }, { status: 500 });
    }
    allRows.push(...rows);
  }

  // Build lookup maps for name resolution.
  const leNameById = new Map<string, string>();
  for (const le of legalEntities) {
    leNameById.set(le.id, le.short_name ?? le.name);
  }
  const venueNameById      = new Map(venues.map((v) => [v.id, v.name]));
  const bankAccountNameById = new Map(bankAccounts.map((b) => [b.id, b.name]));
  const categoryNameById    = new Map(categories.map((c) => [c.id, c.name]));
  const counterpartyNameById = new Map(counterparties.map((c) => [c.id, c.name]));

  // Compose CSV. Semicolon separator + double-quote wrap + escape "
  // by doubling. Excel-RU friendly.
  const headers = [
    "Дата",
    "№",
    "Тип",
    "Сумма",
    "Валюта",
    "Юрлицо",
    "Точка",
    "Счёт",
    "Получатель — юрлицо",
    "Получатель — счёт",
    "Статья",
    "Контрагент",
    "Источник",
    "Описание",
    "Удалена",
    "Создано",
  ];

  const lines: string[] = [headers.map(csvCell).join(";")];

  for (const tx of allRows) {
    const row = [
      formatIsoDate(tx.date),
      String(tx.public_id),
      TYPE_LABEL[tx.type],
      // Numeric: dot decimal, no thousand separator — keeps cells
      // arithmetic-friendly. User can format the column locally.
      Number(tx.amount).toFixed(2),
      tx.currency,
      leNameById.get(tx.legal_entity_id) ?? "",
      tx.venue_id ? venueNameById.get(tx.venue_id) ?? "" : "",
      bankAccountNameById.get(tx.bank_account_id) ?? "",
      tx.to_legal_entity_id
        ? leNameById.get(tx.to_legal_entity_id) ?? ""
        : "",
      tx.to_bank_account_id
        ? bankAccountNameById.get(tx.to_bank_account_id) ?? ""
        : "",
      tx.category_id ? categoryNameById.get(tx.category_id) ?? "" : "",
      tx.counterparty_id
        ? counterpartyNameById.get(tx.counterparty_id) ?? ""
        : "",
      SOURCE_LABEL[tx.source] ?? tx.source,
      tx.description ?? "",
      tx.deleted_at ? "да" : "",
      formatIsoDateTime(tx.created_at),
    ];
    lines.push(row.map(csvCell).join(";"));
  }

  // ﻿ BOM at the head of the file makes Excel treat the bytes as
  // UTF-8 instead of cp1251 — without it Cyrillic shows as garbage.
  const body = "﻿" + lines.join("\r\n") + "\r\n";

  // Filename pieces come from query params (date_from / date_to). If
  // either contains a quote / newline / control char, building the
  // header with template-literal interpolation throws inside
  // `new Response(..., { headers })` and the route returns 500 for
  // an attacker-controllable input. Sanitize to ISO-shape only —
  // anything else collapses to "_" so we never expose the raw param
  // back through the header.
  const filenameSuffix = filters.date_from || filters.date_to
    ? `_${sanitiseIsoDate(filters.date_from) ?? "..."}_${sanitiseIsoDate(filters.date_to) ?? "..."}`
    : `_${new Date().toISOString().slice(0, 10)}`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type":        "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="transactions${filenameSuffix}.csv"`,
      "Cache-Control":       "no-store",
    },
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseFilters(
  sp: URLSearchParams,
  canSeeDeleted: boolean
): TransactionListFilters {
  const f: TransactionListFilters = {};

  const type = sp.get("type");
  if (type && ALLOWED_TYPES.has(type as TransactionRow["type"])) {
    f.type = type as TransactionRow["type"];
  }

  const map: Array<[keyof TransactionListFilters, string]> = [
    ["legal_entity_id", "legal_entity_id"],
    ["venue_id",        "venue_id"],
    ["bank_account_id", "bank_account_id"],
    ["category_id",     "category_id"],
    ["counterparty_id", "counterparty_id"],
    ["date_from",       "date_from"],
    ["date_to",         "date_to"],
  ];
  for (const [target, source] of map) {
    const v = sp.get(source);
    if (v) (f as Record<string, unknown>)[target] = v;
  }

  const min = sp.get("amount_min");
  if (min) {
    const n = Number(min);
    if (Number.isFinite(n)) f.amount_min = n;
  }
  const max = sp.get("amount_max");
  if (max) {
    const n = Number(max);
    if (Number.isFinite(n)) f.amount_max = n;
  }
  const q = sp.get("q");
  if (q && q.trim()) f.q = q.trim();

  if (canSeeDeleted) {
    const inc = sp.get("include_deleted");
    if (inc === "1" || inc === "true") f.include_deleted = true;
  }
  return f;
}

function csvCell(value: string): string {
  // CSV/Excel formula injection: Excel and Google Sheets evaluate any
  // cell whose first character is = / + / - / @ / TAB / CR as a
  // formula on open, which lets an attacker store something like
  // `=HYPERLINK(...)` in a description / counterparty name and have
  // it execute when someone exports + opens the file. OWASP-recommended
  // mitigation: prefix risky leading chars with a single quote so the
  // spreadsheet treats the cell as text. We then quote the whole thing
  // for the usual reasons (semicolons, quotes, newlines).
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function sanitiseIsoDate(value: string | undefined | null): string | null {
  // Date-shaped strings only: digits + dashes, max 10 chars
  // (YYYY-MM-DD). Drops anything else so a tampered ?date_from=…
  // can't smuggle quotes / CRLF into the Content-Disposition header.
  if (!value) return null;
  return /^[\d-]{1,10}$/.test(value) ? value : null;
}

function formatIsoDate(iso: string): string {
  return iso.slice(0, 10);
}

function formatIsoDateTime(iso: string): string {
  // YYYY-MM-DD HH:mm — dropping the seconds + timezone so cells fit
  // a default Excel column. UTC by default.
  return iso.slice(0, 16).replace("T", " ");
}
