import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft } from "lucide-react";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { getDeepseekClient, DEEPSEEK_MODELS } from "@/lib/ai/deepseek-client";
import { getActiveAccountAmountRoundingScale } from "@/lib/settings/account";
import { Button } from "@/components/ui/button";
import { RefreshResultsButton } from "./_components/refresh-results-button";
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
};

type InventoryStoreTitleRow = {
  id: string;
  title: string;
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

type EventActorRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
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

function resortSuggestionKey(itemIds: string[]) {
  return Array.from(new Set(itemIds)).sort().join(":");
}

function clampConfidence(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0.1, Math.min(0.95, value));
}

function eventPayload(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function buildHistorySuggestions(input: {
  currentItems: InventoryDocumentResultItem[];
  activeResortItemIds: Set<string>;
  historyResorts: HistoryResortRow[];
  historyItems: HistoryResortItemRow[];
}) {
  const currentByLocalProductId = new Map<string, InventoryDocumentResultItem>();
  for (const item of input.currentItems) {
    const productId = item.ingredient_id;
    const amount = Number(item.difference_amount ?? 0);
    if (!productId || amount === 0 || item.excluded_from_totals || input.activeResortItemIds.has(item.id)) continue;
    currentByLocalProductId.set(productId, item);
  }

  const resortById = new Map(input.historyResorts.map((resort) => [resort.id, resort]));
  const itemsByResortId = new Map<string, HistoryResortItemRow[]>();
  for (const item of input.historyItems) {
    const rows = itemsByResortId.get(item.resort_id) ?? [];
    rows.push(item);
    itemsByResortId.set(item.resort_id, rows);
  }

  const suggestions = new Map<string, InventoryResortSuggestion & { hits: number }>();
  for (const [resortId, historyItems] of itemsByResortId) {
    const matched = historyItems
      .map((historyItem) => historyItem.ingredient_id ? currentByLocalProductId.get(historyItem.ingredient_id) ?? null : null)
      .filter((item): item is InventoryDocumentResultItem => Boolean(item));
    const uniqueMatched = Array.from(new Map(matched.map((item) => [item.id, item])).values());
    if (uniqueMatched.length < 2) continue;
    const hasShortage = uniqueMatched.some((item) => Number(item.difference_amount ?? 0) < 0);
    const hasSurplus = uniqueMatched.some((item) => Number(item.difference_amount ?? 0) > 0);
    if (!hasShortage || !hasSurplus) continue;

    const key = resortSuggestionKey(uniqueMatched.map((item) => item.id));
    const existing = suggestions.get(key);
    if (existing) {
      existing.hits += 1;
      existing.confidence = Math.min(0.95, existing.confidence + 0.08);
      continue;
    }
    const historyResort = resortById.get(resortId);
    suggestions.set(key, {
      key,
      itemIds: uniqueMatched.map((item) => item.id),
      title: uniqueMatched.map((item) => item.product_name).join(" + "),
      reason: historyResort?.reason
        ? `Похожий пересорт уже делали: ${historyResort.reason}`
        : "Похожий пересорт уже делали в прошлых актах",
      confidence: 0.7,
      source: "history",
      hits: 1,
    });
  }

  return Array.from(suggestions.values())
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 5)
    .map(({ key, itemIds, title, reason, confidence, source }) => ({ key, itemIds, title, reason, confidence, source }));
}

