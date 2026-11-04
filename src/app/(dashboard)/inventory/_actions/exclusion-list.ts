"use server";

// Список исключений заведения: просмотр, добавление и снятие правил
// (на товар и на группу), ретро-применение правил, ещё не применённых к актам.

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCachedPermissionChecker } from "@/lib/supabase/server";
import { asLooseDb, type LooseDb } from "@/lib/supabase/loose";
import {
  duplicateTarget,
  groupDescendants,
  type ExclusionRuleRow,
  type GroupNode,
} from "@/lib/inventory/exclusion-rules";
import { actionErrorMessage, getActiveContext } from "../actions-shared";
import { applyExclusionRuleRetro, applyExclusionRulesRetro } from "../exclusion-retro-service";

export type ExclusionListItem = {
  id: string;
  kind: "product" | "group" | "legacy_name";
  name: string;
  path: string | null;
  productCount: number | null;
  source: "act" | "manual" | "glide";
  createdByName: string | null;
  createdAt: string;
};

export type ExclusionCandidate = {
  kind: "product" | "group";
  id: string;
  name: string;
  path: string | null;
  productCount: number | null;
};

type RuleDbRow = ExclusionRuleRow & {
  status: string;
  metadata: Record<string, unknown> | null;
};

type GroupRow = GroupNode & { name: string };

const RULE_COLUMNS =
  "id, target_kind, ingredient_id, external_product_id, ingredient_group_id, product_name, reason, created_by, created_at, status, metadata";
const SEARCH_LIMIT = 30;

function revalidateVenueSettings() {
  revalidatePath("/org/venues/[venueId]", "page");
}

async function loadGroups(admin: LooseDb, accountId: string): Promise<GroupRow[]> {
  const { data, error } = await admin
    .from<GroupRow[]>("ingredient_groups")
    .select("id, name, parent_group_id")
    .eq("account_id", accountId)
    .limit(10000);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Имена предков группы от корня, через « → » (сама группа не входит). */
function ancestorPath(groupId: string | null, byId: Map<string, GroupRow>, includeSelf: boolean): string | null {
  const names: string[] = [];
  const visited = new Set<string>();
  let current = groupId ? byId.get(groupId) : undefined;
  if (current && !includeSelf) {
    visited.add(current.id);
    current = current.parent_group_id ? byId.get(current.parent_group_id) : undefined;
  }
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    names.unshift(current.name);
    current = current.parent_group_id ? byId.get(current.parent_group_id) : undefined;
  }
  return names.length > 0 ? names.join(" → ") : null;
}

/** Число неархивных товаров в группе и всех её подгруппах. */
async function countGroupProducts(
  admin: LooseDb,
  accountId: string,
  groupId: string,
  groups: GroupNode[],
): Promise<number> {
  const ids = [...groupDescendants(groupId, groups)];
  const { count, error } = await admin
    .from("ingredients")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .is("archived_at", null)
    .in("group_id", ids);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

function ruleSource(metadata: Record<string, unknown> | null): "act" | "manual" | "glide" {
  const s = metadata?.source;
  return s === "manual" || s === "glide" ? s : "act";
}

async function loadProfileNames(admin: LooseDb, userIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (userIds.length === 0) return names;
  const { data } = await admin
    .from<{ id: string; first_name: string | null; last_name: string | null }[]>("profiles")
    .select("id, first_name, last_name")
    .in("id", userIds);
  for (const p of data ?? []) {
    const name = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
    if (name) names.set(p.id, name);
  }
  return names;
}

export async function listExclusionRules(): Promise<
  { items: ExclusionListItem[]; canEdit: boolean; pendingRetro: number } | { error: string }
> {
  const ctx = await getActiveContext(["inventory.view_results"]);
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error ?? "Не авторизован" };

  const admin = asLooseDb(createAdminClient());
  try {
    const can = await getCachedPermissionChecker();
    const canEdit = can("inventory.adjust_results");

    const { data: rules, error } = await admin
      .from<RuleDbRow[]>("inventory_result_exclusion_rules")
      .select(RULE_COLUMNS)
      .eq("account_id", ctx.accountId)
      .eq("status", "active")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const rows = rules ?? [];

    const groups = await loadGroups(admin, ctx.accountId);
    const byId = new Map(groups.map((g) => [g.id, g]));

    const productIds = rows
      .filter((r) => r.target_kind === "product" && r.ingredient_id)
      .map((r) => r.ingredient_id as string);
    const ingredientGroup = new Map<string, string | null>();
    if (productIds.length > 0) {
      const { data: ings } = await admin
        .from<{ id: string; group_id: string | null }[]>("ingredients")
        .select("id, group_id")
        .eq("account_id", ctx.accountId)
        .in("id", productIds);
      for (const i of ings ?? []) ingredientGroup.set(i.id, i.group_id);
    }

    const names = await loadProfileNames(
      admin,
      [...new Set(rows.map((r) => r.created_by).filter((v): v is string => !!v))],
    );

    const items: ExclusionListItem[] = [];
    for (const r of rows) {
      let name = r.product_name;
      let path: string | null = null;
      let productCount: number | null = null;
      if (r.target_kind === "group" && r.ingredient_group_id) {
        const g = byId.get(r.ingredient_group_id);
        if (g) name = g.name;
        path = ancestorPath(r.ingredient_group_id, byId, false);
        productCount = await countGroupProducts(admin, ctx.accountId, r.ingredient_group_id, groups);
      } else if (r.target_kind === "product" && r.ingredient_id) {
        path = ancestorPath(ingredientGroup.get(r.ingredient_id) ?? null, byId, true);
      }
      items.push({
        id: r.id,
        kind: r.target_kind,
        name,
        path,
        productCount,
        source: ruleSource(r.metadata),
        createdByName: r.created_by ? (names.get(r.created_by) ?? null) : null,
        createdAt: r.created_at,
      });
    }

    const pendingRetro = rows.filter(
      (r) => r.target_kind !== "legacy_name" && !r.metadata?.retro_applied_at,
    ).length;

    return { items, canEdit, pendingRetro };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось загрузить список исключений") };
  }
}

