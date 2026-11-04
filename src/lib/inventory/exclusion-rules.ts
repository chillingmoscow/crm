/**
 * Сопоставление строки акта с правилом исключения.
 *
 * Правило бывает трёх видов (`target_kind`):
 *   - `product` — на конкретный товар (по ingredient_id или external_product_id);
 *   - `group` — на группу ингредиентов; действует и на вложенные подгруппы;
 *   - `legacy_name` — перенесённое из Glide правило по названию; в сопоставлении
 *     не участвует.
 *
 * Приоритет: правило на товар сильнее правила на группу; среди товарных
 * побеждает совпадение по ingredient_id; среди групповых — ближайшая группа
 * при подъёме от группы самой строки к корню.
 *
 * Без импортов из `@/...`, чтобы node:test мог импортировать файл напрямую.
 */

export type ExclusionRuleRow = {
  id: string;
  target_kind: "product" | "group" | "legacy_name";
  ingredient_id: string | null;
  external_product_id: string | null;
  ingredient_group_id: string | null;
  product_name: string;
  reason: string | null;
  created_by: string | null;
  created_at: string;
};

export type GroupNode = { id: string; parent_group_id: string | null };

export type ExclusionMatcher = (line: {
  ingredientId: string | null;
  externalProductId: string | null;
  groupId: string | null;
}) => ExclusionRuleRow | null;

/** Группа и все её потомки (включая саму). Устойчиво к циклам в иерархии. */
export function groupDescendants(groupId: string, groups: GroupNode[]): Set<string> {
  const children = new Map<string, string[]>();
  for (const g of groups) {
    if (g.parent_group_id == null) continue;
    const list = children.get(g.parent_group_id);
    if (list) list.push(g.id);
    else children.set(g.parent_group_id, [g.id]);
  }
  const result = new Set<string>([groupId]);
  const stack = [groupId];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const child of children.get(current) ?? []) {
      if (result.has(child)) continue;
      result.add(child);
      stack.push(child);
    }
  }
  return result;
}

export function buildExclusionMatcher(
  rules: ExclusionRuleRow[],
  groups: GroupNode[],
): ExclusionMatcher {
  const byIngredient = new Map<string, ExclusionRuleRow>();
  const byExternal = new Map<string, ExclusionRuleRow>();
  const byGroup = new Map<string, ExclusionRuleRow>();
  for (const r of rules) {
    if (r.target_kind === "product") {
      if (r.ingredient_id && !byIngredient.has(r.ingredient_id)) {
        byIngredient.set(r.ingredient_id, r);
      }
      if (r.external_product_id && !byExternal.has(r.external_product_id)) {
        byExternal.set(r.external_product_id, r);
      }
    } else if (r.target_kind === "group") {
      if (r.ingredient_group_id && !byGroup.has(r.ingredient_group_id)) {
        byGroup.set(r.ingredient_group_id, r);
      }
    }
  }
  const parentOf = new Map(groups.map((g) => [g.id, g.parent_group_id]));

  return (line) => {
    if (line.ingredientId) {
      const hit = byIngredient.get(line.ingredientId);
      if (hit) return hit;
    }
    if (line.externalProductId) {
      const hit = byExternal.get(line.externalProductId);
      if (hit) return hit;
    }
    // Подъём от группы строки к корню; ближайшее правило побеждает.
    const visited = new Set<string>();
    let current: string | null = line.groupId;
    while (current != null && !visited.has(current)) {
      visited.add(current);
      const hit = byGroup.get(current);
      if (hit) return hit;
      current = parentOf.get(current) ?? null;
    }
    return null;
  };
}
