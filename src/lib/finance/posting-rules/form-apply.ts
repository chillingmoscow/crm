import type { PostingRuleActionField, RuleResult } from "./types.ts";

/** Откуда значение поля в форме операции:
 *  empty — пусто; filter — заведение подставлено фильтром страницы (подсказка,
 *  правило может заменить); rule — подставлено правилом; user — выбрал человек. */
export type FieldSource = "empty" | "filter" | "rule" | "user";

export type FormRuleState = {
  values: Record<PostingRuleActionField, string | null>;
  sources: Record<PostingRuleActionField, FieldSource>;
  ruleIds: Partial<Record<PostingRuleActionField, string>>;
  filterVenueId: string | null;
};

const FIELDS: PostingRuleActionField[] = ["category_id", "counterparty_id", "venue_id"];

/** Какие поля правилам можно заполнять: всё, кроме выбранного человеком. */
export function fillableFrom(state: FormRuleState): Record<PostingRuleActionField, boolean> {
  return {
    category_id: state.sources.category_id !== "user",
    counterparty_id: state.sources.counterparty_id !== "user",
    venue_id: state.sources.venue_id !== "user",
  };
}

/** Применяет результат вычислителя: подставляет найденное, а подстановку
 *  правила, которое больше не подходит, откатывает (заведение — к фильтру). */
export function applyRulesToForm(state: FormRuleState, result: RuleResult): FormRuleState {
  const next: FormRuleState = {
    ...state,
    values: { ...state.values },
    sources: { ...state.sources },
    ruleIds: { ...state.ruleIds },
  };
  for (const field of FIELDS) {
    if (state.sources[field] === "user") continue;
    const match = result[field];
    if (match) {
      next.values[field] = match.value;
      next.sources[field] = "rule";
      next.ruleIds[field] = match.ruleId;
    } else if (state.sources[field] === "rule") {
      delete next.ruleIds[field];
      if (field === "venue_id" && state.filterVenueId) {
        next.values[field] = state.filterVenueId;
        next.sources[field] = "filter";
      } else {
        next.values[field] = null;
        next.sources[field] = "empty";
      }
    }
  }
  return next;
}

/** Человек сам выбрал значение (в том числе «Без заведения») — правила его не трогают. */
export function markUserChoice(
  state: FormRuleState,
  field: PostingRuleActionField,
  value: string | null,
): FormRuleState {
  const ruleIds = { ...state.ruleIds };
  delete ruleIds[field];
  return {
    ...state,
    values: { ...state.values, [field]: value },
    sources: { ...state.sources, [field]: "user" },
    ruleIds,
  };
}

/** Форма открылась заново (новая операция, копия, правка): непустые поля —
 *  выбор человека, заведение из фильтра страницы — подсказка. Описание —
 *  исходное, иначе условия на описание не видели бы текст копии до правки. */
export function resetFormRuleState(
  values: FormRuleState["values"],
  filterVenueId: string | null,
  description: string,
): { state: FormRuleState; description: string } {
  const source = (value: string | null): FieldSource => (value ? "user" : "empty");
  return {
    state: {
      values,
      sources: {
        category_id: source(values.category_id),
        counterparty_id: source(values.counterparty_id),
        venue_id: filterVenueId && values.venue_id === filterVenueId ? "filter" : source(values.venue_id),
      },
      ruleIds: {},
      filterVenueId,
    },
    description,
  };
}