async function buildAiSuggestions(input: {
  enabled: boolean;
  currentItems: InventoryDocumentResultItem[];
  activeResortItemIds: Set<string>;
}): Promise<InventoryResortSuggestion[]> {
  if (!input.enabled || !process.env.DEEPSEEK_API_KEY) return [];

  const candidates = input.currentItems
    .filter((item) => {
      const amount = Number(item.difference_amount ?? 0);
      return amount !== 0 && !item.excluded_from_totals && !input.activeResortItemIds.has(item.id);
    })
    .map((item) => ({
      id: item.id,
      name: item.product_name,
      groupId: item.group_id,
      groupName: item.group_name,
      measureUnitId: item.measure_unit_id,
      measureUnitName: item.measure_unit_name,
      differenceAmount: Number(item.difference_amount ?? 0),
      differenceSum: Number(item.difference_sum ?? 0),
    }));

  if (candidates.length < 2) return [];
  if (!candidates.some((item) => item.differenceAmount > 0) || !candidates.some((item) => item.differenceAmount < 0)) {
    return [];
  }

  try {
    const client = getDeepseekClient();
    const response = await client.chat.completions.create({
      model: DEEPSEEK_MODELS.chat,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Ты помогаешь найти кандидатов пересорта в инвентаризации ресторана. Возвращай только JSON вида {\"suggestions\":[{\"itemIds\":[\"id\"],\"reason\":\"...\",\"confidence\":0.8}]}. Не предлагай позиции из разных групп или с разными единицами измерения. В каждой подсказке должны быть строки с плюсом и минусом.",
        },
        {
          role: "user",
          content: JSON.stringify({
            rules: {
              sameGroup: true,
              sameMeasureUnit: true,
              requiresSurplusAndShortage: true,
              maxSuggestions: 5,
            },
            items: candidates,
          }),
        },
      ],
    });

    const content = response.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(content) as { suggestions?: Array<{ itemIds?: unknown; reason?: unknown; confidence?: unknown }> };
    const byId = new Map(candidates.map((item) => [item.id, item]));
    const suggestions: InventoryResortSuggestion[] = [];
    const seen = new Set<string>();

    for (const suggestion of parsed.suggestions ?? []) {
      if (!Array.isArray(suggestion.itemIds)) continue;
      const itemIds = suggestion.itemIds
        .filter((itemId): itemId is string => typeof itemId === "string" && byId.has(itemId));
      const uniqueIds = Array.from(new Set(itemIds));
      if (uniqueIds.length < 2) continue;

      const rows = uniqueIds.map((itemId) => byId.get(itemId)).filter((item): item is NonNullable<typeof item> => Boolean(item));
      if (!rows.some((item) => item.differenceAmount > 0) || !rows.some((item) => item.differenceAmount < 0)) continue;
      if (new Set(rows.map((item) => item.groupId ?? item.groupName ?? "ungrouped")).size !== 1) continue;
      if (new Set(rows.map((item) => item.measureUnitId ?? item.measureUnitName ?? "unit")).size !== 1) continue;

      const key = resortSuggestionKey(uniqueIds);
      if (seen.has(key)) continue;
      seen.add(key);

      const reason = typeof suggestion.reason === "string" && suggestion.reason.trim()
        ? suggestion.reason.trim()
        : "AI нашел похожие названия и противоположные расхождения";
      suggestions.push({
        key,
        itemIds: uniqueIds,
        title: rows.map((item) => item.name).join(" + "),
        reason,
        confidence: clampConfidence(suggestion.confidence, 0.65),
        source: "ai",
      });
    }

    return suggestions.sort((left, right) => right.confidence - left.confidence).slice(0, 5);
  } catch (error) {
    console.error("Failed to build inventory AI resort suggestions", error);
    return [];
  }
}

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
    { data: canUseAiSuggestions },
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
    supabase.rpc("has_permission", { permission_code: "inventory.use_ai_suggestions" }),
    supabase.auth.getUser(),
    getActiveAccountAmountRoundingScale(),
  ]);

  if (!user) redirect("/login");
  if (!accountId || !canViewResults) redirect("/dashboard");

  const { data: document } = await admin
    .from<InventoryDocumentResultRow>("documents")
    .select("id, account_id, document_number, assigned_to, results_has_line_amounts, shortfall_sum, surplus_sum, status, store_id, external_store_id, results_finalized_at")
    .eq("id", id)
    .eq("account_id", accountId)
    .maybeSingle();

  if (!document) notFound();
  if (!canViewDocuments && document.assigned_to !== user.id) redirect("/documents");

  const { data: store } = document.store_id
    ? await admin
        .from<InventoryStoreTitleRow>("stores")
        .select("id, title")
        .eq("id", document.store_id)
        .eq("account_id", accountId)
        .maybeSingle()
    : { data: null };

  const { data: itemsRaw } = await admin
    .from<InventoryDocumentResultItem[]>("document_items")
    .select("id, ingredient_id, external_product_id, product_name, article, measure_unit_id, measure_unit_name, actual_amount, calculated_amount, difference_amount, prime_cost, difference_sum, excluded_from_totals, exclude_reason, result_comment")
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
    return {
      ...item,
      group_id: groupId,
      group_name: groupId ? groupById.get(groupId) ?? null : null,
    };
  });

  const [{ data: resortsRaw }, { data: resortItemsRaw }, { data: eventsRaw }, { data: exclusionRulesRaw }, { data: accountSettings }] = await Promise.all([
    admin
      .from<InventoryResultResortRow[]>("inventory_result_resorts")
      .select("id, status, reason, group_name, offset_amount, residual_shortfall_sum, residual_surplus_sum, suggestion_source, created_at, void_reason")
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
  const events = eventsRaw ?? [];
  const eventActorIds = Array.from(
    new Set(events.map((event) => event.created_by).filter((actorId): actorId is string => Boolean(actorId))),
  );
  const { data: eventActorsRaw } = eventActorIds.length > 0
    ? await admin
        .from<EventActorRow[]>("profiles")
        .select("id, first_name, last_name, avatar_url")
        .in("id", eventActorIds)
    : { data: [] };
  const eventActorById = new Map((eventActorsRaw ?? []).map((actor) => [actor.id, actor]));
  const eventsWithActors = events.map((event) => ({
    ...event,
    actor: event.created_by ? eventActorById.get(event.created_by) ?? null : null,
  }));
  const aiSuggestionsEnabled = Boolean(accountSettings?.inventory_ai_suggestions_enabled && canUseAiSuggestions);
  const dismissedSuggestionKeys = new Set(
    events
      .filter((event) => event.event_type === "suggestion_dismissed")
      .map((event) => eventPayload(event.payload).key)
      .filter((key): key is string => typeof key === "string" && key.length > 0),
  );
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
  const aiSuggestions = (await buildAiSuggestions({
    enabled: aiSuggestionsEnabled,
    currentItems: itemsWithRules,
    activeResortItemIds,
  })).filter((suggestion) => !dismissedSuggestionKeys.has(suggestion.key));
  const suggestions = Array.from(
    new Map([...historySuggestions, ...aiSuggestions].map((suggestion) => [suggestion.key, suggestion])).values(),
  )
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 5);

  return (
    <div className="w-full px-4 py-4 md:px-8 md:py-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/documents/${document.id}`}>
            <ArrowLeft className="h-4 w-4" />
            <span className="ml-2">К акту</span>
          </Link>
        </Button>
        <RefreshResultsButton documentId={document.id} />
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Итоги акта № {document.document_number}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Склад: {store?.title ?? (document.external_store_id ? `QR #${document.external_store_id}` : "не указан")}
        </p>
      </div>

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
          events={eventsWithActors}
          suggestions={suggestions}
          amountRoundingScale={amountRoundingScale}
          isFinalized={Boolean(document.results_finalized_at)}
          canComment={Boolean(canCommentResults)}
          canAdjust={Boolean(canAdjustResults)}
          canFinalize={Boolean(canFinalizeResults)}
          aiSuggestionsEnabled={aiSuggestionsEnabled}
        />
      )}
    </div>
  );
}
