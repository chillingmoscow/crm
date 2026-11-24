import test from "node:test";
import assert from "node:assert/strict";
import {
  initialOfficialDraft,
  isOfficialReviewReason,
  officialMonthName,
  officialPayDate,
  officialResolvePayload,
  officialReviewCopy,
  officialReviewDefaultDate,
  withOfficialGross,
  withOfficialNet,
  type OfficialReviewDraft,
} from "./official-review.ts";
import type { PayrollData } from "./types.ts";

const banks: PayrollData["banks"] = [
  { id: "cash", name: "Касса", legal_entity_id: "le", type: "cash" },
  { id: "chk-1", name: "Т-Банк", legal_entity_id: "le", type: "checking" },
  { id: "chk-2", name: "Сбер", legal_entity_id: "le", type: "checking" },
];

test("месяц словом, год — только если не текущий", () => {
  assert.equal(officialMonthName("2026-11-01", "2026-12-05"), "ноябрь");
  assert.equal(officialMonthName("2025-12-01", "2026-01-05"), "декабрь 2025");
});

test("подписи карточки по причине", () => {
  const base = { employee_name: "Павлов", month: "2026-11-01" };
  const today = "2026-12-05";
  assert.equal(officialReviewCopy({ ...base, reason: "final_month" }, today).title, "Окончательный расчёт: Павлов, ноябрь");
  assert.equal(
    officialReviewCopy({ ...base, reason: "no_bank_account" }, today).title,
    "Выберите расчётный счёт для официальных выплат",
  );
  assert.match(officialReviewCopy({ ...base, reason: "no_bank_account" }, today).hint, /^Павлов, ноябрь\./);
  assert.equal(
    officialReviewCopy({ ...base, reason: "no_category" }, today).title,
    "Нет статьи расхода для официальной выплаты: Павлов",
  );
  assert.equal(officialReviewCopy({ ...base, reason: "inactive" }, today).title, "Проверьте официальное увольнение: Павлов");
  assert.deepEqual(officialReviewCopy({ ...base, month: "2026-10-01", reason: "missed_month" }, "2027-01-05"), {
    title: "Официальная часть не проведена: Павлов, октябрь 2026",
    hint: "Проверьте, выплатила ли бухгалтерия, и проведите выплату или пропустите месяц.",
  });
  // Длинных тире в текстах интерфейса нет.
  for (const reason of ["final_month", "no_bank_account", "no_category", "inactive", "missed_month"] as const) {
    const copy = officialReviewCopy({ ...base, reason }, today);
    assert.ok(!copy.title.includes("—") && !copy.hint.includes("—"), reason);
  }
});

test("причина из базы проверяется", () => {
  assert.ok(isOfficialReviewReason("inactive"));
  assert.ok(isOfficialReviewReason("missed_month"));
  assert.ok(!isOfficialReviewReason("other"));
  assert.ok(!isOfficialReviewReason(null));
});

test("день выплаты — число следующего месяца, через Новый год", () => {
  assert.equal(officialPayDate("2026-11-01", 5), "2026-12-05");
  assert.equal(officialPayDate("2026-12-01", 5), "2027-01-05");
  assert.equal(officialPayDate("2026-11-01", 28), "2026-12-28");
});

test("дата по умолчанию: день проведения, если наступил, иначе сегодня", () => {
  // Крон пришёл 9-го — дата 5-го, как у автоматической выплаты.
  assert.equal(officialReviewDefaultDate("2026-11-01", 5, "2026-12-09"), "2026-12-05");
  assert.equal(officialReviewDefaultDate("2026-11-01", 5, "2026-12-05"), "2026-12-05");
  // День проведения сдвинули позже: вперёд не ставим.
  assert.equal(officialReviewDefaultDate("2026-11-01", 20, "2026-12-09"), "2026-12-09");
});

test("начальные значения: оклад известен — на руки досчитано, счёт из настроек", () => {
  const draft = initialOfficialDraft(
    { gross: 74666.67, month: "2026-11-01", reason: "no_category" },
    { payDay: 5, bankAccountId: "chk-2" },
    banks,
    "2026-12-09",
  );
  assert.deepEqual(draft, {
    net: 64959.67,
    gross: 74666.67,
    grossTouched: false,
    bank_account_id: "chk-2",
    date: "2026-12-05",
  });
});

test("начальные значения: окончательный расчёт пустой; без подходящего счёта в настройках поле счёта пустое", () => {
  const draft = initialOfficialDraft(
    { gross: null, month: "2026-11-01", reason: "final_month" },
    { payDay: 5, bankAccountId: "cash" },
    banks,
    "2026-12-09",
  );
  assert.equal(draft.net, null);
  assert.equal(draft.gross, null);
  // Счёт из настроек не расчётный — первый расчётный не подставляется.
  assert.equal(draft.bank_account_id, "");
  const settingsNone = { payDay: 5, bankAccountId: null };
  assert.equal(
    initialOfficialDraft({ gross: 80000, month: "2026-11-01", reason: "no_bank_account" }, settingsNone, banks, "2026-12-09")
      .bank_account_id,
    "",
  );
  // Карточка «нет счёта» начинается с пустого счёта, даже если его потом выбрали в настройках.
  assert.equal(
    initialOfficialDraft(
      { gross: 80000, month: "2026-11-01", reason: "no_bank_account" },
      { payDay: 5, bankAccountId: "chk-2" },
      banks,
      "2026-12-09",
    ).bank_account_id,
    "",
  );
  assert.equal(
    initialOfficialDraft({ gross: null, month: "2026-11-01", reason: "inactive" }, settingsNone, [], "2026-12-09")
      .bank_account_id,
    "",
  );
});

const empty: OfficialReviewDraft = { net: null, gross: null, grossTouched: false, bank_account_id: "chk-1", date: "2026-12-05" };

test("на руки → оклад с налогом досчитывается, пока его не поправили руками", () => {
  const typed = withOfficialNet(empty, 64959.67);
  assert.equal(typed.gross, 74666.67);
  const manual = withOfficialGross(typed, 74700);
  assert.equal(manual.grossTouched, true);
  // Ручной оклад не перезаписывается новой суммой на руки.
  assert.equal(withOfficialNet(manual, 60000).gross, 74700);
  // Очистили оклад — снова считается от суммы на руки.
  const cleared = withOfficialGross(manual, null);
  assert.equal(cleared.grossTouched, false);
  assert.equal(cleared.gross, 74666.67);
  assert.equal(withOfficialNet(empty, null).gross, null);
});

test("данные проведения и ошибки полей", () => {
  const ok = officialResolvePayload({ id: "m-1" }, { ...withOfficialNet(empty, 64959.67) });
  assert.deepEqual(ok, {
    input: { id: "m-1", gross: 74666.67, net: 64959.67, bank_account_id: "chk-1", date: "2026-12-05" },
    errors: null,
  });
  const bad = officialResolvePayload({ id: "m-1" }, { ...empty, bank_account_id: "", date: "" });
  assert.deepEqual(bad, {
    input: null,
    errors: {
      amount: "Укажите сумму на руки и оклад с налогом",
      bank: "Выберите расчётный счёт",
      date: "Укажите дату выплаты",
    },
  });
  const over = officialResolvePayload({ id: "m-1" }, { ...empty, net: 100, gross: 90, grossTouched: true });
  assert.equal(over.errors?.amount, "Сумма на руки больше оклада с налогом");
});
