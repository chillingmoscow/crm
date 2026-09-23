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
  applyResortItemSnapshot,
  applyResortSnapshot,
  isInventoryResultFrozen,
  resultLineTotals,
} from "@/lib/inventory/results-snapshot";
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
  RECOUNT_FILTERS,
  RECOUNT_FILTER_LABEL,
  isDefaultSort,
  isRecountFilter,
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
    const { data, error } = await input.admin
      .from(input.table)
      .select(input.columns)
      .in("document_id", input.documentIds)
      .order("id")
      .range(from, from + PAGE - 1);
    // Ошибку страницы раньше проглатывали: data приходил пустым, цикл считал
    // это концом данных, и управленческий итог молча получался нулевым по ВСЕМ
    // актам списка. Неверные деньги на экране хуже, чем честный отказ.
    if (error) {
      throw new Error(`Не удалось прочитать ${input.table}: ${error.message}`);
    }
    const chunk = (data ?? []) as T[];
    out.push(...chunk);
    // Короткая страница — значит данные кончились: лишний запрос за заведомо
    // пустой страницей не делаем. Раньше выход был только по пустому ответу,
    // и каждая из четырёх веток дозагрузки стоила на один round-trip больше,
    // даже когда строк было меньше страницы.
    if (chunk.length < PAGE || out.length >= HARD_CAP) break;
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
    try {
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
          finalized_at: string | null;
          finalized_difference_amount: number | null;
          finalized_difference_sum: number | null;
          finalized_excluded_from_totals: boolean | null;
        }>({
          admin,
          table: "document_items",
          columns:
            "document_id, id, difference_amount, difference_sum, excluded_from_totals, finalized_at, finalized_difference_amount, finalized_difference_sum, finalized_excluded_from_totals",
          documentIds,
        }).then((data) => ({ data })),
        // Без фильтра по status: у зафиксированного акта «активность» пересорта
        // берётся из снимка (finalized_status), а не из живого статуса — иначе
        // пересорт, аннулированный после подведения итогов, задним числом
        // выпадал бы из утверждённого итога. Раз выборка перестала быть
        // «только активные», она должна добираться постранично, как соседние:
        // на 25 актах история пересортов легко перевалит за лимит ответа.
        fetchAllByDocumentIds<{
          id: string;
          document_id: string;
          status: string;
          offset_amount: number | null;
          residual_shortfall_sum: number | null;
          residual_surplus_sum: number | null;
          cost_adjustment_sum: number | null;
          finalized_at: string | null;
          finalized_status: string | null;
          finalized_offset_amount: number | null;
          finalized_residual_shortfall_sum: number | null;
          finalized_residual_surplus_sum: number | null;
          finalized_cost_adjustment_sum: number | null;
        }>({
          admin,
          table: "inventory_result_resorts",
          columns:
            "id, document_id, status, offset_amount, residual_shortfall_sum, residual_surplus_sum, cost_adjustment_sum, finalized_at, finalized_status, finalized_offset_amount, finalized_residual_shortfall_sum, finalized_residual_surplus_sum, finalized_cost_adjustment_sum",
          documentIds,
        }).then((data) => ({ data })),
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
          finalized_at: string | null;
          finalized_source_difference_amount: number | null;
          finalized_source_difference_sum: number | null;
          finalized_offset_amount: number | null;
          finalized_remaining_difference_amount: number | null;
          finalized_remaining_difference_sum: number | null;
        }>({
          admin,
          table: "inventory_result_resort_items",
          columns:
            "document_id, resort_id, document_item_id, role, source_difference_amount, source_difference_sum, offset_amount, remaining_difference_amount, remaining_difference_sum, finalized_at, finalized_source_difference_amount, finalized_source_difference_sum, finalized_offset_amount, finalized_remaining_difference_amount, finalized_remaining_difference_sum",
          documentIds,
        }).then((data) => ({ data })),
        admin
          .from<Array<{
            id: string;
            results_reopened_after_processed: boolean | null;
            recount_of_document_id: string | null;
            qr_shortfall_sum: number | null;
            qr_surplus_sum: number | null;
            status: string;
            results_finalized_at: string | null;
            results_reopened_at: string | null;
            results_snapshot_at: string | null;
          }>>("documents")
          .select(
            "id, results_reopened_after_processed, recount_of_document_id, qr_shortfall_sum, qr_surplus_sum, status, results_finalized_at, results_reopened_at, results_snapshot_at",
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
      // Дата фиксации итогов — чтобы список не предлагал удалить акт, который
      // серверный экшен удалить не даст (снимок переживает распроведение).
      const snapshotAtByDoc = new Map(
        (docFlagRows ?? []).map((row) => [row.id, row.results_snapshot_at]),
      );
      // Акты, по которым показываем СНИМОК итогов, а не живые значения: итоги
      // залочены и снимок снят (миграции 221/227). Для них и строки, и пересорты,
      // и исключения берутся из зафиксированного состояния — иначе в одном итоге
      // сходятся замороженные строки и живые пересорты, то есть две разные даты.
      const frozenDocIds = new Set(
        (docFlagRows ?? [])
          .filter((doc) => isInventoryResultFrozen(doc))
          .map((doc) => doc.id),
      );

      const resorts = (resortRows ?? []).map((resort) =>
        applyResortSnapshot(resort, frozenDocIds.has(resort.document_id)),
      );
      const activeResortIds = new Set(
        resorts.filter((resort) => resort.status === "active").map((resort) => resort.id),
      );

      const itemsByDoc = new Map<string, InventoryResultCalculationItem[]>();
      for (const item of itemRows ?? []) {
        const list = itemsByDoc.get(item.document_id) ?? [];
        const totals = resultLineTotals(item, frozenDocIds.has(item.document_id));
        list.push({
          id: item.id,
          differenceAmount: totals.differenceAmount,
          differenceSum: totals.differenceSum,
          excluded: totals.excluded,
        });
        itemsByDoc.set(item.document_id, list);
      }

      const resortItemsByDoc = new Map<string, InventoryResortAllocationItem[]>();
      for (const rawResortItem of resortItemRows ?? []) {
        // Только активные пересорты (voided не учитываем).
        if (!activeResortIds.has(rawResortItem.resort_id)) continue;
        const resortItem = applyResortItemSnapshot(
          rawResortItem,
          frozenDocIds.has(rawResortItem.document_id),
        );
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
      for (const resort of resorts) {
        if (resort.status !== "active") continue;
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
        row.results_snapshot_at = snapshotAtByDoc.get(row.id) ?? null;
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
    } catch (totalsError) {
      // Итоги посчитать не удалось. Показываем список, но НЕ подставляем
      // нули: в колонке «Итоги» будет прочерк, а не выдуманная сумма.
      console.error("[listInventoryDocuments] управленческие итоги не посчитаны", totalsError);
      for (const row of rows) row.totals_unavailable = true;
    }
  }

  return { rows, total, page, pageSize, error: null };
}
