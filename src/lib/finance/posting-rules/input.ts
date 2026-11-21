import { z } from "zod";

import type {
  PostingRuleActions,
  PostingRuleCondition,
  PostingRuleConditionField,
} from "./types.ts";

export type PostingRuleInput = {
  name: string | null;
  enabled: boolean;
  conditions: PostingRuleCondition[];
  actions: PostingRuleActions;
};

export const CONDITION_FIELD_LABELS: Record<PostingRuleConditionField, string> = {
  counterparty: "Контрагент",
  counterparty_group: "Группа контрагентов",
  counterparty_inn: "ИНН контрагента",
  bank_account: "Счёт",
  type: "Тип операции",
  amount: "Сумма",
  description: "Описание",
};

const MAX_CONDITIONS = 20;
const MAX_NAME = 200;

const ids = z.array(z.string().min(1)).max(500);
const conditionSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("counterparty"), op: z.enum(["in", "not_in"]), ids }),
  z.object({ field: z.literal("counterparty_group"), op: z.literal("in"), ids }),
  z.object({ field: z.literal("counterparty_inn"), op: z.literal("eq"), value: z.string() }),
  z.object({ field: z.literal("bank_account"), op: z.literal("in"), ids }),
  z.object({ field: z.literal("type"), op: z.literal("eq"), value: z.enum(["income", "expense"]) }),
  z.object({
    field: z.literal("amount"),
    op: z.literal("between"),
    min: z.number().finite().nonnegative().nullable(),
    max: z.number().finite().nonnegative().nullable(),
  }),
  z.object({
    field: z.literal("description"),
    op: z.enum(["contains", "not_contains", "eq", "starts_with"]),
    value: z.string().max(500),
  }),
]);
const actionId = z.string().min(1).nullable().optional();
const inputSchema = z.object({
  name: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  conditions: z.array(conditionSchema),
  actions: z.object({
    category_id: actionId,
    counterparty_id: actionId,
    venue_id: actionId,
  }),
});

/** Условия, прочитанные из базы. Правило могли записать в обход приложения,
 *  поэтому испорченный список даёт null — такое правило не применяется. */
export function parseStoredConditions(value: unknown): PostingRuleCondition[] | null {
  const parsed = z.array(conditionSchema).min(1).max(MAX_CONDITIONS).safeParse(value);
  return parsed.success ? (parsed.data as PostingRuleCondition[]) : null;
}

type Result = { ok: true; value: PostingRuleInput } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });

const TYPE_LABEL = { income: "приходов", expense: "расходов" } as const;

/** Проверяет и приводит к одному виду правило из формы. Статья прихода или
 *  расхода добавляет условие на тип, чтобы не попасть на операцию другого типа. */
export function normalizePostingRuleInput(
  input: unknown,
  categoryTypes: Map<string, "income" | "expense" | "mixed">,
): Result {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail("Правило заполнено с ошибкой");
  const raw = parsed.data;

  if (raw.conditions.length === 0) return fail("Добавьте хотя бы одно условие");
  if (raw.conditions.length > MAX_CONDITIONS) return fail(`Условий не больше ${MAX_CONDITIONS}`);

  const actions: PostingRuleActions = {};
  for (const field of ["category_id", "counterparty_id", "venue_id"] as const) {
    const value = raw.actions[field];
    if (value) actions[field] = value;
  }
  if (Object.keys(actions).length === 0) return fail("Добавьте хотя бы одно действие");

  const seen = new Set<PostingRuleConditionField>();
  const conditions: PostingRuleCondition[] = [];
  for (const condition of raw.conditions) {
    const label = CONDITION_FIELD_LABELS[condition.field];
    if (condition.field !== "description") {
      if (seen.has(condition.field)) return fail(`Условие «${label}» уже есть в правиле`);
      seen.add(condition.field);
    }
    switch (condition.field) {
      case "counterparty":
      case "counterparty_group":
      case "bank_account": {
        const unique = [...new Set(condition.ids)];
        if (unique.length === 0) return fail(`Выберите значение в условии «${label}»`);
        conditions.push({ ...condition, ids: unique } as PostingRuleCondition);
        break;
      }
      case "counterparty_inn": {
        const value = condition.value.trim();
        if (!/^(\d{10}|\d{12})$/.test(value)) return fail("ИНН — 10 или 12 цифр");
        conditions.push({ ...condition, value });
        break;
      }
      case "amount": {
        if (condition.min === null && condition.max === null) {
          return fail(`Укажите границу в условии «${label}»`);
        }
        if (condition.min !== null && condition.max !== null && condition.min > condition.max) {
          return fail(`В условии «${label}» значение «от» больше, чем «до»`);
        }
        conditions.push(condition);
        break;
      }
      case "description": {
        const value = condition.value.replace(/\s+/g, " ").trim();
        if (!value) return fail(`Введите текст в условии «${label}»`);
        conditions.push({ ...condition, value });
        break;
      }
      case "type":
        conditions.push(condition);
        break;
    }
  }

  if (actions.category_id) {
    const categoryType = categoryTypes.get(actions.category_id);
    if (!categoryType) return fail("Статья не найдена");
    if (categoryType !== "mixed") {
      const typeCondition = conditions.find((c) => c.field === "type");
      if (!typeCondition) {
        if (conditions.length >= MAX_CONDITIONS) {
          return fail(`Условий не больше ${MAX_CONDITIONS}, считая условие на тип операции`);
        }
        conditions.push({ field: "type", op: "eq", value: categoryType });
      } else if (typeCondition.value !== categoryType) {
        return fail(
          `Статья для ${TYPE_LABEL[categoryType]}, а правило — для ${TYPE_LABEL[typeCondition.value]}`,
        );
      }
    }
  }

  const name = raw.name?.trim() || null;
  if (name && name.length > MAX_NAME) return fail(`Название — не длиннее ${MAX_NAME} символов`);

  return { ok: true, value: { name, enabled: raw.enabled ?? true, conditions, actions } };
}
