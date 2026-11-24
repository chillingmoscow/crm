import assert from "node:assert/strict";
import test from "node:test";
import { matchesStaffKind } from "./staff-kind-filter.ts";

const official = new Set(["u1"]);

test("no filter keeps every row", () => {
  assert.equal(matchesStaffKind("", { kind: "invitation" }, official), true);
});

test("official keeps only staff with an open period", () => {
  assert.equal(matchesStaffKind("official", { kind: "staff", userId: "u1" }, official), true);
  assert.equal(matchesStaffKind("official", { kind: "staff", userId: "u2" }, official), false);
  assert.equal(matchesStaffKind("official", { kind: "casual", userId: "u1" }, official), false);
  assert.equal(matchesStaffKind("official", { kind: "invitation" }, official), false);
});

test("staff and casual filters keep their meaning", () => {
  assert.equal(matchesStaffKind("casual", { kind: "casual" }, official), true);
  assert.equal(matchesStaffKind("casual", { kind: "staff", userId: "u1" }, official), false);
  assert.equal(matchesStaffKind("staff", { kind: "staff", userId: "u2" }, official), true);
  assert.equal(matchesStaffKind("staff", { kind: "casual" }, official), false);
});
