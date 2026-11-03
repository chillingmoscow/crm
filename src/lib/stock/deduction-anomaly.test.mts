import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANOMALY_MIN_EXCESS,
  ANOMALY_RATIO,
  detectDeductionAnomaly,
  medianOf,
} from "./deduction-anomaly.ts";
import { postMonthlyDeduction, type PostDeps } from "./deduction-posting.ts";
import type { MonthlySnapshot } from "./monthly-snapshot.ts";
import { deductionRulesSchema } from "./deduction-rules.ts";

const H = (month: string, total: number) => ({ month, total });
const THREE = [H("2026-07-01", 5000), H("2026-08-01", 6000), H("2026-09-01", 7000)];

test("два месяца истории не дают уведомления", () => {
  const v = detectDeductionAnomaly({
    month: "2026-10-01",
    current: 999_999,
    history: [H("2026-08-01", 6000), H("2026-09-01", 7000)],
  });
  assert.deepEqual(v, { kind: "not_enough_history", months: 2 });
});

test("месяц без истории и месяцы не раньше текущего не считаются историей", () => {
  assert.equal(detectDeductionAnomaly({ month: "2026-10-01", current: 1e6, history: [] }).kind, "not_enough_history");
  // Сам месяц и более поздние в историю не входят: остаётся два.
  const v = detectDeductionAnomaly({
    month: "2026-10-01",
    current: 1e6,
    history: [H("2026-08-01", 1), H("2026-09-01", 1), H("2026-10-01", 1), H("2026-11-01", 1)],
  });
  assert.deepEqual(v, { kind: "not_enough_history", months: 2 });
});

test("превышение порога даёт уведомление", () => {
  const v = detectDeductionAnomaly({ month: "2026-10-01", current: 20_000, history: THREE });
  assert.equal(v.kind, "anomaly");
  if (v.kind === "anomaly") {
    assert.equal(v.median, 6000);
    assert.equal(v.current, 20_000);
    assert.equal(v.ratio, 3.33);
  }
});

test("порог: ровно ratio * медиана - ещё норма, чуть выше - уже тревога", () => {
  const edge = 6000 * ANOMALY_RATIO;
  assert.equal(detectDeductionAnomaly({ month: "2026-10-01", current: edge, history: THREE }).kind, "normal");
  assert.equal(detectDeductionAnomaly({ month: "2026-10-01", current: edge + 0.01, history: THREE }).kind, "anomaly");
});

test("малая сумма над нулевой медианой - шум, крупная - тревога", () => {
  const zero = [H("2026-07-01", 0), H("2026-08-01", 0), H("2026-09-01", 0)];
  assert.equal(detectDeductionAnomaly({ month: "2026-10-01", current: ANOMALY_MIN_EXCESS - 1, history: zero }).kind, "normal");
  const v = detectDeductionAnomaly({ month: "2026-10-01", current: ANOMALY_MIN_EXCESS + 500, history: zero });
  assert.equal(v.kind, "anomaly");
  if (v.kind === "anomaly") assert.equal(v.ratio, null);
});

test("берутся три самых свежих месяца, порядок входа не важен, месяц не считается дважды", () => {
  const v = detectDeductionAnomaly({
    month: "2026-10-01",
    current: 20_000,
    history: [H("2026-09-01", 7000), H("2026-01-01", 1_000_000), H("2026-07-01", 5000), H("2026-08-01", 6000), H("2026-09-01", 7000)],
  });
  assert.equal(v.kind, "anomaly");
  if (v.kind === "anomaly") assert.equal(v.median, 6000);
});

test("медиана", () => {
  assert.equal(medianOf([3, 1, 2]), 2);
  assert.equal(medianOf([1, 2]), 1.5);
  assert.throws(() => medianOf([]));
});

// ── Уведомление не отменяет постановку ──────────────────────

const rules = deductionRulesSchema.parse({
  enabled: true,
  companyAllowance: 0,
  multiplier: 1,
  ingredientTolerance: 0,
  distribution: "shifts",
  split: "once",
  inventoryExclusions: [],
  roleSpecificCategories: [],
  writeoffReasons: [],
  excludedRoleIds: [],
  groups: [],
});
const ROLE = "11111111-1111-4111-8111-111111111111";
const E1 = "aaaaaaaa-0000-4000-8000-000000000001";
const E2 = "aaaaaaaa-0000-4000-8000-000000000002";

