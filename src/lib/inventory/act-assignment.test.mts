import assert from "node:assert/strict";
import test from "node:test";

import {
  EMPTY_ASSIGNMENT_ELIGIBILITY,
  buildAssignmentEligibility,
  filterEligibleOptions,
  getAssignmentConflictReason,
  ineligibleAssigneeMessage,
  isEligibleForRole,
  resolveReviewerFallback,
} from "./act-assignment.ts";

const eligibility = buildAssignmentEligibility({
  ownerId: "owner",
  grants: [
    { userId: "filler", venueId: "v1", permissionCodes: ["inventory.fill_assigned_documents"] },
    { userId: "checker", venueId: "v1", permissionCodes: ["inventory.recount_documents"] },
    { userId: "manager", venueId: "v2", permissionCodes: ["inventory.manage_documents"] },
    { userId: "viewer", venueId: "v1", permissionCodes: [] },
    { userId: "filler", venueId: "v1", permissionCodes: ["inventory.fill_assigned_documents"] },
  ],
});

test("buildAssignmentEligibility раскладывает права по ролям и заведениям без дублей", () => {
  assert.deepEqual(eligibility.executorsByVenue, { v1: ["filler"], v2: ["manager"] });
  assert.deepEqual(eligibility.reviewersByVenue, { v1: ["checker"], v2: ["manager"] });
  assert.equal(eligibility.ownerId, "owner");
});

test("исполнитель — только с правом заполнять (или управлять) в заведении акта", () => {
  const ok = (userId: string, venueId: string | null) =>
    isEligibleForRole({ eligibility, role: "assignee", venueId, userId });
  assert.equal(ok("filler", "v1"), true);
  assert.equal(ok("filler", "v2"), false, "право в другом заведении не считается");
  assert.equal(ok("checker", "v1"), false, "право пересчёта не даёт права заполнять");
  assert.equal(ok("viewer", "v1"), false);
  assert.equal(ok("manager", "v2"), true);
  assert.equal(ok("owner", "v2"), true, "владелец подходит всегда");
  assert.equal(ok("stranger", "v1"), false);
});

test("проверяющий — только с правом пересчёта (или управлять)", () => {
  const ok = (userId: string, venueId: string | null) =>
    isEligibleForRole({ eligibility, role: "reviewer", venueId, userId });
  assert.equal(ok("checker", "v1"), true);
  assert.equal(ok("filler", "v1"), false);
  assert.equal(ok("manager", "v1"), false);
  assert.equal(ok("owner", "v1"), true);
});

test("акт без заведения проверяется по всему аккаунту", () => {
  assert.equal(isEligibleForRole({ eligibility, role: "assignee", venueId: null, userId: "manager" }), true);
  assert.equal(isEligibleForRole({ eligibility, role: "assignee", venueId: null, userId: "checker" }), false);
  assert.equal(
    isEligibleForRole({ eligibility: EMPTY_ASSIGNMENT_ELIGIBILITY, role: "assignee", venueId: null, userId: "x" }),
    false,
  );
});

test("filterEligibleOptions: пикер строки и объединение для массового меню", () => {
  const options = ["owner", "filler", "checker", "manager", "viewer"].map((id) => ({ id, name: id }));
  const ids = (venueIds: Array<string | null>, role: "assignee" | "reviewer") =>
    filterEligibleOptions({ options, eligibility, role, venueIds }).map((o) => o.id);
  assert.deepEqual(ids(["v1"], "assignee"), ["owner", "filler"]);
  assert.deepEqual(ids(["v1", "v2"], "assignee"), ["owner", "filler", "manager"]);
  assert.deepEqual(ids([], "reviewer"), ["owner", "checker", "manager"], "без заведений — по аккаунту");
});

test("исполнитель и проверяющий — разные люди", () => {
  assert.match(
    getAssignmentConflictReason({ role: "assignee", userId: "a", assignedTo: null, reviewerId: "a" }) ?? "",
    /проверяющий акта/,
  );
  assert.match(
    getAssignmentConflictReason({ role: "reviewer", userId: "a", assignedTo: "a", reviewerId: null }) ?? "",
    /исполнитель акта/,
  );
  assert.equal(getAssignmentConflictReason({ role: "reviewer", userId: null, assignedTo: "a", reviewerId: "a" }), null);
  assert.equal(getAssignmentConflictReason({ role: "assignee", userId: "b", assignedTo: "a", reviewerId: "c" }), null);
});

test("авто-проверяющий не ставится исполнителю и не перетирает назначенного", () => {
  assert.equal(resolveReviewerFallback({ reviewerId: null, assignedTo: "a", actorId: "m" }), "m");
  assert.equal(resolveReviewerFallback({ reviewerId: null, assignedTo: "m", actorId: "m" }), null);
  assert.equal(resolveReviewerFallback({ reviewerId: "r", assignedTo: "a", actorId: "m" }), null);
  assert.equal(resolveReviewerFallback({ reviewerId: null, assignedTo: null, actorId: "m" }), "m");
});

test("тексты отказа по праву", () => {
  assert.match(ineligibleAssigneeMessage("assignee"), /нет права заполнять акты/);
  assert.match(ineligibleAssigneeMessage("reviewer"), /нет права проверять акты/);
});
