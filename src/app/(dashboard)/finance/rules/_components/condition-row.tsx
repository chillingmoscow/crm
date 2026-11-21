"use client";

import { X } from "lucide-react";

import { AmountInput } from "@/components/finance/amount-input";
import type { ComboboxOption } from "@/components/finance/combobox";
import { MultiCombobox } from "@/components/finance/multi-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import { CONDITION_FIELD_LABELS } from "@/lib/finance/posting-rules/input";
import type {
  PostingRuleCondition,
  PostingRuleConditionField,
} from "@/lib/finance/posting-rules/types";

export type ConditionOptions = {
  counterparties: ComboboxOption[];
  counterpartyGroups: ComboboxOption[];
  bankAccounts: ComboboxOption[];
};

const FIELD_ORDER: PostingRuleConditionField[] = [
  "counterparty",
  "counterparty_group",
  "counterparty_inn",
  "bank_account",
  "type",
  "amount",
  "description",
];

/** Новое условие на поле — с пустым значением и первым оператором. */
export function emptyCondition(field: PostingRuleConditionField): PostingRuleCondition {
  switch (field) {
    case "counterparty":
      return { field, op: "in", ids: [] };
    case "counterparty_group":
      return { field, op: "in", ids: [] };
    case "counterparty_inn":
      return { field, op: "eq", value: "" };
    case "bank_account":
      return { field, op: "in", ids: [] };
    case "type":
      return { field, op: "eq", value: "expense" };
    case "amount":
      return { field, op: "between", min: null, max: null };
    case "description":
      return { field, op: "contains", value: "" };
  }
}

/** Первое поле, которого ещё нет в правиле («Описание» можно повторять). */
export function nextFreeField(conditions: PostingRuleCondition[]): PostingRuleConditionField {
  const used = new Set(conditions.map((c) => c.field));
  return FIELD_ORDER.find((f) => !used.has(f)) ?? "description";
}

export function ConditionRow({
  condition,
  index,
  usedFields,
  options,
  disabled,
  canRemove,
  onChange,
  onRemove,
}: {
  condition: PostingRuleCondition;
  index: number;
  usedFields: Set<PostingRuleConditionField>;
  options: ConditionOptions;
  disabled: boolean;
  canRemove: boolean;
  onChange: (next: PostingRuleCondition) => void;
  onRemove: () => void;
}) {
  const label = CONDITION_FIELD_LABELS[condition.field];
  const fieldOptions = FIELD_ORDER.map((field) => ({
    value: field,
    label: CONDITION_FIELD_LABELS[field],
    disabled: field !== condition.field && field !== "description" && usedFields.has(field),
  }));

  return (
    <li className="space-y-2">
      <div className="flex items-center gap-2">
        <OptionSelect
          value={condition.field}
          onValueChange={(field) => onChange(emptyCondition(field as PostingRuleConditionField))}
          options={fieldOptions}
          disabled={disabled}
          aria-label={`Поле условия ${index + 1}`}
          className="flex-1"
        />
        {canRemove && !disabled ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground"
            onClick={onRemove}
            aria-label={`Убрать условие «${label}»`}
          >
            <X className="size-4" />
          </Button>
        ) : null}
      </div>
      <ConditionValue condition={condition} options={options} disabled={disabled} onChange={onChange} />
    </li>
  );
}

function ConditionValue({
  condition,
  options,
  disabled,
  onChange,
}: {
  condition: PostingRuleCondition;
  options: ConditionOptions;
  disabled: boolean;
  onChange: (next: PostingRuleCondition) => void;
}) {
  switch (condition.field) {
    case "counterparty":
      return (
        <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <OptionSelect
            value={condition.op}
            onValueChange={(op) => onChange({ ...condition, op: op as "in" | "not_in" })}
            options={[
              { value: "in", label: "один из" },
              { value: "not_in", label: "ни один из" },
            ]}
            disabled={disabled}
            aria-label="Как сравнивать контрагента"
          />
          <MultiCombobox
            options={options.counterparties}
            values={condition.ids}
            onChange={(ids) => onChange({ ...condition, ids })}
            placeholder="Выберите контрагентов"
            searchPlaceholder="Название или ИНН"
            emptyText="Контрагент не найден"
            disabled={disabled}
            ariaLabel="Контрагенты"
          />
        </div>
      );
    case "counterparty_group":
      return (
        <MultiCombobox
          options={options.counterpartyGroups}
          values={condition.ids}
          onChange={(ids) => onChange({ ...condition, ids })}
          placeholder="Выберите группы"
          emptyText="Группа не найдена"
          disabled={disabled}
          ariaLabel="Группы контрагентов"
        />
      );
    case "bank_account":
      return (
        <MultiCombobox
          options={options.bankAccounts}
          values={condition.ids}
          onChange={(ids) => onChange({ ...condition, ids })}
          placeholder="Выберите счета"
          emptyText="Счёт не найден"
          disabled={disabled}
          ariaLabel="Счета"
        />
      );
    case "counterparty_inn":
      return (
        <Input
          value={condition.value}
          onChange={(event) => onChange({ ...condition, value: event.target.value })}
          inputMode="numeric"
          maxLength={12}
          placeholder="10 или 12 цифр"
          disabled={disabled}
          aria-label="ИНН контрагента"
        />
      );
    case "type":
      return (
        <OptionSelect
          value={condition.value}
          onValueChange={(value) => onChange({ ...condition, value: value as "income" | "expense" })}
          options={[
            { value: "expense", label: "Расход" },
            { value: "income", label: "Приход" },
          ]}
          disabled={disabled}
          aria-label="Тип операции"
        />
      );
    case "amount":
      return (
        <div className="grid grid-cols-2 gap-2">
          <AmountInput
            value={condition.min}
            onChange={(min) => onChange({ ...condition, min })}
            placeholder="от"
            disabled={disabled}
          />
          <AmountInput
            value={condition.max}
            onChange={(max) => onChange({ ...condition, max })}
            placeholder="до"
            disabled={disabled}
          />
        </div>
      );
    case "description":
      return (
        <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <OptionSelect
            value={condition.op}
            onValueChange={(op) =>
              onChange({ ...condition, op: op as "contains" | "not_contains" | "eq" | "starts_with" })
            }
            options={[
              { value: "contains", label: "содержит" },
              { value: "not_contains", label: "не содержит" },
              { value: "starts_with", label: "начинается с" },
              { value: "eq", label: "равно" },
            ]}
            disabled={disabled}
            aria-label="Как сравнивать описание"
          />
          <Input
            value={condition.value}
            onChange={(event) => onChange({ ...condition, value: event.target.value })}
            placeholder="Текст"
            maxLength={500}
            disabled={disabled}
            aria-label="Текст описания"
          />
        </div>
      );
  }
}
