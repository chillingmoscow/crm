import type {
  PostingRule,
  PostingRuleActionField,
  PostingRuleCondition,
  RuleContext,
  RuleResult,
  RuleSubject,
} from "./types.ts";

/** Текст для сравнения: без регистра, «ё», пробелов по краям и двойных пробелов. */
export function normalizeRuleText(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

function referencedIds(rule: PostingRule): string[] {
  const ids: string[] = [];
  for (const condition of rule.conditions) {
    if ("ids" in condition) ids.push(...condition.ids);
  }
  for (const value of Object.values(rule.actions)) {
    if (value) ids.push(value);
  }
  return ids;
}

function hasActions(rule: PostingRule): boolean {
  return Object.values(rule.actions).some(Boolean);
}

/** Правило ссылается на архивный/удалённый справочник или ему нечего делать. */
export function ruleNeedsAttention(rule: PostingRule, ctx: RuleContext): boolean {
  if (!hasActions(rule) || rule.conditions.length === 0) return true;
  return referencedIds(rule).some((id) => ctx.inactiveIds.has(id));
}

function conditionMatches(
  condition: PostingRuleCondition,
  subject: RuleSubject,
  ctx: RuleContext,
): boolean {
  const counterparty = subject.counterparty_id
    ? ctx.counterparties.get(subject.counterparty_id) ?? null
    : null;
  switch (condition.field) {
    case "counterparty": {
      const listed =
        subject.counterparty_id !== null && condition.ids.includes(subject.counterparty_id);
      return condition.op === "in" ? listed : !listed;
    }
    case "counterparty_group":
      return Boolean(counterparty?.group_id && condition.ids.includes(counterparty.group_id));
    case "counterparty_inn": {
      const inn = counterparty?.inn?.trim();
      return Boolean(inn) && inn === condition.value.trim();
    }
    case "bank_account":
      return subject.bank_account_id !== null && condition.ids.includes(subject.bank_account_id);
    case "type":
      return subject.type === condition.value;
    case "amount": {
      if (subject.amount === null) return false;
      if (condition.min !== null && subject.amount < condition.min) return false;
      if (condition.max !== null && subject.amount > condition.max) return false;
      return true;
    }
    case "description": {
      const text = normalizeRuleText(subject.description);
      const needle = normalizeRuleText(condition.value);
      switch (condition.op) {
        case "contains":
          return text.includes(needle);
        case "not_contains":
          return !text.includes(needle);
        case "eq":
          return text === needle;
        case "starts_with":
          return text.startsWith(needle);
      }
    }
  }
}

/** Подходит ли операция под все условия правила. Переводы не разносятся. */
export function ruleMatches(rule: PostingRule, subject: RuleSubject, ctx: RuleContext): boolean {
  if (subject.type === "transfer") return false;
  if (rule.conditions.length === 0) return false;
  return rule.conditions.every((condition) => conditionMatches(condition, subject, ctx));
}

function actionAllowed(
  field: PostingRuleActionField,
  value: string,
  subject: RuleSubject,
  ctx: RuleContext,
): boolean {
  if (field === "venue_id") {
    return ctx.allowedVenueIds === null || ctx.allowedVenueIds.has(value);
  }
  if (field === "category_id") {
    const type = ctx.categoryTypes.get(value);
    return type === "mixed" || type === subject.type;
  }
  return true;
}

function fillFields(
  rules: PostingRule[],
  fields: PostingRuleActionField[],
  subject: RuleSubject,
  ctx: RuleContext,
  result: RuleResult,
): void {
  for (const field of fields) {
    for (const rule of rules) {
      const value = rule.actions[field];
      if (!value || !actionAllowed(field, value, subject, ctx)) continue;
      if (!ruleMatches(rule, subject, ctx)) continue;
      result[field] = { value, ruleId: rule.id };
      break;
    }
  }
}

/** Что правила подставят в поля, которые разрешено заполнять.
 *  Каждое поле — первое сверху подходящее правило с этим действием.
 *  Сначала контрагент, потом статья и заведение по уже известному контрагенту. */
export function evaluatePostingRules(
  rules: PostingRule[],
  subject: RuleSubject,
  ctx: RuleContext,
  fillable: Record<PostingRuleActionField, boolean>,
): RuleResult {
  const active = rules
    .filter((rule) => rule.enabled && !ruleNeedsAttention(rule, ctx))
    .sort((a, b) => a.position - b.position);
  const result: RuleResult = {};
  if (subject.type === "transfer") return result;

  if (fillable.counterparty_id) fillFields(active, ["counterparty_id"], subject, ctx, result);
  const known: RuleSubject = result.counterparty_id
    ? { ...subject, counterparty_id: result.counterparty_id.value }
    : subject;
  const rest = (["category_id", "venue_id"] as const).filter((field) => fillable[field]);
  fillFields(active, rest, known, ctx, result);
  return result;
}
