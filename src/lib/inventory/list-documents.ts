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
  MAX_PAGE_SIZE,
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
  return { rows, total, page, pageSize, error: null };
}
