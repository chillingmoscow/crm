import { test } from "node:test";
import assert from "node:assert/strict";
import { slimOverviewAccrual } from "./accrual-slim.ts";
import type { Accrual } from "./types.ts";

test("the overview keeps what its screens read and drops the calculation inputs", () => {
  const accrual = {
    id: "a", salary: 100, components: [],
    calculation_snapshot: {
      kind: "shift", source: "quickresto", position_name: "Бармен", role: "Бармен",
      legacy: { total: 1 }, model: { id: "m", rates: [1, 2, 3] },
      rule: { big: true }, extra_rule: { big: true }, monthly_rule: { big: true },
    },
  } as unknown as Accrual;
  const slim = slimOverviewAccrual(accrual);
  assert.deepEqual(slim.calculation_snapshot, {
    kind: "shift", source: "quickresto", position_name: "Бармен", role: "Бармен",
    legacy: { total: 1 }, model: { id: "m" },
  });
  assert.equal(slim.salary, 100);
  assert.ok("rule" in accrual.calculation_snapshot, "the source row is not mutated");
});

test("a snapshot without a model stays without one", () => {
  const slim = slimOverviewAccrual({ calculation_snapshot: { kind: "monthly" } } as unknown as Accrual);
  assert.deepEqual(slim.calculation_snapshot, { kind: "monthly" });
});