/** Убираем символы, ломающие фильтр PostgREST `or(...)` и шаблон ilike. */
function sanitizeSearch(query: string): string {
  return query.replace(/[,()%*_\\]/g, " ").replace(/\s+/g, " ").trim();
}

export async function searchExclusionCandidates(query: string): Promise<ExclusionCandidate[]> {
  const ctx = await getActiveContext(["inventory.view_results"]);
  if (ctx.error || !ctx.user || !ctx.accountId) return [];
  const q = sanitizeSearch(query);
  if (q.length === 0) return [];

  const admin = asLooseDb(createAdminClient());
  try {
    const groups = await loadGroups(admin, ctx.accountId);
    const byId = new Map(groups.map((g) => [g.id, g]));
    const lower = q.toLowerCase();

    const matchedGroups = groups
      .filter((g) => g.name.toLowerCase().includes(lower))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
      .slice(0, SEARCH_LIMIT);

    const result: ExclusionCandidate[] = [];
    for (const g of matchedGroups) {
      result.push({
        kind: "group",
        id: g.id,
        name: g.name,
        path: ancestorPath(g.id, byId, false),
        productCount: await countGroupProducts(admin, ctx.accountId, g.id, groups),
      });
    }

    const room = SEARCH_LIMIT - result.length;
    if (room > 0) {
      const { data: ings, error } = await admin
        .from<{ id: string; name: string; group_id: string | null }[]>("ingredients")
        .select("id, name, group_id")
        .eq("account_id", ctx.accountId)
        .is("archived_at", null)
        .or(`name.ilike.%${q}%`)
        .order("name", { ascending: true })
        .limit(room);
      if (error) throw new Error(error.message);
      for (const i of ings ?? []) {
        result.push({
          kind: "product",
          id: i.id,
          name: i.name,
          path: ancestorPath(i.group_id, byId, true),
          productCount: null,
        });
      }
    }
    return result;
  } catch (error) {
    console.error("[exclusion-list] поиск кандидатов не выполнен", error);
    return [];
  }
}

async function runRetro(
  run: () => Promise<{ notice: string | null }>,
  failure: string,
): Promise<string | null> {
  try {
    return (await run()).notice;
  } catch (error) {
    console.error("[exclusion-list] ретроактивное применение не выполнено", error);
    return `${failure}: ${actionErrorMessage(error, "ошибка")}.`;
  }
}

