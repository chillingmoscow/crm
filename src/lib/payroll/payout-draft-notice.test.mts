import test from "node:test";
import assert from "node:assert/strict";
import { payoutDraftNotice } from "./payout-draft-notice.ts";

test("уведомление о черновике: какая выплата, сколько и кому", () => {
  const n = payoutDraftNotice({ month: "2026-11-01", payoutNo: 2, total: 245000, people: 9 });
  assert.equal(n.title, "Сформирован план: вторая выплата за ноябрь");
  assert.equal(n.body, "К выплате 245 000 ₽ — 9 сотрудникам. Проверьте и утвердите.");
});

test("уведомление о черновике: первая выплата, один сотрудник", () => {
  const n = payoutDraftNotice({ month: "2026-12-01", payoutNo: 1, total: 5000, people: 1 });
  assert.equal(n.title, "Сформирован план: первая выплата за декабрь");
  assert.equal(n.body, "К выплате 5 000 ₽ — 1 сотруднику. Проверьте и утвердите.");
});

test("уведомление о черновике: выдавать некому", () => {
  const n = payoutDraftNotice({ month: "2026-11-01", payoutNo: 1, total: 0, people: 0 });
  assert.equal(n.body, "По расчёту выдавать некому. Проверьте план.");
});
