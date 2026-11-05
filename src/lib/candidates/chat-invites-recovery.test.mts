import test from "node:test";
import assert from "node:assert/strict";
import { CHAT_INVITES_SINCE, hiresMissingInvites, recoveryCutoff } from "./chat-invites-recovery.ts";

const now = Date.parse("2026-11-10T00:00:00Z");
const h = (candidate_id: string, created_at: string) => ({ candidate_id, created_at });

test("hires before the feature cutoff are never re-invited", () => {
  const got = hiresMissingInvites([h("old", "2026-10-28T10:00:00Z"), h("new", "2026-11-07T10:00:00Z")], new Set(), now);
  assert.deepEqual(got.map(x => x.candidate_id), ["new"]);
});
test("hires that already have a job are skipped", () => {
  assert.equal(hiresMissingInvites([h("a", "2026-11-07T10:00:00Z")], new Set(["a"]), now).length, 0);
});
test("the 14-day window applies once it is later than the cutoff", () => {
  const later = Date.parse("2026-12-01T00:00:00Z");
  assert.equal(recoveryCutoff(later), "2026-11-17T00:00:00.000Z");
  assert.equal(recoveryCutoff(now), new Date(CHAT_INVITES_SINCE).toISOString());
});
