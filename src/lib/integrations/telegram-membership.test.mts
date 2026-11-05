import test from "node:test";
import assert from "node:assert/strict";
import { chatsForRole, classifyChatMember, removalComplete, type ChatRow } from "./telegram-membership.ts";

const ok = (status: string, is_member?: boolean) => ({ ok: true, result: { status, is_member } });

test("classifyChatMember: members", () => {
  for (const s of ["creator", "administrator", "member"]) assert.equal(classifyChatMember(ok(s)), "member");
  assert.equal(classifyChatMember(ok("restricted", true)), "member");
});
test("classifyChatMember: absent", () => {
  assert.equal(classifyChatMember(ok("left")), "absent");
  assert.equal(classifyChatMember(ok("kicked")), "absent");
  assert.equal(classifyChatMember(ok("restricted", false)), "absent");
});
test("classifyChatMember: unknown", () => {
  assert.equal(classifyChatMember({ ok: false, description: "Bad Request: member not found" }), "unknown");
  assert.equal(classifyChatMember({ ok: false, description: "Forbidden: bot was kicked" }), "unknown");
  assert.equal(classifyChatMember({ ok: true }), "unknown");
  assert.equal(classifyChatMember(ok("restricted")), "unknown");
  assert.equal(classifyChatMember(ok("something_new")), "unknown");
});

const row = (o: Partial<ChatRow>): ChatRow => ({ chat_id: "1", title: "t", invite: true, role_ids: [], archived_at: null, ...o });
test("chatsForRole", () => {
  const all = row({ chat_id: "all" });
  const bar = row({ chat_id: "bar", role_ids: ["r1"] });
  const hall = row({ chat_id: "hall", role_ids: ["r2"] });
  const archived = row({ chat_id: "arch", archived_at: "2026-01-01" });
  const off = row({ chat_id: "off", invite: false });
  const chats = [all, bar, hall, archived, off];
  assert.deepEqual(chatsForRole(chats, "r1").map(c => c.chat_id), ["all", "bar"]);
  assert.deepEqual(chatsForRole(chats, null).map(c => c.chat_id), ["all"]);
});
test("removalComplete", () => {
  assert.equal(removalComplete(["removed", "absent"]), true);
  assert.equal(removalComplete([]), true);
  assert.equal(removalComplete(["removed", "unconfirmed"]), false);
  assert.equal(removalComplete(["absent", "error"]), false);
});
