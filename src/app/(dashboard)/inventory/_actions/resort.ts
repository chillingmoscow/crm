"use server";

// Пересорт: создание, аннулирование, подсказки.

import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import {
  calculateResortAllocation,
  type InventoryResortAllocationItem
} from "@/lib/inventory/results";
import {
  RESORT_STATUS,
  actionErrorMessage,
  getActiveContext,
  getActiveResortItemIds,
  getResultDocumentForAction,
  loadResultItemsForAdjustment,
  normalizeReason,
  num,
  resolveResultItemGroup,
  resultItemMeasureKey,
  revalidateInventoryResultPages,
  text,
  writeInventoryResultEvent
} from "../actions-shared";
import {
  buildAiSuggestions,
  type AiSuggestionSourceItem
} from "@/lib/inventory/resort-ai-suggestions";
import { ResortSuggestion } from "@/lib/inventory/resort-suggestions";

export async function createInventoryResultResort(input: {
  documentId: string;
  itemIds: string[];
  reason?: string;
  suggestionSource?: "manual" | "history" | "ai";
  suggestionConfidence?: number | null;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext(["inventory.view_results", "inventory.adjust_results"]);
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  try {
    await getResultDocumentForAction({
      admin,
      supabase: ctx.supabase,
      accountId: ctx.accountId,
      documentId: input.documentId,
      requireOpen: true,
    });
    const reason = text(input.reason) ?? "Ручной пересорт";
    const itemIds = Array.from(new Set(input.itemIds));
    const items = await loadResultItemsForAdjustment({
      admin,
      accountId: ctx.accountId,
      documentId: input.documentId,
      itemIds,
    });
    if (items.some((item) => item.excluded_from_totals)) {
      throw new Error("Исключенные строки нельзя добавить в пересорт.");
    }

    const activeResortItemIds = await getActiveResortItemIds({
      admin,
      accountId: ctx.accountId,
      documentId: input.documentId,
      itemIds,
    });
    if (activeResortItemIds.size > 0) {
      throw new Error("Одна или несколько строк уже участвуют в активном пересорте.");
    }

    const group = await resolveResultItemGroup({
      admin,
      accountId: ctx.accountId,
      items,
    });
    const measureUnitKeys = new Set(items.map(resultItemMeasureKey));
    if (measureUnitKeys.size !== 1) {
      throw new Error("Для пересорта можно выбрать позиции только одной единицы измерения");
    }
    const measureUnitKey = Array.from(measureUnitKeys)[0];

    const allocation = calculateResortAllocation(
      items.map((item) => ({
        id: item.id,
        groupId: group.id,
        measureUnitKey,
        differenceAmount: num(item.difference_amount),
        differenceSum: num(item.difference_sum),
      })),
    );
    const itemById = new Map(items.map((item) => [item.id, item]));

    const { data: resort, error: resortError } = await admin
      .from<{ id: string }>("inventory_result_resorts")
      .insert({
        account_id: ctx.accountId,
        document_id: input.documentId,
        group_id: group.id,
        group_name: group.name,
        measure_unit_key: measureUnitKey,
        reason,
        offset_amount: allocation.offsetAmount,
        residual_shortfall_sum: allocation.residualShortfallSum,
        residual_surplus_sum: allocation.residualSurplusSum,
        // Корректировка себестоимости (миграция 205): если недостача
        // дороже излишка — управленческий убыток на разнице цен. См.
        // docs/handbook/inventory/resort.md.
        cost_adjustment_sum: allocation.costAdjustmentSum,
        created_by: ctx.user.id,
      })
      .select("id")
      .single();
    if (resortError || !resort?.id) throw new Error(resortError?.message ?? "Не удалось создать пересорт");

    const resortRows = allocation.items.map((allocationItem: InventoryResortAllocationItem) => {
      const item = itemById.get(allocationItem.id);
      if (!item) throw new Error("Строка пересорта не найдена");
      return {
        account_id: ctx.accountId,
        resort_id: resort.id,
        document_id: input.documentId,
        document_item_id: item.id,
        ingredient_id: item.ingredient_id,
        external_product_id: item.external_product_id,
        product_name: item.product_name,
        role: allocationItem.role,
        source_difference_amount: allocationItem.sourceDifferenceAmount,
        source_difference_sum: allocationItem.sourceDifferenceSum,
        offset_amount: allocationItem.offsetAmount,
        remaining_difference_amount: allocationItem.remainingDifferenceAmount,
        remaining_difference_sum: allocationItem.remainingDifferenceSum,
      };
    });
    const { error: itemsError } = await admin.from("inventory_result_resort_items").insert(resortRows);
    if (itemsError) {
      // Компенсация: откатываем шапку пересорта. В supabase-js нет вложенной
      // транзакции, поэтому при сбое вставки строк иначе остался бы активный
      // пересорт без строк (битый итог). Полная атомарность через RPC —
      // см. backlog B7 в плане ревью.
      await admin
        .from("inventory_result_resorts")
        .delete()
        .eq("id", resort.id)
        .eq("account_id", ctx.accountId);
      throw new Error(itemsError.message);
    }

    // Пересорт снимает отметку «на пересчёт» с вошедших строк: если позицию
    // свели в пересорт, перепроверять её отдельным пересчётом уже не нужно.
    // Зеркалит cleanup recount-флагов в submitInventoryDocumentDraft.
    await admin
      .from("document_items")
      .update({
        needs_recount: false,
        recount_auto_flagged: false,
        recount_marked_by: null,
        recount_marked_at: null,
        recount_note: null,
      })
      .eq("document_id", input.documentId)
      .eq("account_id", ctx.accountId)
      .in("id", itemIds);

    const shortfallItems = resortRows.filter((row) => row.role === "shortage");
    const surplusItems = resortRows.filter((row) => row.role === "surplus");
    const describeResortItem = (row: (typeof resortRows)[number]) =>
      `${row.product_name} (${row.source_difference_amount > 0 ? "+" : ""}${row.source_difference_amount})`;
    const shortfallText = shortfallItems.map(describeResortItem).join(", ");
    const surplusText = surplusItems.map(describeResortItem).join(", ");
    const resortMessage =
      surplusText && shortfallText
        ? `Пересорт: ${surplusText} зачтено на ${shortfallText}`
        : `Создан пересорт: ${items.map((item) => item.product_name).join(", ")}`;

    await writeInventoryResultEvent({
      supabase: ctx.supabase,
      admin,
      accountId: ctx.accountId,
      userId: ctx.user.id,
      documentId: input.documentId,
      resortId: resort.id,
      eventType: "resort_created",
      message: resortMessage,
      payload: {
        resortId: resort.id,
        itemIds,
        reason,
        source: input.suggestionSource ?? "manual",
        offsetAmount: allocation.offsetAmount,
        residualShortfallSum: allocation.residualShortfallSum,
        residualSurplusSum: allocation.residualSurplusSum,
        items: resortRows.map((row) => ({
          documentItemId: row.document_item_id,
          productName: row.product_name,
          role: row.role,
          sourceDifferenceAmount: row.source_difference_amount,
          sourceDifferenceSum: row.source_difference_sum,
          offsetAmount: row.offset_amount,
          remainingDifferenceAmount: row.remaining_difference_amount,
          remainingDifferenceSum: row.remaining_difference_sum,
        })),
      },
    });

    if (input.suggestionSource && input.suggestionSource !== "manual") {
      await writeInventoryResultEvent({
        supabase: ctx.supabase,
        admin,
        accountId: ctx.accountId,
        userId: ctx.user.id,
        documentId: input.documentId,
        resortId: resort.id,
        eventType: "suggestion_applied",
        message: `Принята подсказка пересорта (${input.suggestionSource === "ai" ? "AI" : "история"})`,
        payload: {
          resortId: resort.id,
          itemIds,
          source: input.suggestionSource,
          confidence: typeof input.suggestionConfidence === "number" ? input.suggestionConfidence : null,
          reason,
        },
      });
    }

    revalidateInventoryResultPages(input.documentId);
    return { error: null };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось создать пересорт") };
  }
}

export async function voidInventoryResultResort(input: {
  documentId: string;
  resortId: string;
  reason: string;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext(["inventory.view_results", "inventory.adjust_results"]);
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  try {
    await getResultDocumentForAction({
      admin,
      supabase: ctx.supabase,
      accountId: ctx.accountId,
      documentId: input.documentId,
      requireOpen: true,
    });
    const reason = normalizeReason(input.reason, "Укажите причину отмены пересорта");
    const { data: resort } = await admin
      .from<{ id: string; status: string }>("inventory_result_resorts")
      .select("id, status")
      .eq("id", input.resortId)
      .eq("document_id", input.documentId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!resort?.id) throw new Error("Пересорт не найден");
    if (resort.status !== RESORT_STATUS.active) throw new Error("Пересорт уже отменен");

    const { error } = await admin
      .from("inventory_result_resorts")
      .update({
        status: RESORT_STATUS.voided,
        voided_by: ctx.user.id,
        voided_at: new Date().toISOString(),
        void_reason: reason,
      })
      .eq("id", resort.id)
      .eq("account_id", ctx.accountId);
    if (error) throw new Error(error.message);

    await writeInventoryResultEvent({
      supabase: ctx.supabase,
      admin,
      accountId: ctx.accountId,
      userId: ctx.user.id,
      documentId: input.documentId,
      resortId: resort.id,
      eventType: "resort_voided",
      message: "Пересорт отменен",
      payload: { resortId: resort.id, reason },
    });

    revalidateInventoryResultPages(input.documentId);
    return { error: null };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось отменить пересорт") };
  }
}

export async function dismissInventoryResortSuggestion(input: {
  documentId: string;
  key: string;
  itemIds: string[];
  source: "history" | "ai";
  confidence: number | null;
  reason: string;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext(["inventory.view_results", "inventory.adjust_results"]);
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  try {
    await getResultDocumentForAction({
      admin,
      supabase: ctx.supabase,
      accountId: ctx.accountId,
      documentId: input.documentId,
      requireOpen: true,
    });
    await writeInventoryResultEvent({
      supabase: ctx.supabase,
      admin,
      accountId: ctx.accountId,
      userId: ctx.user.id,
      documentId: input.documentId,
      eventType: "suggestion_dismissed",
      message: `Подсказка пересорта отклонена: ${input.reason}`,
      payload: {
        key: input.key,
        itemIds: input.itemIds,
        source: input.source,
        confidence: input.confidence,
        reason: input.reason,
      },
    });

    revalidateInventoryResultPages(input.documentId);
    return { error: null };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось скрыть подсказку") };
  }
}

/**
 * AI-подсказки пересорта «по запросу» (кнопка на «Итогах»). Раньше DeepSeek
 * вызывался синхронно при рендере и тормозил открытие акта — теперь только по
 * клику. История-подсказки остаются на серверном рендере (дёшево).
 * Гейт: adjust_results + lock-гард + право use_ai_suggestions + флаг аккаунта.
 */
export async function getAiResortSuggestions(input: {
  documentId: string;
}): Promise<{ suggestions: ResortSuggestion[]; error: string | null }> {
  const ctx = await getActiveContext(["inventory.view_results", "inventory.adjust_results"]);
  if (ctx.error || !ctx.user || !ctx.accountId) return { suggestions: [], error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  try {
    await getResultDocumentForAction({
      admin,
      supabase: ctx.supabase,
      accountId: ctx.accountId,
      documentId: input.documentId,
      requireOpen: true,
    });

    const { data: canUseAi } = await ctx.supabase.rpc("has_permission", {
      permission_code: "inventory.use_ai_suggestions",
    });
    const { data: account } = await admin
      .from<{ inventory_ai_suggestions_enabled: boolean | null }>("accounts")
      .select("inventory_ai_suggestions_enabled")
      .eq("id", ctx.accountId)
      .maybeSingle();
    if (!canUseAi || !account?.inventory_ai_suggestions_enabled) {
      return { suggestions: [], error: null };
    }

    const { data: itemsRaw } = await admin
      .from<
        Array<{
          id: string;
          ingredient_id: string | null;
          product_name: string;
          measure_unit_id: number | null;
          measure_unit_name: string | null;
          difference_amount: number | null;
          difference_sum: number | null;
          excluded_from_totals: boolean | null;
        }>
      >("document_items")
      .select(
        "id, ingredient_id, product_name, measure_unit_id, measure_unit_name, difference_amount, difference_sum, excluded_from_totals",
      )
      .eq("account_id", ctx.accountId)
      .eq("document_id", input.documentId);
    const items = itemsRaw ?? [];

    const ingredientIds = items.map((item) => item.ingredient_id).filter((id): id is string => Boolean(id));
    const { data: products } = ingredientIds.length > 0
      ? await admin
          .from<Array<{ id: string; group_id: string | null }>>("ingredients")
          .select("id, group_id")
          .eq("account_id", ctx.accountId)
          .in("id", ingredientIds)
      : { data: [] };
    const groupByProductId = new Map((products ?? []).map((product) => [product.id, product.group_id]));
    const groupIds = Array.from(
      new Set((products ?? []).map((product) => product.group_id).filter((id): id is string => Boolean(id))),
    );
    const { data: groups } = groupIds.length > 0
      ? await admin
          .from<Array<{ id: string; name: string }>>("ingredient_groups")
          .select("id, name")
          .eq("account_id", ctx.accountId)
          .in("id", groupIds)
      : { data: [] };
    const groupNameById = new Map((groups ?? []).map((group) => [group.id, group.name]));

    const currentItems: AiSuggestionSourceItem[] = items.map((item) => {
      const groupId = item.ingredient_id ? groupByProductId.get(item.ingredient_id) ?? null : null;
      return {
        id: item.id,
        product_name: item.product_name,
        group_id: groupId,
        group_name: groupId ? groupNameById.get(groupId) ?? null : null,
        measure_unit_id: item.measure_unit_id,
        measure_unit_name: item.measure_unit_name,
        difference_amount: item.difference_amount,
        difference_sum: item.difference_sum,
        excluded_from_totals: item.excluded_from_totals,
      };
    });

    const activeResortItemIds = await getActiveResortItemIds({
      admin,
      accountId: ctx.accountId,
      documentId: input.documentId,
    });

    const { data: events } = await admin
      .from<Array<{ payload: Record<string, unknown> | null }>>("inventory_result_events")
      .select("payload")
      .eq("account_id", ctx.accountId)
      .eq("document_id", input.documentId)
      .eq("event_type", "suggestion_dismissed");
    const dismissed = new Set(
      (events ?? [])
        .map((event) => (event.payload && typeof event.payload === "object" ? event.payload.key : null))
        .filter((key): key is string => typeof key === "string" && key.length > 0),
    );

    const suggestions = (
      await buildAiSuggestions({ enabled: true, currentItems, activeResortItemIds })
    ).filter((suggestion) => !dismissed.has(suggestion.key));

    return { suggestions, error: null };
  } catch (error) {
    return { suggestions: [], error: actionErrorMessage(error, "Не удалось получить подсказки ИИ") };
  }
}
