"use client";

import type { ReactNode } from "react";

import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import { Textarea } from "@/components/ui/textarea";
import {
  BANK_ACCOUNT_TYPE_LABELS,
  BANK_ACCOUNT_TYPE_OPTIONS,
  hasBankDetails,
} from "@/lib/finance/bank-account-labels";
import type {
  BankAccountFormErrors,
  BankAccountFormState,
} from "@/lib/finance/bank-account-form";
import type { BankAccountGroupRow } from "@/types/finance";
import type { BankAccountType } from "@/types/database";

export type BankAccountLegalEntityOption = {
  id: string;
  name: string;
  short_name?: string | null;
};
export type BankAccountVenueOption = { id: string; name: string };

const CURRENCY_OPTIONS = [
  { value: "RUB", label: "Рубль, RUB" },
  { value: "USD", label: "Доллар США, USD" },
  { value: "EUR", label: "Евро, EUR" },
];

/**
 * Поля счёта, сгруппированные по разделам. Обёртку раздела задаёт вызывающий:
 * в панели создания это `DrawerSection`, в карточке — `ProfileSection`.
 * Вид и валюта выбираются только при создании: по ним уже посчитаны
 * операции и баланс.
 */
export function BankAccountFields({
  idPrefix,
  mode,
  form,
  onChange,
  errors,
  readOnly = false,
  legalEntities,
  venues,
  groups,
  section,
}: {
  idPrefix: string;
  mode: "create" | "edit";
  form: BankAccountFormState;
  onChange: (patch: Partial<BankAccountFormState>) => void;
  errors: BankAccountFormErrors;
  readOnly?: boolean;
  legalEntities: BankAccountLegalEntityOption[];
  venues: BankAccountVenueOption[];
  groups: BankAccountGroupRow[];
  section: (key: string, title: string, children: ReactNode) => ReactNode;
}) {
  const id = (key: string) => `${idPrefix}-${key}`;
  const legalEntityOptions = legalEntities.map((le) => ({
    value: le.id,
    label: le.short_name?.trim() || le.name,
  }));
  const venueOptions = [
    { value: "", label: "Без заведения" },
    ...venues.map((v) => ({ value: v.id, label: v.name })),
  ];
  const groupOptions = [
    { value: "", label: "Без группы" },
    ...groups.map((g) => ({ value: g.id, label: g.name })),
  ];
  // Текущее значение обязано быть среди вариантов, иначе выбор покажет пустоту.
  if (form.legal_entity_id && !legalEntityOptions.some((o) => o.value === form.legal_entity_id))
    legalEntityOptions.push({ value: form.legal_entity_id, label: "Юрлицо в архиве" });
  if (form.venue_id && !venueOptions.some((o) => o.value === form.venue_id))
    venueOptions.push({ value: form.venue_id, label: "Заведение в архиве" });
  const currencyOptions = CURRENCY_OPTIONS.some((o) => o.value === form.currency)
    ? CURRENCY_OPTIONS
    : [...CURRENCY_OPTIONS, { value: form.currency, label: form.currency }];

  const text = (
    key: keyof BankAccountFormState,
    label: string,
    opts: { required?: boolean; placeholder?: string; inputMode?: "numeric" | "decimal"; maxLength?: number; hint?: string } = {},
  ) => (
    <Field id={id(key)} label={label} required={opts.required} error={errors[key]} hint={opts.hint}>
      {(control) => (
        <Input
          {...control}
          value={form[key]}
          onChange={(e) => onChange({ [key]: e.target.value })}
          disabled={readOnly}
          placeholder={opts.placeholder}
          inputMode={opts.inputMode}
          maxLength={opts.maxLength}
        />
      )}
    </Field>
  );

  const typeLabel = BANK_ACCOUNT_TYPE_LABELS[form.type];

  return (
    <>
      {section(
        "main",
        "Основное",
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            {text("name", "Название", {
              required: true,
              placeholder:
                form.type === "cash"
                  ? "Касса бара"
                  : form.type === "checking"
                    ? "Расчётный счёт в Т-Банке"
                    : undefined,
            })}
          </div>
          <Field id={id("type")} label="Вид" required={mode === "create"}>
            {(control) =>
              mode === "create" ? (
                <OptionSelect
                  {...control}
                  value={form.type}
                  onValueChange={(v) => onChange({ type: v as BankAccountType })}
                  options={BANK_ACCOUNT_TYPE_OPTIONS}
                  disabled={readOnly}
                />
              ) : (
                <Input {...control} value={typeLabel} readOnly data-tip="Вид счёта после создания не меняется" />
              )
            }
          </Field>
          <Field id={id("currency")} label="Валюта">
            {(control) =>
              mode === "create" ? (
                <OptionSelect
                  {...control}
                  value={form.currency}
                  onValueChange={(v) => onChange({ currency: v })}
                  options={currencyOptions}
                  disabled={readOnly}
                />
              ) : (
                <Input
                  {...control}
                  value={currencyOptions.find((o) => o.value === form.currency)?.label ?? form.currency}
                  readOnly
                  data-tip="Валюта после создания не меняется"
                />
              )
            }
          </Field>
          <Field id={id("legal_entity_id")} label="Юрлицо" required error={errors.legal_entity_id}>
            {(control) => (
              <OptionSelect
                {...control}
                value={form.legal_entity_id}
                onValueChange={(v) => onChange({ legal_entity_id: v })}
                options={legalEntityOptions}
                placeholder="Выберите юрлицо"
                disabled={readOnly}
              />
            )}
          </Field>
          <Field id={id("venue_id")} label="Заведение">
            {(control) => (
              <OptionSelect
                {...control}
                value={form.venue_id}
                onValueChange={(v) => onChange({ venue_id: v })}
                options={venueOptions}
                disabled={readOnly}
              />
            )}
          </Field>
          {groups.length > 0 || form.group_id ? (
            <div className="sm:col-span-2">
              <Field id={id("group_id")} label="Группа">
                {(control) => (
                  <OptionSelect
                    {...control}
                    value={form.group_id}
                    onValueChange={(v) => onChange({ group_id: v })}
                    options={groupOptions}
                    disabled={readOnly}
                  />
                )}
              </Field>
            </div>
          ) : null}
        </div>,
      )}

      {hasBankDetails(form.type)
        ? section(
            "bank",
            form.type === "checking" ? "Банковские реквизиты" : "Карта",
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">{text("bank_name", "Банк", { placeholder: "Т-Банк" })}</div>
              {form.type === "checking" ? (
                <>
                  {text("account_number", "Номер счёта", { inputMode: "numeric", maxLength: 24 })}
                  {text("bik", "БИК", { inputMode: "numeric", maxLength: 11 })}
                  {text("correspondent_account", "Корреспондентский счёт", { inputMode: "numeric", maxLength: 24 })}
                  {text("acquiring_percentage", "Эквайринг, %", {
                    inputMode: "decimal",
                    maxLength: 6,
                    placeholder: "1,8",
                  })}
                </>
              ) : (
                <>
                  {text("card_holder", "Держатель карты")}
                  {text("card_number_last4", "Последние 4 цифры", {
                    inputMode: "numeric",
                    maxLength: 4,
                    placeholder: "1234",
                  })}
                </>
              )}
            </div>,
          )
        : null}

      {section(
        "description",
        "Описание",
        <Field id={id("description")} label="Для чего этот счёт">
          {(control) => (
            <Textarea
              {...control}
              value={form.description}
              onChange={(e) => onChange({ description: e.target.value })}
              disabled={readOnly}
              rows={3}
              placeholder="Например, наличные смены бара"
            />
          )}
        </Field>,
      )}
    </>
  );
}
