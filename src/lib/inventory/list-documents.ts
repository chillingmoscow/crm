/**
 * Server-only data layer для страницы /documents (список актов
 * инвентаризации). Обёртка над RPC `list_inventory_documents`
 * (миграция 207), которая инкапсулирует все фильтры, поиск,
 * inbox-сортировку и пагинацию.
 *
 * RPC использует `security invoker` → политика documents_select из
 * миграции 195 применяется автоматически (venue-скоп + право
 * inventory.view_documents / fill_assigned_documents). Так что
 * admin-клиент тут не нужен и НЕ используется (текущий page.tsx
 * обходит RLS через createAdminClient — это исправляется в этом же
 * PR, см. PR description: venue-scope security fix).
 *
 * Чистые хелперы (для тестов и переиспользования) живут в
 * list-documents-shared.ts.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";

import {
  buildRpcArgs,
  normalizeListOptions,
  parseRpcResponse,
  type ListDocumentsOptions,
  type ListDocumentsResult,
} from "./list-documents-shared";

export type {
  AssignedFilter,
  DocumentListRow,
  DocumentSortMode,
  DocumentStatus,
  ListDocumentsFilters,
  ListDocumentsOptions,
  ListDocumentsResult,
} from "./list-documents-shared";
export {
  DOCUMENT_SORT_MODES,
  DOCUMENT_STATUSES,
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT,
  MAX_PAGE_SIZE,
  isDefaultSort,
} from "./list-documents-shared";

/**
 * Список актов инвентаризации текущего активного аккаунта.
 * RLS режет видимость — пользователь без `inventory.view_all_venues`
 * видит только акты своего venue + назначенные ему.
 */
export async function listInventoryDocuments(
  opts: ListDocumentsOptions = {},
): Promise<ListDocumentsResult> {
  const normalized = normalizeListOptions(opts);
  const { page, pageSize } = normalized;

  const supabase = await createClient();
  // RPC ещё не в сгенерированных типах БД — используем asLooseDb,
  // чтобы не блокировать PR'ом regen-types (см. CLAUDE.md о rebase
  // hazards при полном перегене).
  const db = asLooseDb(supabase);

  const { data, error } = await db.rpc("list_inventory_documents", buildRpcArgs(normalized));

  if (error) {
    return { rows: [], total: 0, page, pageSize, error: error.message };
  }

  const { rows, total } = parseRpcResponse(data);

  // «Итоги» в списке = QR-нетто по позициям (как блок «По QR» в карточке акта).
  // documents.shortfall_sum/surplus_sum приходят из Quick Resto на уровне
  // документа и часто = 0 (QR их не заполняет для проведённых актов), хотя по
  // позициям суммы есть. Поэтому считаем сами из document_items.difference_sum.
  // admin-клиент здесь безопасен: суммируем только по document_id, которые RPC
  // (security invoker) уже отдал текущему пользователю — новых данных не раскрываем.
  if (rows.length > 0) {
    const admin = asLooseDb(createAdminClient());
    const documentIds = rows.map((row) => row.id);
    const { data: itemRows } = await admin
      .from<Array<{ document_id: string; difference_sum: number | null }>>("document_items")
      .select("document_id, difference_sum")
      .in("document_id", documentIds);
    const totalsByDocId = new Map<string, { shortfall: number; surplus: number }>();
    for (const item of itemRows ?? []) {
      const value = typeof item.difference_sum === "number" ? item.difference_sum : 0;
      if (value === 0) continue;
      const entry = totalsByDocId.get(item.document_id) ?? { shortfall: 0, surplus: 0 };
      if (value < 0) entry.shortfall += value;
      else entry.surplus += value;
      totalsByDocId.set(item.document_id, entry);
    }
    for (const row of rows) {
      const entry = totalsByDocId.get(row.id);
      if (!entry) continue;
      // Храним недостачу положительным модулем — documents-table считает
      // net = surplus_sum − shortfall_sum.
      row.shortfall_sum = Math.abs(entry.shortfall);
      row.surplus_sum = entry.surplus;
    }
  }

  return { rows, total, page, pageSize, error: null };
}
