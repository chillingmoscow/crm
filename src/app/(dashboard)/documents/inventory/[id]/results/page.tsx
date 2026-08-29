import { notFound, redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  getCachedActiveAccountId,
  getCachedPermissions,
  getCachedUser,
} from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { getActiveAccountAmountRoundingScale } from "@/lib/settings/account";
import {
  buildHistorySuggestions,
  eventPayload,
} from "@/lib/inventory/resort-suggestions";
import { hasCountedResults, isInventoryResultLocked } from "@/lib/inventory/act-status";
import {
  applyResortItemSnapshot,
  applyResortSnapshot,
  applyResultSnapshot,
  isInventoryResultFrozen,
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
  qr_shortfall_sum: number | null;
  qr_surplus_sum: number | null;
  status: string;
  store_id: string | null;
  external_store_id: string | null;
  results_finalized_at: string | null;
  results_reopened_at: string | null;
  results_snapshot_at: string | null;
  qr_unprocessed_at: string | null;
  invoice_date: string | null;
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
  const admin = asLooseDb(createAdminClient());

  // Права берём одним списком (list_my_permissions), а не десятью отдельными
  // has_permission: RPC кэширован на весь RSC-рендер, поэтому layout и эта
  // страница делят один вызов. Раньше только на этой странице их было десять,
  // и ещё семь — в layout над ней.
  const [permissions, user, accountId, amountRoundingScale] = await Promise.all([
    getCachedPermissions(),
    getCachedUser(),
    getCachedActiveAccountId(),
    getActiveAccountAmountRoundingScale(),
  ]);
  const can = (code: string) => permissions.includes(code);
  const canViewResults = can("inventory.view_results");
  const canViewDocuments = can("inventory.view_documents");
  const canCommentResults = can("inventory.comment_results");
  const canAdjustResults = can("inventory.adjust_results");
  const canFinalizeResults = can("inventory.finalize_results");
  const canRecountDocuments = can("inventory.recount_documents");
  const canUseAiSuggestions = can("inventory.use_ai_suggestions");
  const canViewProducts = can("inventory.view_products");
  const canFillAssigned = can("inventory.fill_assigned_documents");

  if (!user) redirect("/login");
  if (!accountId) redirect("/dashboard");

  const { data: document } = await admin
    .from<InventoryDocumentResultRow>("documents")
    .select("id, account_id, document_number, assigned_to, results_has_line_amounts, qr_shortfall_sum, qr_surplus_sum, status, store_id, external_store_id, results_finalized_at, results_reopened_at, results_snapshot_at, qr_unprocessed_at, invoice_date, archived_at")
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
  const resultsFrozen = isInventoryResultFrozen(document);

  // Подсказки пересорта имеют смысл только пока итоги можно менять. Считаем
  // это ДО запросов: от флага зависит, читать ли журнал акта (см. ниже).
  const suggestionsEnabled =
    canAdjustResults && !isLocked && document.status !== "recount_pending";

  // Одна волна вместо шести последовательных: строки акта, след выноса на
  // пересчёт, пересорты, правила автоисключения и настройки аккаунта друг от
  // друга не зависят. Раньше страница выстраивала их в цепочку и ждала каждый
  // ответ по очереди.
  const [
    { data: itemsRaw },
    { data: recountMovesRaw },
    { data: resortsRaw },
    { data: resortItemsRaw },
    { data: exclusionRulesRaw },
    { data: accountSettings },
    { data: eventsRaw },
  ] = await Promise.all([
    admin
    .from<Array<InventoryDocumentResultItem & InventoryResultSnapshotAmounts>>("document_items")
    .select("id, ingredient_id, external_product_id, product_name, article, measure_unit_id, measure_unit_name, actual_amount, calculated_amount, difference_amount, prime_cost, difference_sum, finalized_at, finalized_actual_amount, finalized_calculated_amount, finalized_difference_amount, finalized_difference_sum, finalized_prime_cost, finalized_excluded_from_totals, excluded_from_totals, exclude_reason, exclusion_rule_id, result_comment, needs_recount, recount_auto_flagged, recount_note, recount_previous_amount")
    .eq("account_id", accountId)
    .eq("document_id", document.id)
    .order("product_name"),
    // Позиции, вынесенные в акты пересчёта (миграция 223): показываем плашкой,
    // чтобы было видно, куда уехали строки и по какой дате их считают.
    admin
      .from<Array<{ recount_document_id: string | null; product_name: string }>>("inventory_recount_moves")
      .select("recount_document_id, product_name")
      .eq("account_id", accountId)
      .eq("document_id", document.id),
    admin
      .from<InventoryResultResortRow[]>("inventory_result_resorts")
      .select("id, status, reason, group_name, offset_amount, residual_shortfall_sum, residual_surplus_sum, cost_adjustment_sum, suggestion_source, created_at, void_reason, finalized_at, finalized_status, finalized_offset_amount, finalized_residual_shortfall_sum, finalized_residual_surplus_sum, finalized_cost_adjustment_sum")
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
        finalized_at: string | null;
        finalized_source_difference_amount: number | null;
        finalized_source_difference_sum: number | null;
        finalized_offset_amount: number | null;
        finalized_remaining_difference_amount: number | null;
        finalized_remaining_difference_sum: number | null;
      }>>("inventory_result_resort_items")
      .select("id, resort_id, document_item_id, role, source_difference_amount, source_difference_sum, offset_amount, remaining_difference_amount, remaining_difference_sum, finalized_at, finalized_source_difference_amount, finalized_source_difference_sum, finalized_offset_amount, finalized_remaining_difference_amount, finalized_remaining_difference_sum")
      .eq("account_id", accountId)
      .eq("document_id", document.id),
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
    // Журнал акта нужен ровно для одного: списка уже скрытых подсказок. Когда
    // подсказок нет (акт залочен, проведён или на пересчёте), это была полная
    // выборка событий вместе с payload-jsonb вхолостую.
    suggestionsEnabled
      ? admin
          .from<InventoryResultEventRow[]>("inventory_result_events")
          .select("id, event_type, message, created_at, created_by, payload")
          .eq("account_id", accountId)
          .eq("document_id", document.id)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as InventoryResultEventRow[] }),
  ]);

  const itemsBase = itemsRaw ?? [];
  const productIds = itemsBase
    .map((item) => item.ingredient_id)
    .filter((productId): productId is string => Boolean(productId));
  const recountChildIds = Array.from(
    new Set((recountMovesRaw ?? []).map((row) => row.recount_document_id).filter((id): id is string => Boolean(id))),
  );
  // Вторая волна: обе выборки зависят от первой, но не друг от друга.
  const [{ data: products }, { data: recountChildrenRaw }] = await Promise.all([
    productIds.length > 0
      ? admin
          .from<ProductGroupLookupRow[]>("ingredients")
          .select("id, group_id")
          .eq("account_id", accountId)
          .in("id", productIds)
      : Promise.resolve({ data: [] as ProductGroupLookupRow[] }),
    recountChildIds.length > 0
      ? admin
          .from<Array<{ id: string; document_number: string; invoice_date: string | null; status: string }>>("documents")
          .select("id, document_number, invoice_date, status")
          .eq("account_id", accountId)
          .in("id", recountChildIds)
      : Promise.resolve({ data: [] as Array<{ id: string; document_number: string; invoice_date: string | null; status: string }> }),
  ]);
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
  const recountSplits = (recountChildrenRaw ?? []).map((child) => ({
    documentId: child.id,
    documentNumber: child.document_number,
    invoiceDate: child.invoice_date,
    status: child.status,
    itemCount: (recountMovesRaw ?? []).filter((row) => row.recount_document_id === child.id).length,
  }));
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
  // Пересорты зафиксированного акта — из снимка (миграция 227): и суммы, и
  // статус. Иначе управленческий итог смешивал бы замороженные строки с живым
  // зачётом, который пересчитывается при каждом импорте.
  const resorts = (resortsRaw ?? []).map((resort) => applyResortSnapshot(resort, resultsFrozen));
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
      // Правило, действующее на эту позицию: им гейтятся пункты меню
      // «Исключать всегда» / «Удалить автоисключение».
      exclusion_rule_id: rule?.id ?? null,
      // А это — исключена ли строка ИМЕННО правилом (миграция 231). Раньше
      // подпись «Авто» показывалась по наличию правила, поэтому висела и на
      // строке, которую проверяющий вернул в итоги вручную.
      excluded_by_rule: Boolean(item.excluded_from_totals && item.exclusion_rule_id),
      exclusion_rule_reason: rule?.reason ?? null,
    };
  });
  const activeResortIds = new Set(resorts.filter((resort) => resort.status === "active").map((resort) => resort.id));
  const resortItems = (resortItemsRaw ?? [])
    .map((item) => applyResortItemSnapshot(item, resultsFrozen))
    .map((item): InventoryResultResortItemRow => ({
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
  // suggestionsEnabled вычислен выше, до запросов: от него зависит ещё и то,
  // читаем ли журнал акта. Для залоченного / проведённого / отправленного на
  // пересчёт акта пропускаем history-запросы И сетевой AI-вызов — это убирает
  // блокирующий DeepSeek-запрос из рендера read-only страницы итогов.
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
      {!hasCountedResults(document.status) ? (
        // До сдачи акта «разница» из Quick Resto — это минус весь складской
        // остаток (факт ещё нулевой). Показывать её как итог нельзя: на проде
        // такой акт рисовал недостачу 478 193,6 ₽ до начала подсчёта.
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
          <div className="mb-2 font-medium">Подсчёт ещё не завершён</div>
          <p className="text-muted-foreground">
            Итоги появятся, когда исполнитель заполнит акт и отправит его на проверку. Пока факт не
            введён, Quick Resto считает разницу как «ноль минус расчётный остаток» — это не
            расхождение, а просто складской остаток со знаком минус.
          </p>
        </div>
      ) : !document.results_has_line_amounts ? (
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
          documentInvoiceDate={document.invoice_date}
          recountSplits={recountSplits}
          qrUnprocessedAt={document.qr_unprocessed_at}
          qrShortfallSum={document.qr_shortfall_sum}
          qrSurplusSum={document.qr_surplus_sum}
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
