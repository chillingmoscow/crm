import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveExclusionState,
  resolveManualExclusionState,
  type ExclusionRuleMatch,
} from "./exclusions.ts";

const RULE: ExclusionRuleMatch = {
  id: "rule-1",
  reason: "Специи не взвешиваем",
  created_by: "user-1",
  created_at: "2026-08-01T10:00:00Z",
};

test("правило исключает строку и записывает, каким именно правилом", () => {
  const out = resolveExclusionState({ rule: RULE, inActiveResort: false, existing: null });
  assert.equal(out.excluded_from_totals, true);
  assert.equal(out.exclusion_rule_id, "rule-1");
  assert.equal(out.exclude_reason, "Специи не взвешиваем");
  assert.equal(out.exclusion_rule_dismissed_at, null);
});

test("«Учитывать в этом акте» переживает импорт", () => {
  // Регрессия. Проверяющий вернул позицию в итоги, управленческая сумма выросла
  // — а ближайший импорт молча исключал строку обратно, потому что правило
  // применялось безусловно. Утверждали одно число, замораживали другое.
  const afterManualInclude = resolveManualExclusionState({
    excluded: false,
    reason: null,
    userId: "reviewer-1",
    now: "2026-08-28T12:00:00Z",
    currentRuleId: "rule-1",
  });
  assert.equal(afterManualInclude.excluded_from_totals, false);
  assert.equal(
    afterManualInclude.exclusion_rule_dismissed_at,
    "2026-08-28T12:00:00Z",
    "отказ от правила должен быть записан",
  );

  const afterImport = resolveExclusionState({
    rule: RULE,
    inActiveResort: false,
    existing: afterManualInclude,
  });
  assert.equal(afterImport.excluded_from_totals, false, "импорт не должен вернуть исключение");
  assert.equal(afterImport.exclusion_rule_dismissed_at, "2026-08-28T12:00:00Z");
});

test("возврат в итоги строки, исключённой вручную, отказа от правила не ставит", () => {
  const out = resolveManualExclusionState({
    excluded: false,
    reason: null,
    userId: "reviewer-1",
    now: "2026-08-28T12:00:00Z",
    currentRuleId: null,
  });
  assert.equal(out.exclusion_rule_dismissed_at, null);
});

test("ручное исключение снимает происхождение: за строку отвечает человек", () => {
  const out = resolveManualExclusionState({
    excluded: true,
    reason: "Не считали",
    userId: "reviewer-1",
    now: "2026-08-28T12:00:00Z",
    currentRuleId: "rule-1",
  });
  assert.equal(out.exclusion_rule_id, null);
  assert.equal(out.excluded_by, "reviewer-1");
  assert.equal(out.exclusion_rule_dismissed_at, null);
});

test("строку в активном пересорте правило не трогает", () => {
  const out = resolveExclusionState({ rule: RULE, inActiveResort: true, existing: null });
  assert.equal(out.excluded_from_totals, false);
  assert.equal(out.exclusion_rule_id, null);
});

test("без правила переносим состояние строки как есть", () => {
  const existing = {
    excluded_from_totals: true,
    exclude_reason: "Ручное",
    excluded_by: "reviewer-1",
    excluded_at: "2026-08-20T10:00:00Z",
    exclusion_rule_id: null,
    exclusion_rule_dismissed_at: null,
  };
  const out = resolveExclusionState({ rule: null, inActiveResort: false, existing });
  assert.deepEqual(out, existing);
});

test("правило переисключает строку, которую до него исключили вручную", () => {
  // Ручное исключение и правило не конфликтуют: результат один и тот же,
  // меняется только происхождение — теперь за строку отвечает правило.
  const out = resolveExclusionState({
    rule: RULE,
    inActiveResort: false,
    existing: {
      excluded_from_totals: true,
      exclude_reason: "Ручное",
      excluded_by: "reviewer-1",
      excluded_at: "2026-08-20T10:00:00Z",
      exclusion_rule_id: null,
      exclusion_rule_dismissed_at: null,
    },
  });
  assert.equal(out.excluded_from_totals, true);
  assert.equal(out.exclusion_rule_id, "rule-1");
});

test("пустая строка без правила и без истории остаётся неисключённой", () => {
  const out = resolveExclusionState({ rule: null, inActiveResort: false, existing: null });
  assert.equal(out.excluded_from_totals, false);
  assert.equal(out.exclusion_rule_id, null);
  assert.equal(out.exclusion_rule_dismissed_at, null);
});

test("отказ от правила пишется и когда строку до этого исключили вручную", () => {
  // Правило на позицию активно, но проверяющий сначала исключил строку сам —
  // происхождение при этом сбрасывается (за строку отвечает человек). Если при
  // возврате в итоги смотреть только на сохранённое происхождение, отказ не
  // запишется и импорт применит правило заново. Поэтому вызывающий код
  // подставляет ДЕЙСТВУЮЩЕЕ правило (loadActiveExclusionRuleMatcher).
  const manuallyExcluded = resolveManualExclusionState({
    excluded: true,
    reason: "Не считали",
    userId: "reviewer-1",
    now: "2026-08-28T10:00:00Z",
    currentRuleId: RULE.id,
  });
  assert.equal(manuallyExcluded.exclusion_rule_id, null);

  const backToTotals = resolveManualExclusionState({
    excluded: false,
    reason: null,
    userId: "reviewer-1",
    now: "2026-08-28T12:00:00Z",
    currentRuleId: RULE.id, // действующее правило, найденное матчером
  });
  assert.equal(backToTotals.exclusion_rule_dismissed_at, "2026-08-28T12:00:00Z");

  const afterImport = resolveExclusionState({
    rule: RULE,
    inActiveResort: false,
    existing: backToTotals,
  });
  assert.equal(afterImport.excluded_from_totals, false);
});
