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
import { asLooseDb, type LooseDb } from "@/lib/supabase/loose";
import { hasCountedResults } from "@/lib/inventory/act-status";
import {
  calculateManagementTotals,
  type InventoryResortAllocationItem,
  type InventoryResultCalculationItem,
} from "@/lib/inventory/results";

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

/**
 * Выборка всех строк по списку актов, с постраничным добиранием.
 *
 * PostgREST режет ответ по `max_rows` (в конфиге — 1000). Список из 25 актов по
 * 300 позиций даёт 7 500 строк: без добора часть актов считалась по половине
 * позиций, и «Сумма итогов» молча занижалась. Курсор двигаем на фактическое
 * число полученных строк — это работает при любом серверном лимите.
 */
async function fetchAllByDocumentIds<T>(input: {
  admin: LooseDb;
  table: string;
  columns: string;
  documentIds: string[];
}): Promise<T[]> {
  const PAGE = 1000;
  const HARD_CAP = 200_000;
  const out: T[] = [];
  let from = 0;

  for (;;) {
    const { data } = await input.admin
      .from(input.table)
      .select(input.columns)
      .in("document_id", input.documentIds)
      .order("id")
      .range(from, from + PAGE - 1);
    const chunk = (data ?? []) as T[];
    out.push(...chunk);
    if (chunk.length === 0 || out.length >= HARD_CAP) break;
    from += chunk.length;
  }

  return out;
}

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

  // «Итоги» в списке = УПРАВЛЕНЧЕСКИЕ итоги (то, что учитываем), а не сырой QR.
  // То есть с учётом исключённых строк и активных пересортов — ровно как блок
  // «К списанию»/«К учёту» в карточке акта (calculateManagementTotals).
  // documents.shortfall_sum/surplus_sum из Quick Resto тут не годятся: они
  // приходят на уровне документа и часто = 0, и это всё равно был бы «По QR».
  // admin-клиент безопасен: читаем только по document_id, которые RPC
  // (security invoker) уже отдал текущему пользователю — новых данных не раскрываем.
  if (rows.length > 0) {
    const admin = asLooseDb(createAdminClient());
    const documentIds = rows.map((row) => row.id);

    const [
      { data: itemRows },
      { data: resortRows },
      { data: resortItemRows },
      { data: docFlagRows },
    ] = await Promise.all([
      fetchAllByDocumentIds<{
        document_id: string;
        id: string;
        difference_amount: number | null;
        difference_sum: number | null;
        excluded_from_totals: boolean | null;
      }>({
        admin,
        table: "document_items",
        columns: "document_id, id, difference_amount, difference_sum, excluded_from_totals",
        documentIds,
      }).then((data) => ({ data })),
      admin
        .from<Array<{ id: string; document_id: string; cost_adjustment_sum: number | null }>>(
          "inventory_result_resorts",
        )
        .select("id, document_id, cost_adjustment_sum")
        .in("document_id", documentIds)
        .eq("status", "active"),
      fetchAllByDocumentIds<{
        document_id: string;
        resort_id: string;
        document_item_id: string;
        role: "shortage" | "surplus";
        source_difference_amount: number | null;
        source_difference_sum: number | null;
        offset_amount: number | null;
        remaining_difference_amount: number | null;
        remaining_difference_sum: number | null;
      }>({
        admin,
        table: "inventory_result_resort_items",
        columns:
          "document_id, resort_id, document_item_id, role, source_difference_amount, source_difference_sum, offset_amount, remaining_difference_amount, remaining_difference_sum",
        documentIds,
      }).then((data) => ({ data })),
      admin
        .from<Array<{
          id: string;
          results_reopened_after_processed: boolean | null;
          recount_of_document_id: string | null;
          qr_shortfall_sum: number | null;
          qr_surplus_sum: number | null;
        }>>("documents")
        .select(
          "id, results_reopened_after_processed, recount_of_document_id, qr_shortfall_sum, qr_surplus_sum",
        )
        .in("id", documentIds),
    ]);

    const reopenedAfterProcessedIds = new Set(
      (docFlagRows ?? [])
        .filter((row) => row.results_reopened_after_processed)
        .map((row) => row.id),
    );
    const recountParentByDoc = new Map(
      (docFlagRows ?? [])
        .filter((row) => row.recount_of_document_id)
        .map((row) => [row.id, row.recount_of_document_id as string]),
    );
    // Суммы самого Quick Resto — отдельной метрикой (миграция 225). В колонке
    // «Итоги» по-прежнему управленческий итог; QR-сумма живёт в собственной
    // (по умолчанию скрытой) колонке и в карточке акта.
    const qrSumsByDoc = new Map(
      (docFlagRows ?? []).map((row) => [
        row.id,
        { shortfall: row.qr_shortfall_sum, surplus: row.qr_surplus_sum },
      ]),
    );
    const activeResortIds = new Set((resortRows ?? []).map((resort) => resort.id));

    const itemsByDoc = new Map<string, InventoryResultCalculationItem[]>();
    for (const item of itemRows ?? []) {
      const list = itemsByDoc.get(item.document_id) ?? [];
      list.push({
        id: item.id,
        differenceAmount: item.difference_amount,
        differenceSum: item.difference_sum,
        excluded: item.excluded_from_totals,
      });
      itemsByDoc.set(item.document_id, list);
    }

    const resortItemsByDoc = new Map<string, InventoryResortAllocationItem[]>();
    for (const resortItem of resortItemRows ?? []) {
      // Только активные пересорты (voided не учитываем).
      if (!activeResortIds.has(resortItem.resort_id)) continue;
      const list = resortItemsByDoc.get(resortItem.document_id) ?? [];
      list.push({
        id: resortItem.document_item_id,
        sourceDifferenceAmount: Number(resortItem.source_difference_amount ?? 0),
        sourceDifferenceSum: Number(resortItem.source_difference_sum ?? 0),
        offsetAmount: Number(resortItem.offset_amount ?? 0),
        remainingDifferenceAmount: Number(resortItem.remaining_difference_amount ?? 0),
        remainingDifferenceSum: Number(resortItem.remaining_difference_sum ?? 0),
        role: resortItem.role,
      });
      resortItemsByDoc.set(resortItem.document_id, list);
    }

    const costAdjustmentsByDoc = new Map<string, number[]>();
    for (const resort of resortRows ?? []) {
      const value = Number(resort.cost_adjustment_sum ?? 0);
      if (!Number.isFinite(value) || value <= 0) continue;
      const list = costAdjustmentsByDoc.get(resort.document_id) ?? [];
      list.push(value);
      costAdjustmentsByDoc.set(resort.document_id, list);
    }

    for (const row of rows) {
      // F6: метка «итоги правились после проведения» — независимо от наличия позиций.
      row.results_reopened_after_processed = reopenedAfterProcessedIds.has(row.id);
      row.recount_of_document_id = recountParentByDoc.get(row.id) ?? null;
      const qrSums = qrSumsByDoc.get(row.id);
      row.qr_shortfall_sum = qrSums?.shortfall ?? null;
      row.qr_surplus_sum = qrSums?.surplus ?? null;
      // Пока акт не сдан, итогов нет: разница из QR равна минус складскому
      // остатку (факт нулевой), и в колонке «Итоги» это выглядело бы как
      // недостача на сотни тысяч по нетронутому акту.
      if (!hasCountedResults(row.status)) {
        row.shortfall_sum = 0;
        row.surplus_sum = 0;
        continue;
      }
      // Управленческий итог считается по строкам. Нет строк — итог нулевой:
      // оставлять хранимое значение нельзя, там раньше лежала сумма Quick Resto
      // (другая метрика), и она читалась бы как управленческая.
      const items = itemsByDoc.get(row.id);
      if (!items) {
        row.shortfall_sum = 0;
        row.surplus_sum = 0;
        continue;
      }
      const totals = calculateManagementTotals({
        items,
        resortItems: resortItemsByDoc.get(row.id) ?? [],
        resortCostAdjustments: costAdjustmentsByDoc.get(row.id) ?? [],
      });
      // documents-table считает net = surplus_sum − shortfall_sum; недостачу
      // храним положительным модулем (managementShortfallSum ≤ 0).
      row.shortfall_sum = Math.abs(totals.managementShortfallSum);
      row.surplus_sum = totals.managementSurplusSum;
    }
  }

  return { rows, total, page, pageSize, error: null };
}
