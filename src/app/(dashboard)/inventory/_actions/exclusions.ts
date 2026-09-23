"use server";

// Исключения строк из управленческих итогов: разовые и правила.

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { resolveManualExclusionState } from "@/lib/inventory/exclusions";
import {
  type InventoryExclusionRuleLookup,
  type InventoryResultItemRow,
  actionErrorMessage,
  getActiveContext,
  getActiveResortItemIds,
  getResultDocumentForAction,
  loadActiveExclusionRuleMatcher,
  normalizeReason,
  revalidateInventoryResultPages,
  text,
  writeInventoryResultEvent,
  writeInventoryResultEvents
} from "../actions-shared";

export async function setInventoryResultItemExcluded(input: {
  documentId: string;
  itemId: string;
  excluded: boolean;
  reason?: string;
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
    const { data: item } = await admin
      .from<{
        id: string;
        product_name: string;
        exclusion_rule_id: string | null;
        ingredient_id: string | null;
        external_product_id: string | null;
      }>("document_items")
      .select("id, product_name, exclusion_rule_id, ingredient_id, external_product_id")
      .eq("id", input.itemId)
      .eq("document_id", input.documentId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!item?.id) throw new Error("Строка акта не найдена");

    if (input.excluded) {
      const activeResortItemIds = await getActiveResortItemIds({
        admin,
        accountId: ctx.accountId,
        documentId: input.documentId,
        itemIds: [item.id],
      });
      if (activeResortItemIds.has(item.id)) {
        throw new Error("Строка уже участвует в активном пересорте. Сначала отмените пересорт.");
      }
    }

    // Ручное решение перебивает правило и держится: «Учитывать в этом акте» на
    // строке, исключённой правилом, ставит отметку об отказе — импорт такую
    // строку правилом больше не тронет (см. resolveExclusionState).
    const reason = input.excluded ? text(input.reason) : null;
    const now = new Date().toISOString();
    // Отменяем ДЕЙСТВУЮЩЕЕ правило, а не только записанное в строке: ручное
    // исключение сбрасывает происхождение, и по одному exclusion_rule_id
    // правило было бы не найти — импорт применил бы его заново.
    let dismissRuleId = item.exclusion_rule_id;
    if (!input.excluded && !dismissRuleId) {
      const matchRule = await loadActiveExclusionRuleMatcher({ admin, accountId: ctx.accountId });
      dismissRuleId = matchRule(item)?.id ?? null;
    }
    const { error } = await admin
      .from("document_items")
      .update(
        resolveManualExclusionState({
          excluded: input.excluded,
          reason,
          userId: ctx.user.id,
          now,
          currentRuleId: dismissRuleId,
        }),
      )
      .eq("id", item.id)
      .eq("account_id", ctx.accountId);
    if (error) throw new Error(error.message);

    await writeInventoryResultEvent({
      supabase: ctx.supabase,
      admin,
      accountId: ctx.accountId,
      userId: ctx.user.id,
      documentId: input.documentId,
      documentItemId: item.id,
      eventType: input.excluded ? "exclude_enabled" : "exclude_disabled",
      message: input.excluded
        ? `Позиция «${item.product_name}» исключена из управленческих итогов`
        : `Позиция «${item.product_name}» возвращена в управленческие итоги`,
      payload: { itemId: item.id, productName: item.product_name, reason },
    });

    revalidateInventoryResultPages(input.documentId);
    return { error: null };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось изменить учет строки") };
  }
}

