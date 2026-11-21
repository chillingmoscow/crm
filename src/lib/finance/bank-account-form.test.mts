import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bankAccountFormDirty,
  bankAccountFormFromRow,
  bankAccountPayload,
  emptyBankAccountForm,
  validateBankAccountForm,
} from "./bank-account-form.ts";

test("пустая форма: обязательны название и юрлицо", () => {
  const errors = validateBankAccountForm(emptyBankAccountForm());
  assert.deepEqual(Object.keys(errors).sort(), ["legal_entity_id", "name"]);
});

test("расчётный счёт: длины реквизитов и процент эквайринга", () => {
  const form = emptyBankAccountForm({
    type: "checking",
    name: "Р/с",
    legal_entity_id: "le",
    bik: "04452",
    account_number: "4070 2810 0000 0000 0001",
    acquiring_percentage: "120",
  });
  const errors = validateBankAccountForm(form);
  assert.ok(errors.bik);
  assert.equal(errors.account_number, undefined, "пробелы в номере не мешают");
  assert.ok(errors.acquiring_percentage);
});

test("payload: реквизиты чужого вида не уходят, процент с запятой", () => {
  const checking = bankAccountPayload(
    emptyBankAccountForm({
      type: "checking",
      name: "  Р/с  ",
      legal_entity_id: "le",
      bank_name: "Т-Банк",
      account_number: "4070 2810 0000 0000 0001",
      acquiring_percentage: "1,8",
      card_number_last4: "1234",
    }),
  );
  assert.equal(checking.name, "Р/с");
  assert.equal(checking.account_number, "40702810000000000001");
  assert.equal(checking.acquiring_percentage, 1.8);
  assert.equal(checking.card_number_last4, null);
  assert.equal(checking.venue_id, null);

  const cash = bankAccountPayload(
    emptyBankAccountForm({ type: "cash", name: "Касса", legal_entity_id: "le", bank_name: "Т-Банк" }),
  );
  assert.equal(cash.bank_name, null);
});

test("из строки и обратно: без изменений форма не грязная", () => {
  const row = {
    type: "checking" as const,
    name: "Р/с",
    legal_entity_id: "le",
    venue_id: null,
    group_id: null,
    currency: "RUB",
    bank_name: "Т-Банк",
    bik: "044525974",
    account_number: null,
    correspondent_account: null,
    acquiring_percentage: 1.5,
    card_holder: null,
    card_number_last4: null,
    description: null,
  };
  const form = bankAccountFormFromRow(row);
  assert.equal(form.acquiring_percentage, "1,5");
  assert.equal(bankAccountFormDirty(form, { ...form, name: "Р/с " }), false);
  assert.equal(bankAccountFormDirty(form, { ...form, name: "Другой" }), true);
});
