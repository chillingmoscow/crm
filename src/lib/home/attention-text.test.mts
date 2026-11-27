import assert from "node:assert/strict";
import test from "node:test";

import {
  attendanceTitle,
  candidatesTitle,
  financeInboxTitle,
  inventoryActsTitle,
  inventoryReviewDetail,
  nextDaysText,
  payoutName,
  peopleDative,
  unassignedShiftsTitle,
} from "./attention-text.ts";

const nb = (s: string) => s.replace(/ /g, " ");

test("склонения пунктов очереди", () => {
  assert.equal(nb(financeInboxTitle(1)), "1 платёж ждёт разбора");
  assert.equal(nb(financeInboxTitle(3)), "3 платежа ждут разбора");
  assert.equal(nb(candidatesTitle(1)), "1 новая анкета кандидатов");
  assert.equal(nb(candidatesTitle(2)), "2 новые анкеты кандидатов");
  assert.equal(nb(candidatesTitle(5)), "5 новых анкет кандидатов");
  assert.equal(nb(unassignedShiftsTitle(4)), "4 смены без сотрудника");
  assert.equal(nb(attendanceTitle(1)), "1 выход ждёт проверки");
  assert.equal(nb(attendanceTitle(11)), "11 выходов ждут проверки");
  assert.equal(nb(inventoryActsTitle(1)), "1 акт инвентаризации не проведён");
  assert.equal(nb(inventoryActsTitle(6)), "6 актов инвентаризации не проведены");
  assert.equal(nb(nextDaysText(3)), "На ближайшие 3 дня");
});

test("inventoryReviewDetail", () => {
  assert.equal(inventoryReviewDetail(0, 3), null);
  assert.equal(inventoryReviewDetail(1, 1), "Акт ждёт проверки");
  assert.equal(inventoryReviewDetail(2, 2), "Все ждут проверки");
  assert.equal(inventoryReviewDetail(2, 6), "Из них 2 ждут проверки");
});

test("выплата и получатели", () => {
  assert.equal(payoutName("2026-11-01", 2), "вторая выплата за ноябрь");
  assert.equal(payoutName("2026-12-01", 1), "первая выплата за декабрь");
  assert.equal(peopleDative(1), "1 сотруднику");
  assert.equal(peopleDative(11), "11 сотрудникам");
  assert.equal(peopleDative(21), "21 сотруднику");
});