export async function createInventoryResultExclusionRule(input: {
  documentId: string;
  itemId: string;
  reason?: string;
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
    const { data: item } = await admin
      .from<InventoryResultItemRow>("document_items")
      .select("id, document_id, account_id, ingredient_id, external_product_id, product_name, measure_unit_id, measure_unit_name, difference_amount, difference_sum, excluded_from_totals")
      .eq("id", input.itemId)
      .eq("document_id", input.documentId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!item?.id) throw new Error("Строка акта не найдена");
    if (!item.ingredient_id && !item.external_product_id) {
      throw new Error("У строки нет QR ID продукта, автоисключение создать нельзя.");
    }

    const activeResortItemIds = await getActiveResortItemIds({
      admin,
      accountId: ctx.accountId,
      documentId: input.documentId,
      itemIds: [item.id],
    });
    if (activeResortItemIds.has(item.id)) {
      throw new Error("Строка уже участвует в активном пересорте. Сначала отмените пересорт.");
    }

    let existingRuleQuery = admin
      .from<InventoryExclusionRuleLookup>("inventory_result_exclusion_rules")
      .select("id, ingredient_id, external_product_id, reason, created_by, created_at")
      .eq("account_id", ctx.accountId)
      .eq("status", "active");
    if (item.ingredient_id) {
      existingRuleQuery = existingRuleQuery.eq("ingredient_id", item.ingredient_id);
    } else {
      existingRuleQuery = existingRuleQuery.eq("external_product_id", item.external_product_id);
    }
    const { data: existingRule } = await existingRuleQuery.maybeSingle();

    const reason = text(input.reason);
    const { data: rule, error: ruleError } = existingRule?.id
      ? { data: existingRule, error: null }
      : await admin
          .from<InventoryExclusionRuleLookup>("inventory_result_exclusion_rules")
          .insert({
            account_id: ctx.accountId,
            ingredient_id: item.ingredient_id,
            external_product_id: item.external_product_id,
            product_name: item.product_name,
            reason,
            created_by: ctx.user.id,
          })
          .select("id, ingredient_id, external_product_id, reason, created_by, created_at")
          .single();
    if (ruleError || !rule?.id) throw new Error(ruleError?.message ?? "Не удалось создать правило автоисключения");

    const now = new Date().toISOString();
    const { error: itemError } = await admin
      .from("document_items")
      .update({
        excluded_from_totals: true,
        exclude_reason: reason,
        excluded_by: ctx.user.id,
        excluded_at: now,
        exclusion_rule_id: rule.id,
        exclusion_rule_dismissed_at: null,
      })
      .eq("id", item.id)
      .eq("account_id", ctx.accountId);
    if (itemError) throw new Error(itemError.message);

    await writeInventoryResultEvent({
      supabase: ctx.supabase,
      admin,
      accountId: ctx.accountId,
      userId: ctx.user.id,
      documentId: input.documentId,
      documentItemId: item.id,
      eventType: "persistent_exclusion_enabled",
      message: `Позиция «${item.product_name}» добавлена в автоисключения`,
      payload: {
        itemId: item.id,
        productName: item.product_name,
        ruleId: rule.id,
        reason,
      },
    });

    revalidateInventoryResultPages(input.documentId);
    return { error: null };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось создать автоисключение") };
  }
}

