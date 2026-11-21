import { formatQuantityAmount } from "../../format/amount.ts";
import type { PostingRule, PostingRuleCondition } from "./types.ts";

export type RuleNameKind = "counterparty" | "counterparty_group" | "bank_account" | "category" | "venue";

/** Названия справочников, доступных пользователю; null — нет доступа или не найдено. */
export type RuleNames = { lookup(kind: RuleNameKind, id: string): string | null };

const UNKNOWN: Record<RuleNameKind, string> = {
  counterparty: "другой контрагент",
  counterparty_group: "другая группа",
  bank_account: "другой счёт",
  category: "другая статья",
  venue: "другое заведение",
};

function nameOf(names: RuleNames, kind: RuleNameKind, id: string): string {
  return names.lookup(kind, id) ?? UNKNOWN[kind];
}

/** «— X» для одного значения, «— один из: X, Y» для нескольких. */
function list(names: RuleNames, kind: RuleNameKind, ids: string[], several: string): string {
  const labels = ids.map((id) => nameOf(names, kind, id));
  return labels.length === 1 ? `— ${labels[0]}` : `— ${several}: ${labels.join(", ")}`;
}

/** Границы суммы — как их ввели: без добивания нулями, до копеек. */
function money(value: number): string {
  return formatQuantityAmount(value, 2);
}

function describeCondition(condition: PostingRuleCondition, names: RuleNames): string {
  switch (condition.field) {
    case "counterparty":
      if (condition.op === "not_in") {
        const labels = condition.ids.map((id) => nameOf(names, "counterparty", id));
        return labels.length === 1
          ? `контрагент — не ${labels[0]}`
          : `контрагент — ни один из: ${labels.join(", ")}`;
      }
      return `контрагент ${list(names, "counterparty", condition.ids, "один из")}`;
    case "counterparty_group":
      return `группа контрагентов ${list(names, "counterparty_group", condition.ids, "одна из")}`;
    case "counterparty_inn":
      return `ИНН контрагента — ${condition.value}`;
    case "bank_account":
      return `счёт ${list(names, "bank_account", condition.ids, "один из")}`;
    case "type":
      return condition.value === "income" ? "приход" : "расход";
    case "amount": {
      const { min, max } = condition;
      if (min !== null && max !== null) return `сумма от ${money(min)} до ${money(max)} ₽`;
      if (min !== null) return `сумма от ${money(min)} ₽`;
      return `сумма до ${money(max ?? 0)} ₽`;
    }
    case "description":
      switch (condition.op) {
        case "contains":
          return `описание содержит «${condition.value}»`;
        case "not_contains":
          return `описание не содержит «${condition.value}»`;
        case "eq":
          return `описание — «${condition.value}»`;
        case "starts_with":
          return `описание начинается с «${condition.value}»`;
      }
  }
}

/** Правило словами: «если {conditions} → {actions}». */
export function describePostingRule(
  rule: Pick<PostingRule, "conditions" | "actions">,
  names: RuleNames,
): { conditions: string; actions: string } {
  const conditions = rule.conditions.map((c) => describeCondition(c, names)).join("; ");
  const actions: string[] = [];
  const { category_id, counterparty_id, venue_id } = rule.actions;
  if (category_id) {
    const name = names.lookup("category", category_id);
    actions.push(name ? `статья «${name}»` : UNKNOWN.category);
  }
  if (counterparty_id) {
    const name = names.lookup("counterparty", counterparty_id);
    actions.push(name ? `контрагент ${name}` : UNKNOWN.counterparty);
  }
  if (venue_id) {
    const name = names.lookup("venue", venue_id);
    actions.push(name ? `заведение ${name}` : UNKNOWN.venue);
  }
  return { conditions, actions: actions.join(", ") };
}
