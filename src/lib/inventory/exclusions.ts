/**
 * Кто исключил строку из управленческих итогов — и переживает ли это решение
 * следующий импорт из Quick Resto.
 *
 * Исключений два вида, и до миграции 231 они были неразличимы:
 *   - разовое, «Не учитывать в этом акте» — решение человека по одной строке;
 *   - правило «Исключать всегда» — действует на позицию во всех актах аккаунта
 *     и применяется автоматически при каждом импорте.
 *
 * Из-за неразличимости правило побеждало всегда: проверяющий возвращал позицию
 * в итоги, управленческая сумма росла, а ближайший импорт молча исключал строку
 * обратно — без единой записи в журнале. Утверждали одно число, замораживали
 * другое.
 *
 * Теперь строка помнит, каким правилом исключена (`exclusion_rule_id`), и
 * помнит явный отказ от правила (`exclusion_rule_dismissed_at`). Правило
 * сильнее автоматики, человек сильнее правила.
 *
 * Без импортов из `@/...`, чтобы node:test мог импортировать файл напрямую
 * (тест-раннер не резолвит alias из tsconfig — см. act-status.ts).
 */

/** Активное правило автоисключения, подходящее к позиции. */
export type ExclusionRuleMatch = {
  id: string;
  reason: string | null;
  created_by: string | null;
  created_at: string;
};

/** Поля исключения на строке акта — то, что уже лежит в базе. */
export type ExclusionFields = {
  excluded_from_totals: boolean;
  exclude_reason: string | null;
  excluded_by: string | null;
  excluded_at: string | null;
  exclusion_rule_id: string | null;
  exclusion_rule_dismissed_at: string | null;
};

/**
 * Строка акта в том виде, в каком её отдаёт база: nullable-поля везде, где
 * колонка допускает NULL.
 */
export type ExistingExclusion = {
  excluded_from_totals?: boolean | null;
  exclude_reason?: string | null;
  excluded_by?: string | null;
  excluded_at?: string | null;
  exclusion_rule_id?: string | null;
  exclusion_rule_dismissed_at?: string | null;
};

/**
 * Состояние исключения строки после импорта из Quick Resto.
 *
 * Приоритеты, сверху вниз:
 *  1. строка в активном пересорте — правило не применяем (сначала пересорт);
 *  2. проверяющий отказался от правила в этом акте — не применяем;
 *  3. правило есть — применяем и запоминаем, каким именно правилом;
 *  4. иначе переносим то, что было (в том числе ручное исключение).
 */
export function resolveExclusionState(input: {
  rule: ExclusionRuleMatch | null;
  inActiveResort: boolean;
  existing: ExistingExclusion | null;
}): ExclusionFields {
  const existing = input.existing ?? null;
  const carryOver: ExclusionFields = {
    excluded_from_totals: Boolean(existing?.excluded_from_totals),
    exclude_reason: existing?.exclude_reason ?? null,
    excluded_by: existing?.excluded_by ?? null,
    excluded_at: existing?.excluded_at ?? null,
    exclusion_rule_id: existing?.exclusion_rule_id ?? null,
    exclusion_rule_dismissed_at: existing?.exclusion_rule_dismissed_at ?? null,
  };

  if (!input.rule) return carryOver;
  if (input.inActiveResort) return carryOver;
  if (existing?.exclusion_rule_dismissed_at != null) return carryOver;

  return {
    excluded_from_totals: true,
    exclude_reason: input.rule.reason,
    excluded_by: input.rule.created_by,
    excluded_at: input.rule.created_at,
    exclusion_rule_id: input.rule.id,
    exclusion_rule_dismissed_at: null,
  };
}

/**
 * Поля строки после ручного решения проверяющего.
 *
 * `excluded = false` на строке, исключённой правилом, — это и есть отказ от
 * правила: ставим отметку, чтобы импорт больше не возвращал исключение.
 * Ручное исключение, наоборот, снимает и происхождение, и отказ: теперь за
 * строку отвечает человек.
 */
export function resolveManualExclusionState(input: {
  excluded: boolean;
  reason: string | null;
  userId: string;
  now: string;
  currentRuleId: string | null;
}): ExclusionFields {
  if (input.excluded) {
    return {
      excluded_from_totals: true,
      exclude_reason: input.reason,
      excluded_by: input.userId,
      excluded_at: input.now,
      exclusion_rule_id: null,
      exclusion_rule_dismissed_at: null,
    };
  }
  return {
    excluded_from_totals: false,
    exclude_reason: null,
    excluded_by: null,
    excluded_at: null,
    exclusion_rule_id: null,
    exclusion_rule_dismissed_at: input.currentRuleId ? input.now : null,
  };
}