const snapshot = (over: Partial<MonthlySnapshot> = {}): MonthlySnapshot => ({
  sources: [{ pool: "shared", key: null, amount: -20_000, sourceRef: "inventory:a" }],
  config: rules,
  weights: [
    { employeeId: E1, roleId: ROLE, departmentId: null, shifts: 1 },
    { employeeId: E2, roleId: ROLE, departmentId: null, shifts: 1 },
  ],
  unresolved: [],
  ruleVersionId: "bbbbbbbb-0000-4000-8000-000000000001",
  capturedAt: "2026-11-03T10:00:00.000Z",
  storeBindings: [],
  venueId: "dddddddd-0000-4000-8000-000000000001",
  month: "2026-10-01",
  timezone: "Europe/Moscow",
  payrollDayStartHour: 0,
  dataProblems: { undatedActs: [] },
  ...over,
});

function makeDeps(over: Partial<PostDeps> & { snap?: MonthlySnapshot } = {}) {
  const calls = { post: 0, notify: 0, history: 0 };
  const deps: PostDeps = {
    buildSnapshot: async () => over.snap ?? snapshot(),
    loadHistory: async () => {
      calls.history++;
      return THREE;
    },
    post: async (args) => {
      calls.post++;
      return { posted: true, unchanged: false, replayed: false, snapshotId: args.snapshot.id, reversed: 0, targetMonth: args.month, displaced: false, lines: [], inactive: [] };
    },
    reverse: async () => ({ reversed: 0 }),
    notifyAnomaly: async () => {
      calls.notify++;
    },
    newId: () => "cccccccc-0000-4000-8000-000000000001",
    ...over,
  };
  return { deps, calls };
}

test("уведомление не отменяет постановку строки", async () => {
  const { deps, calls } = makeDeps();
  const out = await postMonthlyDeduction(deps);
  assert.equal(out.state, "ready");
  assert.equal(calls.post, 1, "строка поставлена");
  assert.equal(calls.notify, 1, "и уведомление ушло");
  if (out.state === "ready") assert.equal(out.anomaly?.kind, "anomaly");
});

test("упавшее уведомление не откатывает и не прячет постановку", async () => {
  const { deps, calls } = makeDeps({
    notifyAnomaly: async () => {
      throw new Error("нет связи");
    },
  });
  const out = await postMonthlyDeduction(deps);
  assert.equal(calls.post, 1);
  assert.equal(out.state, "ready");
  if (out.state === "ready") {
    assert.equal(out.posted, true);
    assert.match(out.notifyError ?? "", /нет связи/);
  }
});

test("пересчёт без изменений не шлёт уведомление повторно", async () => {
  const { deps, calls } = makeDeps({
    post: async () => ({ posted: false, unchanged: true, replayed: false, snapshotId: null, reversed: 0, targetMonth: "2026-10-01", displaced: false, lines: [], inactive: [] }),
  });
  await postMonthlyDeduction(deps);
  assert.equal(calls.notify, 0);
});

test("норма и мало истории - постановка есть, уведомления нет", async () => {
  const normal = makeDeps({ snap: snapshot({ sources: [{ pool: "shared", key: null, amount: -7000, sourceRef: "inventory:a" }] }) });
  await postMonthlyDeduction(normal.deps);
  assert.equal(normal.calls.post, 1);
  assert.equal(normal.calls.notify, 0);

  const short = makeDeps({ loadHistory: async () => THREE.slice(0, 2) });
  await postMonthlyDeduction(short.deps);
  assert.equal(short.calls.post, 1);
  assert.equal(short.calls.notify, 0);
});

test("упавшее чтение истории не мешает постановке", async () => {
  const { deps, calls } = makeDeps({
    loadHistory: async () => {
      throw new Error("история недоступна");
    },
  });
  const out = await postMonthlyDeduction(deps);
  assert.equal(calls.post, 1);
  assert.equal(out.state, "ready");
});
