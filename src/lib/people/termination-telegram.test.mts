import test from "node:test";
import assert from "node:assert/strict";
import { ALL_CHATS, removeFromTelegramChats, terminationReport, unconfirmedChats, type TelegramRemovalTransport } from "./termination-telegram.ts";
import { removalComplete } from "../integrations/telegram-membership.ts";

const chats = [{ chat_id: "-1", title: "Бар" }, { chat_id: "-2", title: "Кухня" }];
function fixture(members: Record<string, string | Error> = {}, { stayAfterBan = false } = {}) {
  const calls: string[] = [];
  const recorded: Array<{ chat_id: string; result: string; detail: string | null }> = [];
  const state = { ...members };
  const transport: TelegramRemovalTransport = {
    getChatMember: async (chatId, userId) => {
      calls.push(`get:${chatId}:${userId}`);
      const s = state[chatId] ?? "left";
      if (s instanceof Error) throw s;
      if (s === "not_found") return { ok: false, description: "Bad Request: member not found" };
      return { ok: true, result: { status: s } };
    },
    banChatMember: async (chatId) => { calls.push(`ban:${chatId}`); if (!stayAfterBan) state[chatId] = "kicked"; return { ok: true }; },
    unbanChatMember: async (chatId) => { calls.push(`unban:${chatId}`); if (!stayAfterBan) state[chatId] = "left"; return { ok: true }; },
    record: async (o) => { recorded.push({ chat_id: o.chat_id, result: o.result, detail: o.detail }); },
  };
  return { transport, calls, recorded };
}

test("no Telegram ID: every chat is unconfirmed and nothing is called", async () => {
  const f = fixture({ "-1": "member" });
  const out = await removeFromTelegramChats({ configured: true, telegramId: null, chats, previous: [], transport: f.transport });
  assert.deepEqual(out.map(o => o.result), ["unconfirmed", "unconfirmed"]);
  assert.ok(out.every(o => /Telegram ID/.test(o.detail ?? "")));
  assert.equal(removalComplete(out.map(o => o.result)), false);
  assert.deepEqual(f.calls, []);
  assert.equal(f.recorded.length, 2);
});

test("no Telegram ID and no chats still blocks completion (removalComplete([]) would be true)", async () => {
  const f = fixture();
  const out = await removeFromTelegramChats({ configured: true, telegramId: "  ", chats: [], previous: [], transport: f.transport });
  assert.deepEqual(out.map(o => [o.chat_id, o.result]), [[ALL_CHATS, "unconfirmed"]]);
  assert.equal(removalComplete(out.map(o => o.result)), false);
});

test("Telegram not configured: unconfirmed with «Telegram не настроен»", async () => {
  const f = fixture();
  for (const list of [chats, []]) {
    const out = await removeFromTelegramChats({ configured: false, telegramId: "42", chats: list, previous: [], transport: f.transport });
    assert.ok(out.length > 0 && out.every(o => o.result === "unconfirmed" && o.detail === "Telegram не настроен"));
  }
  assert.deepEqual(f.calls, []);
});

test("member is banned, unbanned and confirmed absent; absent chat is not touched", async () => {
  const f = fixture({ "-1": "member", "-2": "left" });
  const out = await removeFromTelegramChats({ configured: true, telegramId: "42", chats, previous: [], transport: f.transport });
  assert.deepEqual(out.map(o => o.result), ["removed", "absent"]);
  assert.deepEqual(f.calls, ["get:-1:42", "ban:-1", "unban:-1", "get:-1:42", "get:-2:42"]);
  assert.equal(removalComplete(out.map(o => o.result)), true);
  assert.deepEqual(f.recorded.map(r => r.result), ["removed", "absent"]);
});

test("member not found and API failures are not treated as absent", async () => {
  const f = fixture({ "-1": "not_found", "-2": new Error("Telegram не ответил") });
  const out = await removeFromTelegramChats({ configured: true, telegramId: "42", chats, previous: [], transport: f.transport });
  assert.deepEqual(out.map(o => o.result), ["unconfirmed", "error"]);
  assert.match(out[0].detail ?? "", /member not found/);
  assert.equal(removalComplete(out.map(o => o.result)), false);
});

test("ban that leaves the person in the chat is unconfirmed", async () => {
  const f = fixture({ "-1": "member" }, { stayAfterBan: true });
  const out = await removeFromTelegramChats({ configured: true, telegramId: "42", chats: [chats[0]], previous: [], transport: f.transport });
  assert.equal(out[0].result, "unconfirmed");
});

test("retry skips chats already removed/absent and retries the rest", async () => {
  const f = fixture({ "-2": "member" });
  const out = await removeFromTelegramChats({ configured: true, telegramId: "42", chats,
    previous: [{ chat_id: "-1", result: "removed" }, { chat_id: "-2", result: "error" }], transport: f.transport });
  assert.deepEqual(out.map(o => o.result), ["removed", "removed"]);
  assert.ok(!f.calls.some(c => c.includes(":-1") || c.endsWith("-1")));
  assert.deepEqual(f.recorded.map(r => r.chat_id), ["-2"]);
});

test("summary and report name each chat and the written-off bonus", () => {
  const out = [
    { chat_id: "-1", title: "Бар", result: "removed" as const, detail: null },
    { chat_id: "-2", title: "Кухня", result: "unconfirmed" as const, detail: "x" },
  ];
  assert.equal(unconfirmedChats(out), "Кухня — не подтверждено");
  const text = terminationReport("Иван Петров", out.slice(0, 1), [150]);
  assert.match(text, /Иван Петров/);
  assert.match(text, /Бар — исключён/);
  assert.match(text, /150/);
  assert.match(terminationReport("Иван", [], []), /не было/);
});
