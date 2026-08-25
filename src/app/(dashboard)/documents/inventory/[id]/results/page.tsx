import { notFound, redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { getActiveAccountAmountRoundingScale } from "@/lib/settings/account";
import {
  buildHistorySuggestions,
  eventPayload,
} from "@/lib/inventory/resort-suggestions";
import { isInventoryResultLocked } from "@/lib/inventory/act-status";
import {
  applyResultSnapshot,
  type InventoryResultSnapshotAmounts,
} from "@/lib/inventory/results-snapshot";
import {
  InventoryResultsTable,
  type InventoryDocumentResultItem,
  type InventoryResultEventRow,
  type InventoryResultResortItemRow,
  type InventoryResultResortRow,
  type InventoryResortSuggestion,
} from "./_components/results-table";

type InventoryDocumentResultRow = {
  id: string;
  account_id: string;
  document_number: string;
  assigned_to: string | null;
  results_has_line_amounts: boolean;
  shortfall_sum: number | null;
  surplus_sum: number | null;
  status: string;
  store_id: string | null;
  external_store_id: string | null;
  results_finalized_at: string | null;
  results_reopened_at: string | null;
  results_snapshot_at: string | null;
  archived_at: string | null;
};

type ProductGroupLookupRow = {
  id: string;
  group_id: string | null;
};

type GroupLookupRow = {
  id: string;
  name: string;
};

type AccountSettingsRow = {
  inventory_ai_suggestions_enabled: boolean | null;
};

type ExclusionRuleRow = {
  id: string;
  ingredient_id: string | null;
  external_product_id: string | null;
  reason: string | null;
};

type HistoryResortRow = {
  id: string;
  document_id: string;
  reason: string;
  created_at: string;
};

type HistoryResortItemRow = {
  resort_id: string;
  ingredient_id: string | null;
  document_item_id: string;
  role: "shortage" | "surplus";
  product_name: string;
};

export default async function InventoryDocumentResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const admin = asLooseDb(createAdminClient());

  const [
    { data: accountId },
    { data: canViewResults },
    { data: canViewDocuments },
    { data: canCommentResults },
    { data: canAdjustResults },
    { data: canFinalizeResults },
    { data: canRecountDocuments },
    { data: canUseAiSuggestions },
    { data: canViewProducts },
    { data: canFillAssigned },
    {
      data: { user },
    },
    amountRoundingScale,
  ] = await Promise.all([
    supabase.rpc("get_active_account_id"),
    supabase.rpc("has_permission", { permission_code: "inventory.view_results" }),
    supabase.rpc("has_permission", { permission_code: "inventory.view_documents" }),
    supabase.rpc("has_permission", { permission_code: "inventory.comment_results" }),
    supabase.rpc("has_permission", { permission_code: "inventory.adjust_results" }),
    supabase.rpc("has_permission", { permission_code: "inventory.finalize_results" }),
    supabase.rpc("has_permission", { permission_code: "inventory.recount_documents" }),
    supabase.rpc("has_permission", { permission_code: "inventory.use_ai_suggestions" }),
    supabase.rpc("has_permission", { permission_code: "inventory.view_products" }),
    supabase.rpc("has_permission", { permission_code: "inventory.fill_assigned_documents" }),
    supabase.auth.getUser(),
    getActiveAccountAmountRoundingScale(),
  ]);

  if (!user) redirect("/login");
  if (!accountId) redirect("/dashboard");

  const { data: document } = await admin
    .from<InventoryDocumentResultRow>("documents")
    .select("id, account_id, document_number, assigned_to, results_has_line_amounts, shortfall_sum, surplus_sum, status, store_id, external_store_id, results_finalized_at, results_reopened_at, results_snapshot_at, archived_at")
    .eq("id", id)
    .eq("account_id", accountId)
    .maybeSingle();

  if (!document) notFound();
  // Акт удалён в Quick Resto (авто-архив) — закрываем прямой доступ по URL.
  if (document.archived_at) redirect("/documents/inventory");

  const isAssignedExecutor = document.assigned_to === user.id;
  // Итоги видит: держатель права `inventory.view_results` ИЛИ назначенный
  // ИСПОЛНИТЕЛЬ (с правом заполнения) — но ТОЛЬКО после проведения акта. В
  // процессе заполнения линейному сотруднику итоги недоступны (анти-подгонка).
  // canFill в исключении обязателен: иначе assignee лишь с view_documents (без
  // view_results/fill) обошёл бы границу view_results по прямому URL (Codex P1).
  // Все действия по итогам требуют отдельных прав (adjust/comment/finalize),
  // которых у исполнителя нет → страница для него read-only.
  const isProcessedExecutor =
    isAssignedExecutor && Boolean(canFillAssigned) && document.status === "processed";
  const canSeeResults = Boolean(canViewResults) || isProcessedExecutor;
  if (!canSeeResults) redirect("/documents/inventory");
  if (!canViewDocuments && !isAssignedExecutor) redirect("/documents/inventory");

  // Залочен: финализирован ИЛИ проведён в QR и не разблокирован.
  const isLocked = isInventoryResultLocked(document);
  // Пока итоги залочены — показываем снимок, снятый при подведении итогов
  // (миграция 221). «Расчёт» и «Разница» приходят из Quick Resto и там
  // пересчитываются по движениям товара: без снимка утверждённые числа уехали
  // бы вслед за QR. После переоткрытия итогов снова показываем живые значения —
  // проверяющий сознательно вернулся к правке.
  const resultsFrozen = isLocked && Boolean(document.results_snapshot_at);

  const { data: itemsRaw } = await admin
    .from<Array<InventoryDocumentResultItem & InventoryResultSnapshotAmounts>>("document_items")
    .select("id, ingredient_id, external_product_id, product_name, article, measure_unit_id, measure_unit_name, actual_amount, calculated_amount, difference_amount, prime_cost, difference_sum, finalized_actual_amount, finalized_calculated_amount, finalized_difference_amount, finalized_difference_sum, finalized_prime_cost, excluded_from_totals, exclude_reason, result_comment, needs_recount, recount_auto_flagged, recount_note, recount_previous_amount")
    .eq("account_id", accountId)
    .eq("document_id", document.id)
    .order("product_name");

  const itemsBase = itemsRaw ?? [];
  const productIds = itemsBase
    .map((item) => item.ingredient_id)
    .filter((productId): productId is string => Boolean(productId));
  const { data: products } = productIds.length > 0
    ? await admin
        .from<ProductGroupLookupRow[]>("ingredients")
        .select("id, group_id")
        .eq("account_id", accountId)
        .in("id", productIds)
    : { data: [] };
  const productGroupById = new Map((products ?? []).map((product) => [product.id, product.group_id]));
  const groupIds = Array.from(
    new Set((products ?? []).map((product) => product.group_id).filter((groupId): groupId is string => Boolean(groupId)))
  );
  const { data: groups } = groupIds.length > 0
    ? await admin
        .from<GroupLookupRow[]>("ingredient_groups")
        .select("id, name")
        .eq("account_id", accountId)
        .in("id", groupIds)
    : { data: [] };
  const groupById = new Map((groups ?? []).map((group) => [group.id, group.name]));
  const items = itemsBase.map((item) => {
    const groupId = item.ingredient_id ? productGroupById.get(item.ingredient_id) ?? null : null;
    return applyResultSnapshot(
      {
        ...item,
        group_id: groupId,
        group_name: groupId ? groupById.get(groupId) ?? null : null,
      },
      resultsFrozen,
    );
  });

  const [{ data: resortsRaw }, { data: resortItemsRaw }, { data: eventsRaw }, { data: exclusionRulesRaw }, { data: accountSettings }] = await Promise.all([
    admin
      .from<InventoryResultResortRow[]>("inventory_result_resorts")
      .select("id, status, reason, group_name, offset_amount, residual_shortfall_sum, residual_surplus_sum, cost_adjustment_sum, suggestion_source, created_at, void_reason")
      .eq("account_id", accountId)
      .eq("document_id", document.id)
      .order("created_at", { ascending: false }),
    admin
      .from<Array<{
        id: string;
        resort_id: string;
        document_item_id: string;
        role: "shortage" | "surplus";
        source_difference_amount: number | null;
        source_difference_sum: number | null;
        offset_amount: number | null;
        remaining_difference_amount: number | null;
        remaining_difference_sum: number | null;
      }>>("inventory_result_resort_items")
      .select("id, resort_id, document_item_id, role, source_difference_amount, source_difference_sum, offset_amount, remaining_difference_amount, remaining_difference_sum")
      .eq("account_id", accountId)
      .eq("document_id", document.id),
    admin
      .from<InventoryResultEventRow[]>("inventory_result_events")
      .select("id, event_type, message, created_at, created_by, payload")
      .eq("account_id", accountId)
      .eq("document_id", document.id)
      .order("created_at", { ascending: false }),
    admin
      .from<ExclusionRuleRow[]>("inventory_result_exclusion_rules")
      .select("id, ingredient_id, external_product_id, reason")
      .eq("account_id", accountId)
      .eq("status", "active"),
    admin
      .from<AccountSettingsRow>("accounts")
      .select("inventory_ai_suggestions_enabled")
      .eq("id", accountId)
      .maybeSingle(),
  ]);
  const resorts = resortsRaw ?? [];
  const exclusionRuleByProductId = new Map(
    (exclusionRulesRaw ?? [])
      .filter((rule) => rule.ingredient_id)
      .map((rule) => [rule.ingredient_id as string, rule]),
  );
  const exclusionRuleByExternalProductId = new Map(
    (exclusionRulesRaw ?? [])
      .filter((rule) => rule.external_product_id)
      .map((rule) => [rule.external_product_id as string, rule]),
  );
  const itemsWithRules = items.map((item) => {
    const rule =
      (item.ingredient_id ? exclusionRuleByProductId.get(item.ingredient_id) : null) ??
      (item.external_product_id ? exclusionRuleByExternalProductId.get(item.external_product_id) : null);
    return {
      ...item,
      exclusion_rule_id: rule?.id ?? null,
      exclusion_rule_reason: rule?.reason ?? null,
    };
  });
  const activeResortIds = new Set(resorts.filter((resort) => resort.status === "active").map((resort) => resort.id));
  const resortItems = (resortItemsRaw ?? []).map((item): InventoryResultResortItemRow => ({
    id: item.id,
    resortId: item.resort_id,
    documentItemId: item.document_item_id,
    role: item.role,
    sourceDifferenceAmount: Number(item.source_difference_amount ?? 0),
    sourceDifferenceSum: Number(item.source_difference_sum ?? 0),
    offsetAmount: Number(item.offset_amount ?? 0),
    remainingDifferenceAmount: Number(item.remaining_difference_amount ?? 0),
    remainingDifferenceSum: Number(item.remaining_difference_sum ?? 0),
  }));
  const activeResortItemIds = new Set(
    resortItems
      .filter((item) => activeResortIds.has(item.resortId))
      .map((item) => item.documentItemId),
  );
  // events нужны только для dismissedSuggestionKeys (журнал переехал в
  // layout-табу «Журнал» — ../history).
  const events = eventsRaw ?? [];
  const aiSuggestionsEnabled = Boolean(accountSettings?.inventory_ai_suggestions_enabled && canUseAiSuggestions);
  const dismissedSuggestionKeys = new Set(
    events
      .filter((event) => event.event_type === "suggestion_dismissed")
      .map((event) => eventPayload(event.payload).key)
      .filter((key): key is string => typeof key === "string" && key.length > 0),
  );
  // Подсказки пересорта имеют смысл только пока итоги можно менять (создать
  // пересорт). Для залоченного / проведённого / отправленного на пересчёт
  // акта пропускаем history-запросы И сетевой AI-вызов — это убирает
  // блокирующий DeepSeek-запрос из рендера read-only страницы итогов.
  const suggestionsEnabled =
    Boolean(canAdjustResults) && !isLocked && document.status !== "recount_pending";

  let suggestions: InventoryResortSuggestion[] = [];
  if (suggestionsEnabled) {
    const { data: historyResortsRaw } = await admin
      .from<HistoryResortRow[]>("inventory_result_resorts")
      .select("id, document_id, reason, created_at")
      .eq("account_id", accountId)
      .eq("status", "active")
      .order("created_at", { ascending: false });
    const historyResorts = (historyResortsRaw ?? []).filter((resort) => resort.document_id !== document.id).slice(0, 100);
    const { data: historyItemsRaw } = historyResorts.length > 0
      ? await admin
          .from<HistoryResortItemRow[]>("inventory_result_resort_items")
          .select("resort_id, ingredient_id, document_item_id, role, product_name")
          .eq("account_id", accountId)
          .in("resort_id", historyResorts.map((resort) => resort.id))
      : { data: [] };
    const historySuggestions = buildHistorySuggestions({
      currentItems: itemsWithRules,
      activeResortItemIds,
      historyResorts,
      historyItems: historyItemsRaw ?? [],
    }).filter((suggestion) => !dismissedSuggestionKeys.has(suggestion.key));
    // ИИ-подсказки больше не считаем на рендере (блокировали открытие акта) —
    // они грузятся по кнопке на «Итогах» (getAiResortSuggestions). Здесь только
    // дешёвые history-подсказки из прошлых пересортов.
    suggestions = historySuggestions
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 5);
  }

  return (
    <div className="w-full space-y-6 px-4 py-6 md:p-8">
      {/* Шапка (back/табы/номер/статус/склад/позиции) — в shared layout.
          «Обновить итоги из QR» переехала в тулбар таблицы итогов
          (results-table → TableControls.secondaryActions). */}
      {!document.results_has_line_amounts ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="mb-2 flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            Построчные итоги не подтверждены
          </div>
          <p>
            Quick Resto API для этого акта не вернул расчетные поля по строкам. По плану v1 мы не считаем недостачу и излишек сами,
            пока реальный payload QR не подтвердит точные поля расчета.
          </p>
        </div>
      ) : (
        <InventoryResultsTable
          documentId={document.id}
          items={itemsWithRules}
          resorts={resorts}
          resortItems={resortItems}
          suggestions={suggestions}
          amountRoundingScale={amountRoundingScale}
          isFinalized={Boolean(document.results_finalized_at)}
          resultsSnapshotAt={resultsFrozen ? document.results_snapshot_at : null}
          // Processed-акт read-only до явной разблокировки (в журнал).
          isLocked={isLocked}
          canComment={Boolean(canCommentResults)}
          canAdjust={Boolean(canAdjustResults)}
          canFinalize={Boolean(canFinalizeResults)}
          canRecount={Boolean(canRecountDocuments)}
          canRefreshResults={Boolean(canViewResults)}
          canViewProducts={Boolean(canViewProducts)}
          aiSuggestionsEnabled={aiSuggestionsEnabled}
          documentStatus={document.status}
        />
      )}
    </div>
  );
}
