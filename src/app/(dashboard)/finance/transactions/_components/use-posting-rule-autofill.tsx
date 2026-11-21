"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";

import { buildRuleContext, type RuleDirectories } from "@/lib/finance/posting-rules/context";
import { evaluatePostingRules } from "@/lib/finance/posting-rules/evaluate";
import {
  applyRulesToForm,
  fillableFrom,
  markUserChoice,
  resetFormRuleState,
  type FormRuleState,
} from "@/lib/finance/posting-rules/form-apply";
import type { PostingRule, PostingRuleActionField } from "@/lib/finance/posting-rules/types";

type Meta = Omit<FormRuleState, "values">;
type Values = FormRuleState["values"];

export type AutofillForm = Values & {
  type: "income" | "expense" | "transfer";
  amount: number | null;
  bank_account_id: string;
  description: string;
};

const FIELDS: PostingRuleActionField[] = ["category_id", "counterparty_id", "venue_id"];
const EMPTY_META: Meta = {
  sources: { category_id: "empty", counterparty_id: "empty", venue_id: "empty" },
  ruleIds: {},
  filterVenueId: null,
};

const valuesOf = (form: AutofillForm): Values => ({
  category_id: form.category_id,
  counterparty_id: form.counterparty_id,
  venue_id: form.venue_id,
});

/**
 * Правила разнесения в форме операции: подставляют пустые статью,
 * контрагента и заведение, пока человек вводит операцию. Выбранное человеком
 * не трогают; заведение из фильтра страницы — подсказка, его правило может
 * заменить. Логика — `src/lib/finance/posting-rules/form-apply.ts`.
 */
export function usePostingRuleAutofill({
  rules,
  directories,
  allowedVenueIds,
  form,
  active,
  onApply,
}: {
  rules: PostingRule[];
  directories: RuleDirectories;
  allowedVenueIds: string[];
  form: AutofillForm;
  /** Форма открыта, её можно править, и правила включены для этого режима. */
  active: boolean;
  onApply: (values: Values) => void;
}) {
  const [meta, setMeta] = useState<Meta>(EMPTY_META);
  const [description, setDescription] = useState(form.description);

  // Описание вводят по буквам — правила пересчитываем после паузы.
  useEffect(() => {
    const timer = setTimeout(() => setDescription(form.description), 300);
    return () => clearTimeout(timer);
  }, [form.description]);

  const ctx = useMemo(
    () => buildRuleContext(directories, allowedVenueIds),
    [directories, allowedVenueIds],
  );
  const enabledRules = useMemo(() => rules.filter((r) => r.enabled), [rules]);

  useEffect(() => {
    if (!active || enabledRules.length === 0) return;
    const state: FormRuleState = { ...meta, values: valuesOf(form) };
    const result = evaluatePostingRules(
      enabledRules,
      {
        type: form.type,
        amount: form.amount,
        bank_account_id: form.bank_account_id || null,
        // Контрагент, подставленный правилом, не должен сам себя подтверждать:
        // правило пересчитывается с нуля.
        counterparty_id: meta.sources.counterparty_id === "rule" ? null : form.counterparty_id,
        description,
      },
      ctx,
      fillableFrom(state),
    );
    const next = applyRulesToForm(state, result);
    const valuesChanged = FIELDS.some((f) => next.values[f] !== state.values[f]);
    const metaChanged =
      FIELDS.some((f) => next.sources[f] !== meta.sources[f] || next.ruleIds[f] !== meta.ruleIds[f]);
    if (valuesChanged) onApply(next.values);
    if (metaChanged) setMeta({ sources: next.sources, ruleIds: next.ruleIds, filterVenueId: next.filterVenueId });
    // onApply — колбэк формы, меняется на каждый рендер; ориентируемся на данные.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    active,
    enabledRules,
    ctx,
    meta,
    form.type,
    form.amount,
    form.bank_account_id,
    form.counterparty_id,
    form.category_id,
    form.venue_id,
    description,
  ]);

  /** Форма открылась заново: непустые поля — выбор человека, заведение из фильтра — подсказка. */
  const reset = useCallback(
    (values: Values, filterVenueId: string | null, initialDescription: string) => {
      const next = resetFormRuleState(values, filterVenueId, initialDescription);
      setDescription(next.description);
      setMeta({ sources: next.state.sources, ruleIds: {}, filterVenueId });
    },
    [],
  );

  /** Человек сам выбрал значение (в том числе «Без …») — правила его больше не трогают. */
  const userPick = useCallback((field: PostingRuleActionField, value: string | null) => {
    setMeta((prev) => {
      const next = markUserChoice({ ...prev, values: { ...EMPTY_VALUES } }, field, value);
      return { sources: next.sources, ruleIds: next.ruleIds, filterVenueId: next.filterVenueId };
    });
  }, []);

  /** Поля очищены не человеком (перевод) — снова пустые для правил. */
  const clear = useCallback((fields: PostingRuleActionField[]) => {
    setMeta((prev) => {
      const sources = { ...prev.sources };
      const ruleIds = { ...prev.ruleIds };
      for (const field of fields) {
        sources[field] = "empty";
        delete ruleIds[field];
      }
      return { ...prev, sources, ruleIds };
    });
  }, []);

  const rulesById = useMemo(
    () => new Map(rules.map((rule, index) => [rule.id, { rule, number: index + 1 }])),
    [rules],
  );

  /** Подпись под полем, заполненным правилом. */
  const hint = (field: PostingRuleActionField): ReactNode => {
    const id = meta.sources[field] === "rule" ? meta.ruleIds[field] : undefined;
    const found = id ? rulesById.get(id) : undefined;
    if (!found) return null;
    const name = found.rule.name ? `«${found.rule.name}»` : `№ ${found.number}`;
    return (
      <>
        По{" "}
        <Link href={`/finance/rules?rule=${found.rule.id}`} className="text-brand hover:underline">
          правилу {name}
        </Link>
      </>
    );
  };

  return { reset, userPick, clear, hint };
}

const EMPTY_VALUES: Values = { category_id: null, counterparty_id: null, venue_id: null };
