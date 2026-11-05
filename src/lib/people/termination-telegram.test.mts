import test from "node:test";
import assert from "node:assert/strict";
import { ALL_CHATS, INVALID_TELEGRAM_ID, MISSING_TELEGRAM_ID, NOT_UNBANNED, removeFromTelegramChats, telegramStepApplies, terminationReport, unconfirmedChats, type TelegramRemovalTransport } from "./termination-telegram.ts";
import { removalComplete } from "../integrations/telegram-membership.ts";

const chats = [{ chat_id: "-1", title: "Бар" }, { chat_id: "-2", title: "Кухня" }];
function fixture(members: Record<string, string | Error> = {}, { stayAfterBan = false, unbanFails = 0, unbanThrows = 0 } = {}) {
  let unbanFailures = unbanFails;
  let unbanThrowsLeft = unbanThrows;
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
    unbanChatMember: async (chatId) => {
      calls.push(`unban:${chatId}`);
      if (unbanThrowsLeft > 0) { unbanThrowsLeft--; throw new Error("The operation was aborted due to timeout"); }
      if (unbanFailures > 0) { unbanFailures--; return { ok: false, description: "Too Many Requests" }; }
      if (!stayAfterBan && state[chatId] === "kicked") state[chatId] = "left";
      return { ok: true };
    },
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

test("failed unban is not final; the retry unbans and only then records removed", async () => {
  const f = fixture({ "-1": "member" }, { unbanFails: 1 });
  const first = await removeFromTelegramChats({ configured: true, telegramId: "42", chats: [chats[0]], previous: [], transport: f.transport });
  assert.equal(first[0].result, "error");
  assert.equal(first[0].detail, NOT_UNBANNED);
  assert.equal(removalComplete(first.map(o => o.result)), false);
  f.calls.length = 0;
  const second = await removeFromTelegramChats({ configured: true, telegramId: "42", chats: [chats[0]],
    previous: [{ chat_id: "-1", result: first[0].result, detail: first[0].detail }], transport: f.transport });
  assert.equal(second[0].result, "removed");
  assert.deepEqual(f.calls, ["get:-1:42", "unban:-1", "get:-1:42"]);
});

test("unban that throws after a confirmed ban keeps the marker; the retry unbans", async () => {
  const f = fixture({ "-1": "member" }, { unbanThrows: 1 });
  const first = await removeFromTelegramChats({ configured: true, telegramId: "42", chats: [chats[0]], previous: [], transport: f.transport });
  assert.equal(first[0].result, "error");
  assert.equal(first[0].detail, NOT_UNBANNED);
  assert.deepEqual(f.recorded, [{ chat_id: "-1", result: "error", detail: NOT_UNBANNED }]);
  f.calls.length = 0;
  const second = await removeFromTelegramChats({ configured: true, telegramId: "42", chats: [chats[0]],
    previous: [{ chat_id: "-1", result: first[0].result, detail: first[0].detail }], transport: f.transport });
  assert.equal(second[0].result, "removed");
  assert.deepEqual(f.calls, ["get:-1:42", "unban:-1", "get:-1:42"]);
});

test("a ban not left by this dismissal is just absent and is not lifted", async () => {
  const f = fixture({ "-1": "kicked" });
  const out = await removeFromTelegramChats({ configured: true, telegramId: "42", chats: [chats[0]], previous: [], transport: f.transport });
  assert.equal(out[0].result, "absent");
  assert.deepEqual(f.calls, ["get:-1:42"]);
});

test("a kicked member after a non-unban error (e.g. ban API failure) is not unbanned", async () => {
  const f = fixture({ "-1": "kicked" });
  const out = await removeFromTelegramChats({ configured: true, telegramId: "42", chats: [chats[0]],
    previous: [{ chat_id: "-1", result: "error", detail: "Telegram не ответил" }], transport: f.transport });
  assert.equal(out[0].result, "absent");
  assert.deepEqual(f.calls, ["get:-1:42"]);
});

test("the lease heartbeat runs before each chat that is processed, not for finished ones", async () => {
  const f = fixture({ "-2": "member" });
  const order: string[] = [];
  const getChatMember = f.transport.getChatMember;
  f.transport.getChatMember = async (c, u) => { order.push("get:" + c); return getChatMember(c, u); };
  f.transport.save = async () => { order.push("save"); };
  await removeFromTelegramChats({ configured: true, telegramId: "42", chats,
    previous: [{ chat_id: "-1", result: "removed" }], transport: f.transport });
  assert.equal(order[0], "save");
  assert.equal(order.filter(x => x === "save").length, 1);
});

test("a lost lease stops before any Telegram call", async () => {
  const f = fixture({ "-1": "member" });
  f.transport.save = async () => { throw new Error("lease lost"); };
  await assert.rejects(removeFromTelegramChats({ configured: true, telegramId: "42", chats, previous: [], transport: f.transport }), /lease lost/);
  assert.deepEqual(f.calls, []);
});

test("Telegram step: not applicable only without a bot and without chats", () => {
  assert.equal(telegramStepApplies({ configured: false, chats: [] }), false);
  assert.equal(telegramStepApplies({ configured: false, chats }), true);
  assert.equal(telegramStepApplies({ configured: true, chats: [] }), true);
  assert.equal(telegramStepApplies({ configured: true, chats }), true);
});

test("the report names the Telegram ID used for removal", () => {
  assert.match(terminationReport("Иван", [], [], "123456"), /Telegram ID: 123456/);
  assert.doesNotMatch(terminationReport("Иван", [], []), /Telegram ID/);
});

test("missing or invalid snapshot ID: unconfirmed with a «Повторить» hint, no Telegram calls", async () => {
  for (const [id, detail] of [[null, MISSING_TELEGRAM_ID], ["@ivan", INVALID_TELEGRAM_ID]] as const) {
    const f = fixture({ "-1": "member" });
    const out = await removeFromTelegramChats({ configured: true, telegramId: id, chats, previous: [], transport: f.transport });
    assert.ok(out.every(o => o.result === "unconfirmed" && o.detail === detail));
    assert.match(detail, /нажмите «Повторить»/);
    assert.deepEqual(f.calls, []);
  }
});
