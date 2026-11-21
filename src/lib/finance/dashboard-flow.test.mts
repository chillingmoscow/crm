import { test } from "node:test";
import assert from "node:assert/strict";

import { aggregateFlow, type FlowRow } from "./dashboard-flow.ts";

const rows: FlowRow[] = [
  { type: "income", amount: "1000.50", category_id: "sales" },
  { type: "income", amount: 500, category_id: null },
  { type: "expense", amount: "300", category_id: "rent" },
  { type: "expense", amount: 200, category_id: "rent" },
  { type: "expense", amount: 100, category_id: "food" },
  { type: "expense", amount: 50, category_id: null },
  { type: "expense", amount: 25, category_id: "misc" },
  { type: "transfer", amount: 9999, category_id: null },
];

test("доходы, расходы и поток без переводов, счётчики раздельно", () => {
  const { summary } = aggregateFlow(rows);
  assert.equal(summary.income, 1500.5);
  assert.equal(summary.expense, 675);
  assert.equal(summary.net, 825.5);
  assert.equal(summary.incomeCount, 2);
  assert.equal(summary.expenseCount, 5);
});

test("доля статьи считается от всех расходов периода, а не от показанных", () => {
  const { top, rest } = aggregateFlow(rows, 2);
  assert.deepEqual(
    top.map((c) => [c.category_id, c.amount, c.count]),
    [
      ["rent", 500, 2],
      ["food", 100, 1],
    ],
  );
  assert.equal(top[0].share, 500 / 675);
  assert.deepEqual(rest, { amount: 75, count: 2, categories: 2, share: 75 / 675 });
  const shares = top.reduce((a, c) => a + c.share, 0) + (rest?.share ?? 0);
  assert.ok(Math.abs(shares - 1) < 1e-9);
});

test("без «остальных», когда все статьи поместились", () => {
  assert.equal(aggregateFlow(rows, 10).rest, null);
});

test("одна лишняя статья показывается сама, а не «Остальные · 1 статья»", () => {
  const flow = aggregateFlow(rows, 3);
  assert.equal(flow.rest, null);
  assert.equal(flow.top.length, 4);
});

test("пустой период — нули и доли без деления на ноль", () => {
  const flow = aggregateFlow([]);
  assert.deepEqual(flow.summary, { income: 0, expense: 0, net: 0, incomeCount: 0, expenseCount: 0 });
  assert.deepEqual(flow.top, []);
  assert.equal(flow.rest, null);
});
