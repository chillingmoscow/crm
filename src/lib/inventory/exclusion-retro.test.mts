import assert from "node:assert/strict";
import test from "node:test";

import { planApply, planRemove, settledFinalizedLines, type RetroLine } from "./exclusion-retro.ts";

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