export async function addExclusionRule(input: {
  kind: "product" | "group";
  id: string;
  replacesLegacyId?: string;
}): Promise<{ error: string | null; notice?: string | null }> {
  const ctx = await getActiveContext(["inventory.view_results", "inventory.adjust_results"]);
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error ?? "Не авторизован" };
  const accountId = ctx.accountId;
  const userId = ctx.user.id;

  const admin = asLooseDb(createAdminClient());
  try {
    let name: string;
    if (input.kind === "group") {
      const { data } = await admin
        .from<{ id: string; name: string }>("ingredient_groups")
        .select("id, name")
        .eq("id", input.id)
        .eq("account_id", accountId)
        .maybeSingle();
      if (!data) throw new Error("Группа не найдена");
      name = data.name;
    } else {
      const { data } = await admin
        .from<{ id: string; name: string; archived_at: string | null }>("ingredients")
        .select("id, name, archived_at")
        .eq("id", input.id)
        .eq("account_id", accountId)
        .maybeSingle();
      if (!data) throw new Error("Товар не найден");
      name = data.name;
    }

    const duplicateError = `«${name}» уже в списке исключений`;
    const { data: active, error: activeError } = await admin
      .from<RuleDbRow[]>("inventory_result_exclusion_rules")
      .select(RULE_COLUMNS)
      .eq("account_id", accountId)
      .eq("status", "active");
    if (activeError) throw new Error(activeError.message);
    if (duplicateTarget(active ?? [], { kind: input.kind, id: input.id })) {
      return { error: duplicateError };
    }

    const { data: rule, error: insertError } = await admin
      .from<{ id: string }>("inventory_result_exclusion_rules")
      .insert({
        account_id: accountId,
        target_kind: input.kind,
        ingredient_id: input.kind === "product" ? input.id : null,
        ingredient_group_id: input.kind === "group" ? input.id : null,
        product_name: name,
        reason: null,
        created_by: userId,
        metadata: { source: "manual" },
      })
      .select("id")
      .single();
    if (insertError) {
      // Гонка: параллельное добавление той же цели упёрлось в уникальный индекс.
      if ((insertError as { code?: string }).code === "23505" || /duplicate key|unique/i.test(insertError.message)) {
        return { error: duplicateError };
      }
      throw new Error(insertError.message);
    }
    if (!rule?.id) throw new Error("Не удалось добавить правило");

    if (input.replacesLegacyId) {
      const { error: legacyError } = await admin
        .from("inventory_result_exclusion_rules")
        .update({
          status: "deleted",
          deleted_by: userId,
          deleted_at: new Date().toISOString(),
          delete_reason: "Сопоставлено",
        })
        .eq("id", input.replacesLegacyId)
        .eq("account_id", accountId)
        .eq("target_kind", "legacy_name")
        .eq("status", "active");
      if (legacyError) throw new Error(legacyError.message);
    }

    const notice = await runRetro(
      () => applyExclusionRuleRetro({ admin, accountId, userId, ruleId: rule.id, mode: "apply" }),
      "В прошлых актах правило не применено",
    );

    revalidateVenueSettings();
    return { error: null, notice };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось добавить исключение") };
  }
}

export async function removeExclusionRule(input: {
  ruleId: string;
  reason: string;
}): Promise<{ error: string | null; notice?: string | null }> {
  const ctx = await getActiveContext(["inventory.view_results", "inventory.adjust_results"]);
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error ?? "Не авторизован" };
  const accountId = ctx.accountId;
  const userId = ctx.user.id;

  const reason = (input.reason ?? "").trim();
  if (!reason) return { error: "Укажите основание" };

  const admin = asLooseDb(createAdminClient());
  try {
    const { data: rule } = await admin
      .from<{ id: string; target_kind: "product" | "group" | "legacy_name"; status: string }>(
        "inventory_result_exclusion_rules",
      )
      .select("id, target_kind, status")
      .eq("id", input.ruleId)
      .eq("account_id", accountId)
      .maybeSingle();
    if (!rule || rule.status !== "active") throw new Error("Правило исключения не найдено");

    const { error: updateError } = await admin
      .from("inventory_result_exclusion_rules")
      .update({
        status: "deleted",
        deleted_by: userId,
        deleted_at: new Date().toISOString(),
        delete_reason: reason,
      })
      .eq("id", rule.id)
      .eq("account_id", accountId);
    if (updateError) throw new Error(updateError.message);

    let notice: string | null = null;
    if (rule.target_kind !== "legacy_name") {
      notice = await runRetro(
        () => applyExclusionRuleRetro({ admin, accountId, userId, ruleId: rule.id, mode: "remove" }),
        "В прошлых актах исключение не снято",
      );
    }

    revalidateVenueSettings();
    return { error: null, notice };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось снять исключение") };
  }
}

/**
 * Применяет к прошлым актам все действующие правила на товар/группу, у которых
 * ещё нет отметки metadata.retro_applied_at (в том числе созданные из актов).
 */
export async function applyPendingExclusionRules(): Promise<{ error: string | null; notice?: string | null }> {
  const ctx = await getActiveContext(["inventory.view_results", "inventory.adjust_results"]);
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error ?? "Не авторизован" };

  const admin = asLooseDb(createAdminClient());
  try {
    const { data, error } = await admin
      .from<{ id: string; metadata: Record<string, unknown> | null }[]>("inventory_result_exclusion_rules")
      .select("id, metadata")
      .eq("account_id", ctx.accountId)
      .eq("status", "active")
      .in("target_kind", ["product", "group"]);
    if (error) throw new Error(error.message);
    const ruleIds = (data ?? []).filter((r) => !r.metadata?.retro_applied_at).map((r) => r.id);
    if (ruleIds.length === 0) return { error: null, notice: null };

    const result = await applyExclusionRulesRetro({
      admin,
      accountId: ctx.accountId,
      userId: ctx.user.id,
      ruleIds,
      mode: "apply",
    });
    revalidateVenueSettings();
    return { error: null, notice: result.notice };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось применить исключения к прошлым актам") };
  }
}
