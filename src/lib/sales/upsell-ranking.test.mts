import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUpsellRanking, rankingGroup } from "./upsell-ranking.ts";

const extra = (amount: number | null) => ({ kind: "extra", label: "Дополнительные продажи", amount, basis: "", source: "" });
const base = { kind: "base", label: "Выход", amount: 2000, basis: "", source: "" };

test("прибавка суммируется по сотруднику внутри подразделения, лидер первым", () => {
  const ranking = buildUpsellRanking([
    { employee_id: "a", components: [base, extra(300)], department_id: "bar" },
    { employee_id: "b", components: [base, extra(500)], department_id: "bar" },
    { employee_id: "a", components: [base, extra(400)], department_id: "bar" },
    { employee_id: "c", components: [base, extra(900)], department_id: "kitchen" },
  ]);
  assert.deepEqual(
    ranking.get("bar")!.map((e) => [e.employeeId, e.amount, e.shifts]),
    [["a", 700, 2], ["b", 500, 1]],
  );
  assert.equal(ranking.get("kitchen")!.length, 1);
});

test("смена без посчитанной прибавки — не ноль, а неизвестная", () => {
  const ranking = buildUpsellRanking([
    { employee_id: "a", components: [extra(300)], department_id: "bar" },
    { employee_id: "a", components: [extra(null)], department_id: "bar" },
  ]);
  assert.deepEqual(ranking.get("bar")![0], { employeeId: "a", amount: 300, shifts: 2, unknown: 1 });
});

test("до правил подразделений прибавка относится к виду по должности", () => {
  assert.equal(rankingGroup({ employee_id: "a", components: [], role: "Бармен" }), "legacy:bar");
  assert.equal(rankingGroup({ employee_id: "a", components: [], role: "Мастер" }), "legacy:masters");
  assert.equal(rankingGroup({ employee_id: "a", components: [], role: "Официант" }), null);
  assert.equal(rankingGroup({ employee_id: "a", components: [], role: "Бармен", department_id: "d1" }), "d1");
});

test("без строки допродаж и месячные начисления в рейтинг не попадают", () => {
  const ranking = buildUpsellRanking([
    { employee_id: "a", components: [base], department_id: "bar" },
    { employee_id: "b", components: [extra(100)], department_id: "bar", kind: "monthly" },
  ]);
  assert.equal(ranking.size, 0);
});