export async function deleteInventoryResultExclusionRule(input: {
  documentId: string;
  itemId: string;
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
    const reason = normalizeReason(input.reason, "Укажите причину удаления автоисключения");
    const { data: item } = await admin
      .from<InventoryResultItemRow>("document_items")
      .select("id, document_id, account_id, ingredient_id, external_product_id, product_name, measure_unit_id, measure_unit_name, difference_amount, difference_sum, excluded_from_totals")
      .eq("id", input.itemId)
      .eq("document_id", input.documentId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!item?.id) throw new Error("Строка акта не найдена");

    let ruleQuery = admin
      .from<{ id: string }>("inventory_result_exclusion_rules")
      .select("id")
      .eq("account_id", ctx.accountId)
      .eq("status", "active");
    if (item.ingredient_id) {
      ruleQuery = ruleQuery.eq("ingredient_id", item.ingredient_id);
    } else if (item.external_product_id) {
      ruleQuery = ruleQuery.eq("external_product_id", item.external_product_id);
    } else {
      throw new Error("Автоисключение не найдено");
    }
    const { data: rule } = await ruleQuery.maybeSingle();
    if (!rule?.id) throw new Error("Автоисключение не найдено");

    const { error: ruleError } = await admin
      .from("inventory_result_exclusion_rules")
      .update({
        status: "deleted",
        deleted_by: ctx.user.id,
        deleted_at: new Date().toISOString(),
        delete_reason: reason,
      })
      .eq("id", rule.id)
      .eq("account_id", ctx.accountId);
    if (ruleError) throw new Error(ruleError.message);

    // Снимаем исключение со ВСЕХ строк, которые исключило это правило, а не
    // только в открытом акте. Раньше в остальных актах позиция оставалась
    // исключённой навсегда — и уже неотличимо от ручного решения, потому что
    // правила, которое её исключило, больше нет.
    const { data: clearedRows, error: itemError } = await admin
      .from<Array<{ id: string; document_id: string }>>("document_items")
      .update({
        excluded_from_totals: false,
        exclude_reason: null,
        excluded_by: null,
        excluded_at: null,
        exclusion_rule_id: null,
        exclusion_rule_dismissed_at: null,
      })
      .eq("account_id", ctx.accountId)
      .eq("exclusion_rule_id", rule.id)
      .select("id, document_id");
    if (itemError) throw new Error(itemError.message);
    const clearedDocumentIds = Array.from(
      new Set((clearedRows ?? []).map((row) => row.document_id)),
    );

    // Строку, исключённую ВРУЧНУЮ, удаление правила не трогает: её исключал
    // человек, а не правило. Раньше здесь стоял безусловный UPDATE по текущей
    // строке — он снимал и ручное решение тоже. Строки, которые исключило это
    // правило, уже сняты запросом выше; легаси-строки без происхождения
    // размечены бэкфиллом миграции 231.
    const clearedCurrentItem = (clearedRows ?? []).some((row) => row.id === item.id);

    await writeInventoryResultEvent({
      supabase: ctx.supabase,
      admin,
      accountId: ctx.accountId,
      userId: ctx.user.id,
      documentId: input.documentId,
      documentItemId: item.id,
      eventType: "persistent_exclusion_disabled",
      message: !clearedCurrentItem
        ? `Автоисключение позиции «${item.product_name}» удалено (в этом акте позиция исключена вручную и осталась исключённой)`
        : clearedDocumentIds.length > 1
          ? `Автоисключение позиции «${item.product_name}» удалено (позиция вернулась в итоги в ${clearedDocumentIds.length} актах)`
          : `Автоисключение позиции «${item.product_name}» удалено`,
      payload: {
        itemId: item.id,
        productName: item.product_name,
        ruleId: rule.id,
        reason,
        clearedDocumentIds,
      },
    });

    // Правило действовало на весь аккаунт, поэтому обновляем страницы всех
    // затронутых актов, а не только открытого.
    for (const documentId of new Set([input.documentId, ...clearedDocumentIds])) {
      revalidateInventoryResultPages(documentId);
    }
    revalidatePath("/documents/inventory");
    return { error: null };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось удалить автоисключение") };
  }
}

/**
 * Массовое исключение/возврат строк в управленческие итоги (из bulk-бара
 * таблицы итогов). Один round-trip + честный счётчик «N применено / M
 * пропущено» вместо клиентского цикла, который падал на первой ошибке.
 * Пропускаются строки, уже находящиеся в нужном состоянии и (при excluded)
 * участвующие в активном пересорте. Право inventory.adjust_results, общий
 * lock-гард по статусу акта.
 */
