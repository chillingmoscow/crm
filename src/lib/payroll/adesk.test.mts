import test from "node:test";
import assert from "node:assert/strict";
import {
  CreatedMismatchError,
  adeskRelatedDate,
  decideBeforeCreate,
  verifyCreated,
  type AdeskExpense,
  type AdeskTransaction,
} from "./adesk.ts";

const expense: AdeskExpense = {
  date: "2026-11-02",
  relatedDate: "2026-10-31",
  amount: 30000,
  bankAccount: 46913,
  category: 274942,
  project: 268648,
  description: "Никита Волков",
};
const tx = (over: Partial<AdeskTransaction> = {}): AdeskTransaction => ({
  id: 100,
  amount: "30000.00",
  description: "Никита Волков",
  type: 2,
  dateIso: "2026-11-02",
  relatedDateIso: "2026-10-31",
  bankAccount: { id: 46913 },
  category: { id: 274942 },
  project: { id: 268648 },
  ...over,
});

test("дата начисления: выплата внутри месяца — 16-е", () => {
  assert.equal(adeskRelatedDate("2026-10-01", "2026-10-24"), "2026-10-16");
  assert.equal(adeskRelatedDate("2026-10-01", "2026-10-31"), "2026-10-16");
  assert.equal(adeskRelatedDate("2026-10-01", "2026-10-05"), "2026-10-16");
});

test("дата начисления: выплата после месяца — последний день месяца", () => {
  assert.equal(adeskRelatedDate("2026-10-01", "2026-11-02"), "2026-10-31");
  assert.equal(adeskRelatedDate("2026-09-01", "2026-10-25"), "2026-09-30");
  assert.equal(adeskRelatedDate("2027-02-01", "2027-03-05"), "2027-02-28");
  assert.equal(adeskRelatedDate("2028-02-01", "2028-03-05"), "2028-02-29");
});

test("дата начисления: некорректный месяц", () => {
  assert.throws(() => adeskRelatedDate("2026-10-15", "2026-11-02"));
});

test("нет операции — создаём", () => {
  assert.deepEqual(decideBeforeCreate([tx({ amount: 25000 }), tx({ id: 2, description: "Другой" })], expense, null), {
    kind: "create",
  });
});

test("ровно одна такая операция — привязываем без повторного создания", () => {
  assert.deepEqual(decideBeforeCreate([tx()], expense, null), { kind: "link", id: 100 });
});

test("две одинаковые операции — на проверку", () => {
  const d = decideBeforeCreate([tx(), tx({ id: 101 })], expense, null);
  assert.equal(d.kind, "review");
});

test("уже привязанная операция остаётся, даже если есть похожая", () => {
  assert.deepEqual(decideBeforeCreate([tx(), tx({ id: 101 })], expense, 101), { kind: "link", id: 101 });
});

test("банковский импорт на имя сотрудника блокирует создание", () => {
  const imported = tx({ id: 7, description: "Перевод", category: null, project: null, contractor: { name: "ВОЛКОВ НИКИТА ИВАНОВИЧ" } });
  const d = decideBeforeCreate([imported], expense, null);
  assert.equal(d.kind, "review");
});

test("однофамилец не блокирует", () => {
  const imported = tx({ id: 7, description: "Перевод", category: null, contractor: { name: "Волков Сергей" } });
  assert.deepEqual(decideBeforeCreate([imported], expense, null), { kind: "create" });
});

test("та же выплата в другом проекте не привязывается и не дублируется", () => {
  assert.equal(decideBeforeCreate([tx({ project: { id: 1 } })], expense, null).kind, "review");
  assert.equal(decideBeforeCreate([tx({ relatedDateIso: "2026-10-16" })], expense, null).kind, "review");
  assert.equal(decideBeforeCreate([tx({ project: { id: 1 } })], expense, 100).kind, "review");
});

test("несовпавшая созданная операция сохраняет номер", () => {
  assert.throws(() => verifyCreated(tx({ project: { id: 1 } }), expense), (e: unknown) => e instanceof CreatedMismatchError && e.adeskId === 100);
});

test("созданная операция сверяется со всеми полями", () => {
  assert.equal(verifyCreated(tx(), expense), 100);
  assert.throws(() => verifyCreated(tx({ relatedDateIso: "2026-10-16" }), expense));
  assert.throws(() => verifyCreated(tx({ project: { id: 1 } }), expense));
  assert.throws(() => verifyCreated(undefined, expense));
});
