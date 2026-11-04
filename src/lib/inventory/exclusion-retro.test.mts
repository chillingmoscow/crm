import assert from "node:assert/strict";
import test from "node:test";

import {
  isProtectedMonth,
  planApply,
  planRemove,
  runRulesIsolated,
  settledFinalizedLines,
  type RetroLine,
} from "./exclusion-retro.ts";

const RULE = "rule-1";

function line(p: Partial<RetroLine> & { id: string }): RetroLine {
  return {
    documentId: "doc-1",
    excluded: false,
    ruleId: null,
    dismissedAt: null,
    inActiveResort: false,
    finalized: false,
    finalizedExcluded: null,
    ...p,
  };
}

test("apply excludes a plain counted line", () => {
  assert.deepEqual(planApply(RULE, [line({ id: "a" })], new Set()), [
    { id: "a", documentId: "doc-1", exclude: true, finalized: false, snapshotChanged: false },
  ]);
});

test("apply skips line dismissed from rule", () => {
  const lines = [line({ id: "a", dismissedAt: "2026-10-01T00:00:00Z" })];
  assert.deepEqual(planApply(RULE, lines, new Set()), []);
});

test("apply skips manually excluded line", () => {
  const lines = [line({ id: "a", excluded: true, ruleId: null })];
  assert.deepEqual(planApply(RULE, lines, new Set()), []);
});

test("apply skips line in active resort", () => {
  const lines = [line({ id: "a", inActiveResort: true })];
  assert.deepEqual(planApply(RULE, lines, new Set()), []);
});

test("apply skips locked documents", () => {
  const lines = [line({ id: "a", documentId: "locked" }), line({ id: "b", documentId: "open" })];
  assert.deepEqual(planApply(RULE, lines, new Set(["locked"])), [
    { id: "b", documentId: "open", exclude: true, finalized: false, snapshotChanged: false },
  ]);
});

test("apply marks finalized line with finalized=true", () => {
  const lines = [line({ id: "a", finalized: true })];
  assert.deepEqual(planApply(RULE, lines, new Set()), [
    { id: "a", documentId: "doc-1", exclude: true, finalized: true, snapshotChanged: true },
  ]);
});

test("apply is idempotent for line already excluded by this rule", () => {
  const lines = [line({ id: "a", excluded: true, ruleId: RULE })];
  assert.deepEqual(planApply(RULE, lines, new Set()), []);
});

test("apply re-attributes a line excluded by another (losing) rule", () => {
  const lines = [line({ id: "a", excluded: true, ruleId: "group-rule" })];
  assert.deepEqual(planApply(RULE, lines, new Set()), [
    { id: "a", documentId: "doc-1", exclude: true, finalized: false, snapshotChanged: false },
  ]);
});

test("remove clears only lines of this rule and not in locked documents", () => {
  const lines = [
    line({ id: "mine", excluded: true, ruleId: RULE, finalized: true, finalizedExcluded: true }),
    line({ id: "in-resort", excluded: true, ruleId: RULE, inActiveResort: true }),
    line({ id: "other-rule", excluded: true, ruleId: "rule-2" }),
    line({ id: "manual", excluded: true, ruleId: null }),
    line({ id: "locked", documentId: "locked-doc", excluded: true, ruleId: RULE }),
  ];
  assert.deepEqual(planRemove(RULE, lines, new Set(["locked-doc"])), [
    { id: "mine", documentId: "doc-1", exclude: false, finalized: true, snapshotChanged: true },
  ]);
});

test("remove skips line in active resort", () => {
  const lines = [line({ id: "a", excluded: true, ruleId: RULE, inActiveResort: true })];
  assert.deepEqual(planRemove(RULE, lines, new Set()), []);
});

test("apply re-applies a finalized line whose snapshot is still included", () => {
  const lines = [line({ id: "a", excluded: true, ruleId: RULE, finalized: true, finalizedExcluded: false })];
  assert.deepEqual(planApply(RULE, lines, new Set()), [
    { id: "a", documentId: "doc-1", exclude: true, finalized: true, snapshotChanged: true },
  ]);
});

test("apply re-attribution on a finalized line already excluded in snapshot does not change the snapshot", () => {
  const lines = [line({ id: "a", excluded: true, ruleId: "group-rule", finalized: true, finalizedExcluded: true })];
  assert.deepEqual(planApply(RULE, lines, new Set()), [
    { id: "a", documentId: "doc-1", exclude: true, finalized: true, snapshotChanged: false },
  ]);
});

test("settled finalized lines: excluded by this rule in snapshot, unlocked only", () => {
  const lines = [
    line({ id: "settled", excluded: true, ruleId: RULE, finalized: true, finalizedExcluded: true }),
    line({ id: "live-only", excluded: true, ruleId: RULE }),
    line({ id: "locked", documentId: "locked-doc", excluded: true, ruleId: RULE, finalized: true, finalizedExcluded: true }),
    line({ id: "other", excluded: true, ruleId: "rule-2", finalized: true, finalizedExcluded: true }),
  ];
  assert.deepEqual(
    settledFinalizedLines(RULE, lines, new Set(["locked-doc"])).map((l) => l.id),
    ["settled"],
  );
});

test("protected month: before the venue boundary", () => {
  assert.equal(isProtectedMonth("2026-09-01", "2026-10-01"), true);
});

test("protected month: the boundary month itself is not protected", () => {
  assert.equal(isProtectedMonth("2026-10-01", "2026-10-01"), false);
  assert.equal(isProtectedMonth("2026-10-01", "2026-10-15"), false);
});

test("protected month: later month is not protected", () => {
  assert.equal(isProtectedMonth("2026-11-01", "2026-10-01"), false);
});

test("protected month: no boundary means no protection", () => {
  assert.equal(isProtectedMonth("2020-01-01", null), false);
});

test("isolated rules: a failing rule does not drop months of the others", async () => {
  const calls: string[] = [];
  const result = await runRulesIsolated(["r1", "r2", "r3", "r1"], async (id) => {
    calls.push(id);
    if (id === "r2") throw new Error("boom");
    return {
      documentIds: [`doc-${id}`],
      months: [{ venueId: "v", month: id === "r1" ? "2026-10-01" : "2026-11-01" }],
    };
  });
  assert.deepEqual(calls, ["r1", "r2", "r3"]);
  assert.deepEqual(result.documentIds, ["doc-r1", "doc-r3"]);
  assert.deepEqual(result.months, [
    { venueId: "v", month: "2026-10-01" },
    { venueId: "v", month: "2026-11-01" },
  ]);
  assert.deepEqual(result.failures, [{ ruleId: "r2", message: "boom" }]);
});

test("isolated rules: months are de-duplicated per venue and month", async () => {
  const result = await runRulesIsolated(["a", "b"], async () => ({
    documentIds: ["d"],
    months: [{ venueId: "v", month: "2026-10-01" }],
  }));
  assert.equal(result.months.length, 1);
  assert.deepEqual(result.documentIds, ["d"]);
  assert.deepEqual(result.failures, []);
});