export async function bulkSetInventoryResultItemsExcluded(input: {
  documentId: string;
  itemIds: string[];
  excluded: boolean;
  reason?: string;
}): Promise<{ updated: number; skipped: number; error: string | null }> {
  const ctx = await getActiveContext(["inventory.view_results", "inventory.adjust_results"]);
  if (ctx.error || !ctx.user || !ctx.accountId) return { updated: 0, skipped: 0, error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  try {
    const document = await getResultDocumentForAction({
      admin,
      supabase: ctx.supabase,
      accountId: ctx.accountId,
      documentId: input.documentId,
      requireOpen: true,
    });
    const itemIds = Array.from(new Set(input.itemIds)).filter(Boolean);
    if (itemIds.length === 0) return { updated: 0, skipped: 0, error: "Не выбрано ни одной строки" };

    const { data: itemsRaw } = await admin
      .from<Array<{
        id: string;
        product_name: string;
        excluded_from_totals: boolean | null;
        exclusion_rule_id: string | null;
        ingredient_id: string | null;
        external_product_id: string | null;
      }>>("document_items")
      .select("id, product_name, excluded_from_totals, exclusion_rule_id, ingredient_id, external_product_id")
      .eq("account_id", ctx.accountId)
      .eq("document_id", document.id)
      .in("id", itemIds);
    const items = itemsRaw ?? [];

    let eligible = items;
    if (input.excluded) {
      // Строку в активном пересорте нельзя исключить — сначала отменить пересорт.
      const inResort = await getActiveResortItemIds({
        admin,
        accountId: ctx.accountId,
        documentId: document.id,
        itemIds,
      });
      eligible = eligible.filter((item) => !inResort.has(item.id));
    }
    // No-op'ы (уже в нужном состоянии) пропускаем — не плодим события.
    eligible = eligible.filter((item) => Boolean(item.excluded_from_totals) !== input.excluded);
    const skipped = itemIds.length - eligible.length;
    if (eligible.length === 0) return { updated: 0, skipped, error: null };

    const reason = input.excluded ? text(input.reason) : null;
    const now = new Date().toISOString();
    const applyUpdate = async (ids: string[], dismissedAt: string | null) => {
      if (ids.length === 0) return;
      const { error } = await admin
        .from("document_items")
        .update({
          excluded_from_totals: input.excluded,
          exclude_reason: reason,
          excluded_by: input.excluded ? ctx.user.id : null,
          excluded_at: input.excluded ? now : null,
          exclusion_rule_id: null,
          exclusion_rule_dismissed_at: dismissedAt,
        })
        .eq("account_id", ctx.accountId)
        .eq("document_id", document.id)
        .in("id", ids);
      if (error) throw new Error(error.message);
    };

    if (input.excluded) {
      // Ручное исключение перекрывает происхождение: строка исключена
      // человеком, а не правилом.
      await applyUpdate(eligible.map((item) => item.id), null);
    } else {
      // Возврат в итоги: строке, на которую действует правило, ставим отметку
      // об отказе — иначе ближайший импорт применит правило заново. Смотрим не
      // только на записанное происхождение: ручное исключение его сбрасывает,
      // а правило на позицию при этом остаётся активным.
      const matchRule = await loadActiveExclusionRuleMatcher({ admin, accountId: ctx.accountId });
      const underRule = (item: (typeof eligible)[number]) =>
        Boolean(item.exclusion_rule_id) || Boolean(matchRule(item));
      await applyUpdate(eligible.filter(underRule).map((item) => item.id), now);
      await applyUpdate(
        eligible.filter((item) => !underRule(item)).map((item) => item.id),
        null,
      );
    }

    await writeInventoryResultEvents({
      supabase: ctx.supabase,
      admin,
      accountId: ctx.accountId,
      userId: ctx.user.id,
      documentId: document.id,
      eventType: input.excluded ? "exclude_enabled" : "exclude_disabled",
      events: eligible.map((item) => ({
        documentItemId: item.id,
        message: input.excluded
          ? `Позиция «${item.product_name}» исключена из управленческих итогов`
          : `Позиция «${item.product_name}» возвращена в управленческие итоги`,
        payload: { itemId: item.id, productName: item.product_name, reason, bulk: true },
      })),
      auditPayload: { bulk: true, count: eligible.length, excluded: input.excluded },
    });

    revalidateInventoryResultPages(document.id);
    return { updated: eligible.length, skipped, error: null };
  } catch (error) {
    return { updated: 0, skipped: 0, error: actionErrorMessage(error, "Не удалось изменить учёт строк") };
  }
}

/**
 * Массовое добавление позиций в автоисключения (bulk-бар «Исключать всегда»).
 * Серверный цикл (правило создаётся пер-строчно), один round-trip + счётчик.
 * Пропускаются строки без QR-идентификатора и участвующие в активном пересорте.
 * Право inventory.adjust_results.
 */
export async function bulkCreateInventoryResultExclusionRules(input: {
  documentId: string;
  itemIds: string[];
  reason?: string;
}): Promise<{ updated: number; skipped: number; error: string | null }> {
  const ctx = await getActiveContext(["inventory.view_results", "inventory.adjust_results"]);
  if (ctx.error || !ctx.user || !ctx.accountId) return { updated: 0, skipped: 0, error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  try {
    const document = await getResultDocumentForAction({
      admin,
      supabase: ctx.supabase,
      accountId: ctx.accountId,
      documentId: input.documentId,
      requireOpen: true,
    });
    const itemIds = Array.from(new Set(input.itemIds)).filter(Boolean);
    if (itemIds.length === 0) return { updated: 0, skipped: 0, error: "Не выбрано ни одной строки" };

    const { data: itemsRaw } = await admin
      .from<
        Array<{
          id: string;
          product_name: string;
          ingredient_id: string | null;
          external_product_id: string | null;
        }>
      >("document_items")
      .select("id, product_name, ingredient_id, external_product_id")
      .eq("account_id", ctx.accountId)
      .eq("document_id", document.id)
      .in("id", itemIds);
    const items = itemsRaw ?? [];
    const inResort = await getActiveResortItemIds({
      admin,
      accountId: ctx.accountId,
      documentId: document.id,
      itemIds,
    });

    const reason = text(input.reason);
    const now = new Date().toISOString();

    // Раньше на каждую строку уходило до пяти запросов: поиск правила, его
    // вставка, апдейт строки и два на журнал. На 300 позициях — 1500
    // round-trip'ов, при том что правил всего единицы. Теперь: правила
    // читаются одним запросом, недостающие вставляются одной пачкой, строки
    // обновляются группами по правилу, журнал пишется батчем.
    const matchRule = await loadActiveExclusionRuleMatcher({ admin, accountId: ctx.accountId });
    const eligible = items.filter(
      (item) => (item.ingredient_id || item.external_product_id) && !inResort.has(item.id),
    );

    // Одно правило на позицию: строки одной позиции делят его.
    const ruleKey = (item: (typeof eligible)[number]) =>
      item.ingredient_id ? `ing:${item.ingredient_id}` : `ext:${item.external_product_id}`;
    const ruleIdByKey = new Map<string, string>();
    const missing: Array<{ key: string; item: (typeof eligible)[number] }> = [];
    for (const item of eligible) {
      const key = ruleKey(item);
      if (ruleIdByKey.has(key)) continue;
      const existing = matchRule(item);
      if (existing) ruleIdByKey.set(key, existing.id);
      else if (!missing.some((row) => row.key === key)) missing.push({ key, item });
    }

    if (missing.length > 0) {
      const { data: createdRules, error: rulesError } = await admin
        .from<Array<{ id: string; ingredient_id: string | null; external_product_id: string | null }>>(
          "inventory_result_exclusion_rules",
        )
        .insert(
          missing.map(({ item }) => ({
            account_id: ctx.accountId,
            ingredient_id: item.ingredient_id,
            external_product_id: item.external_product_id,
            product_name: item.product_name,
            reason,
            created_by: ctx.user.id,
          })),
        )
        .select("id, ingredient_id, external_product_id");
      if (rulesError) throw new Error(rulesError.message);
      for (const rule of createdRules ?? []) {
        const key = rule.ingredient_id ? `ing:${rule.ingredient_id}` : `ext:${rule.external_product_id}`;
        ruleIdByKey.set(key, rule.id);
      }
      if (missing.some(({ key }) => !ruleIdByKey.has(key))) {
        throw new Error("Не удалось создать правило автоисключения");
      }
    }

    const itemIdsByRule = new Map<string, string[]>();
    for (const item of eligible) {
      const ruleId = ruleIdByKey.get(ruleKey(item));
      if (!ruleId) continue;
      const bucket = itemIdsByRule.get(ruleId) ?? [];
      bucket.push(item.id);
      itemIdsByRule.set(ruleId, bucket);
    }
    for (const [ruleId, ids] of itemIdsByRule) {
      const { error: itemError } = await admin
        .from("document_items")
        .update({
          excluded_from_totals: true,
          exclude_reason: reason,
          excluded_by: ctx.user.id,
          excluded_at: now,
          exclusion_rule_id: ruleId,
          exclusion_rule_dismissed_at: null,
        })
        .eq("account_id", ctx.accountId)
        .in("id", ids);
      if (itemError) throw new Error(itemError.message);
    }

    await writeInventoryResultEvents({
      supabase: ctx.supabase,
      admin,
      accountId: ctx.accountId,
      userId: ctx.user.id,
      documentId: document.id,
      eventType: "persistent_exclusion_enabled",
      events: eligible.map((item) => ({
        documentItemId: item.id,
        message: `Позиция «${item.product_name}» добавлена в автоисключения`,
        payload: {
          itemId: item.id,
          productName: item.product_name,
          ruleId: ruleIdByKey.get(ruleKey(item)) ?? null,
          reason,
          bulk: true,
        },
      })),
      auditPayload: { bulk: true, count: eligible.length, reason },
    });
    const updated = eligible.length;

    revalidateInventoryResultPages(document.id);
    return { updated, skipped: itemIds.length - updated, error: null };
  } catch (error) {
    return { updated: 0, skipped: 0, error: actionErrorMessage(error, "Не удалось добавить автоисключения") };
  }
}
