import test from "node:test";
import assert from "node:assert/strict";
import { deductionRulesSchema, type DeductionRules } from "./deduction-rules.ts";
import {
  multiDepartmentGroupExists,
  rulesWithShares,
  sharesFromRules,
  sharesTotal,
} from "./department-shares.ts";

const BAR = "00000000-0000-4000-8000-000000000001";
const MGR = "00000000-0000-4000-8000-000000000002";
const HOOKAH = "00000000-0000-4000-8000-000000000003";
const SUPPORT = "00000000-0000-4000-8000-000000000004";
const names = new Map([
  [BAR, "Бар"],
  [MGR, "Менеджеры"],
  [HOOKAH, "Кальяны"],
  [SUPPORT, "Вспомогательный персонал"],
]);
const all = [BAR, MGR, HOOKAH, SUPPORT];

const prod: DeductionRules = {
  enabled: true,
  companyAllowance: 0,
  multiplier: 1,
  ingredientTolerance: 0,
  distribution: "departments",
  split: "once",
  inventoryExclusions: [],
  roleSpecificCategories: [],
  writeoffReasons: [],
  excludedRoleIds: [],
  excludedDepartmentIds: [SUPPORT],
  groups: [
    { id: "bar", name: "Бар", share: 55, roleIds: [], departmentIds: [BAR], categories: ["a"] },
    { id: "mgr", name: "Менеджеры", share: 35, roleIds: [], departmentIds: [MGR], categories: [] },
    { id: "hookah", name: "Кальянные мастера", share: 10, roleIds: [], departmentIds: [HOOKAH], categories: [] },
  ],
};

test("round-trips current prod config", () => {
  const shares = sharesFromRules(prod, all);
  assert.deepEqual(shares, [
    { departmentId: BAR, participates: true, share: 55 },
    { departmentId: MGR, participates: true, share: 35 },
    { departmentId: HOOKAH, participates: true, share: 10 },
    { departmentId: SUPPORT, participates: false, share: 0 },
  ]);
  const next = rulesWithShares(prod, shares, names);
  assert.deepEqual(next.groups, prod.groups);
  assert.deepEqual(next.excludedDepartmentIds, [SUPPORT]);
  assert.doesNotThrow(() => deductionRulesSchema.parse(next));
});

test("keeps group id for existing department", () => {
  const shares = sharesFromRules(prod, all).map((s) =>
    s.departmentId === BAR ? { ...s, share: 50 } : s.departmentId === MGR ? { ...s, share: 40 } : s,
  );
  const next = rulesWithShares(prod, shares, names);
  assert.equal(next.groups.find((g) => g.departmentIds?.[0] === BAR)?.id, "bar");
  assert.equal(next.groups.find((g) => g.departmentIds?.[0] === BAR)?.share, 50);
  assert.deepEqual(next.groups.find((g) => g.id === "bar")?.categories, ["a"]);
});

test("new department gets its own group named after it", () => {
  const shares = sharesFromRules(prod, all).map((s) =>
    s.departmentId === SUPPORT ? { ...s, participates: true, share: 5 } : s.departmentId === BAR ? { ...s, share: 50 } : s,
  );
  const next = rulesWithShares(prod, shares, names);
  const g = next.groups.find((x) => x.departmentIds?.[0] === SUPPORT);
  assert.equal(g?.name, "Вспомогательный персонал");
  assert.deepEqual(g?.roleIds, []);
  assert.deepEqual(g?.categories, []);
  assert.deepEqual(next.excludedDepartmentIds, []);
  assert.doesNotThrow(() => deductionRulesSchema.parse(next));
});

test("non-participating department goes to excludedDepartmentIds", () => {
  const shares = sharesFromRules(prod, all).map((s) =>
    s.departmentId === HOOKAH ? { ...s, participates: false } : s.departmentId === BAR ? { ...s, share: 65 } : s,
  );
  const next = rulesWithShares(prod, shares, names);
  assert.deepEqual(next.excludedDepartmentIds?.sort(), [HOOKAH, SUPPORT].sort());
  assert.equal(next.groups.some((g) => g.departmentIds?.includes(HOOKAH)), false);
  assert.doesNotThrow(() => deductionRulesSchema.parse(next));
});

test("zero share is not written to groups", () => {
  const shares = sharesFromRules(prod, all).map((s) =>
    s.departmentId === HOOKAH ? { ...s, share: 0 } : s.departmentId === BAR ? { ...s, share: 65 } : s,
  );
  const next = rulesWithShares(prod, shares, names);
  assert.equal(next.groups.length, 2);
});

test("throws when a group holds several departments", () => {
  const multi: DeductionRules = {
    ...prod,
    groups: [{ ...prod.groups[0], departmentIds: [BAR, MGR], share: 90 }, prod.groups[2]],
  };
  assert.equal(multiDepartmentGroupExists(multi), true);
  assert.throws(
    () => rulesWithShares(multi, sharesFromRules(multi, all), names),
    /Группа объединяет несколько подразделений/,
  );
});

test("sharesTotal sums participating only", () => {
  assert.equal(
    sharesTotal([
      { departmentId: BAR, participates: true, share: 55.5 },
      { departmentId: MGR, participates: false, share: 30 },
      { departmentId: HOOKAH, participates: true, share: 10 },
    ]),
    65.5,
  );
});
