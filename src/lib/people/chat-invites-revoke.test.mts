import test from "node:test";
import assert from "node:assert/strict";
import { revokeStaffChatInvites } from "./chat-invites-revoke.ts";

type Row = Record<string, unknown>;
function fakeDb(rows: Row[]) {
  const from = () => {
    let picked = rows;
    let removing = false;
    const q: Record<string, unknown> = {
      select: () => q,
      delete: () => {
        removing = true;
        return q;
      },
      eq: (c: string, v: unknown) => {
        picked = picked.filter((r) => r[c] === v);
        return q;
      },
      in: (c: string, v: unknown[]) => {
        picked = picked.filter((r) => v.includes(r[c]));
        return q;
      },
      then: (res: (v: unknown) => unknown) => {
        if (removing) for (const r of picked) rows.splice(rows.indexOf(r), 1);
        return res({ data: removing ? null : picked, error: null });
      },
    };
    return q;
  };
  return { from } as never;
}
const link = (id: string, chat: string, detail: string | null, extra: Row = {}) => ({
  id, account_id: "a", user_id: "u", kind: "invite", result: "invited", chat_id: chat, detail, ...extra,
});

test("отзывает выданные ссылки и убирает их из журнала, отметку о сообщении оставляет", async () => {
  const rows = [
    link("1", "c1", "https://t.me/+one"),
    link("2", "c2", "https://t.me/+two"),
    link("3", "*message*", null),
    link("4", "c3", "https://t.me/+other", { user_id: "someone" }),
    link("5", "c4", "нет прав", { result: "error" }),
  ];
  const revokedCalls: string[] = [];
  const bot = {
    revokeChatInviteLink: async (chat: string, url: string) => {
      revokedCalls.push(`${chat} ${url}`);
      return chat === "c2" ? { ok: false, description: "CHAT_ADMIN_REQUIRED" } : { ok: true };
    },
  };
  const result = await revokeStaffChatInvites(fakeDb(rows), bot as never, "a", "u");
  assert.deepEqual(result, { revoked: 1, failed: 1 });
  assert.deepEqual(revokedCalls, ["c1 https://t.me/+one", "c2 https://t.me/+two"]);
  assert.deepEqual(rows.map((r) => r.id), ["3", "4", "5"]);
});

test("без выданных ссылок ничего не делает", async () => {
  const rows = [link("3", "*message*", null)];
  const result = await revokeStaffChatInvites(
    fakeDb(rows),
    { revokeChatInviteLink: async () => assert.fail("не должен вызываться") } as never,
    "a",
    "u",
  );
  assert.deepEqual(result, { revoked: 0, failed: 0 });
  assert.equal(rows.length, 1);
});
