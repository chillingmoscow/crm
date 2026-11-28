import test from "node:test";
import assert from "node:assert/strict";
import { runChatInvites } from "./chat-invites-core.ts";

type Row = Record<string, unknown>;
// Minimal fake of the loose query builder: tables are arrays, filters are eq/is.
function fakeDb(tables: Record<string, Row[]>) {
  const from = (t: string) => {
    let rows = tables[t] ?? (tables[t] = []);
    const q: Record<string, unknown> = {
      select: () => q,
      order: () => q,
      eq: (c: string, v: unknown) => { rows = rows.filter(r => r[c] === v); return q; },
      is: (c: string, v: unknown) => { rows = rows.filter(r => (r[c] ?? null) === v); return q; },
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      upsert: (v: Row) => {
        const store = tables[t];
        const i = store.findIndex(r => r.account_id === v.account_id && r.event_key === v.event_key && r.chat_id === v.chat_id);
        if (i >= 0) store[i] = { ...store[i], ...v }; else store.push(v);
        return q;
      },
      then: (res: (v: unknown) => unknown) => res({ data: rows, error: null }),
    };
    return q;
  };
  return { from } as never;
}
const chat = (id: string, title: string) => ({ chat_id: id, title, invite: true, role_ids: [], archived_at: null, account_id: "a" });
function fakeBot(failIds: string[] = []) {
  const calls = { links: [] as string[], messages: [] as { text: string; buttons?: unknown }[] };
  const bot = {
    reportsChatId: "r", invitesChatId: "inv",
    createChatInviteLink: async (id: string) => {
      calls.links.push(id);
      return failIds.includes(id) ? { ok: false, description: "no rights" } : { ok: true, result: { invite_link: `https://t.me/+${id}` } };
    },
    sendMessage: async (_c: string, text: string, buttons?: unknown) => { calls.messages.push({ text, buttons }); return { ok: true }; },
  };
  return { bot: bot as never, calls };
}
const args = { accountId: "a", userId: "u", roleId: null, name: "Иван", eventKey: "hire:1", allowPartial: false };

test("retry reuses a link already journaled for the event", async () => {
  const tables = { telegram_chats: [chat("c1", "Один"), chat("c2", "Два")], staff_telegram_actions: [
    { account_id: "a", event_key: "hire:1", chat_id: "c1", result: "invited", detail: "https://t.me/+old" }] };
  const { bot, calls } = fakeBot();
  await runChatInvites(fakeDb(tables), bot, args);
  assert.deepEqual(calls.links, ["c2"]);
  assert.equal(calls.messages.length, 1);
  assert.deepEqual(calls.messages[0].buttons, [[{ text: "Один", url: "https://t.me/+old" }], [{ text: "Два", url: "https://t.me/+c2" }]]);
});

test("marker short-circuits: nothing created, nothing sent", async () => {
  const tables = { telegram_chats: [chat("c1", "Один")], staff_telegram_actions: [
    { account_id: "a", event_key: "hire:1", chat_id: "*message*", result: "invited", detail: null }] };
  const { bot, calls } = fakeBot();
  await runChatInvites(fakeDb(tables), bot, args);
  assert.equal(calls.links.length, 0);
  assert.equal(calls.messages.length, 0);
});

test("failure throws before allowPartial and sends nothing; marker is written after a send", async () => {
  const tables = { telegram_chats: [chat("c1", "Один"), chat("c2", "Два")], staff_telegram_actions: [] as Row[] };
  const { bot, calls } = fakeBot(["c2"]);
  await assert.rejects(runChatInvites(fakeDb(tables), bot, args), /Не удалось создать приглашения/);
  assert.equal(calls.messages.length, 0);
  assert.ok(!tables.staff_telegram_actions.some(r => r.chat_id === "*message*"));
});

test("allowPartial sends the successful links plus the failed list, then writes the marker", async () => {
  const tables = { telegram_chats: [chat("c1", "Один"), chat("c2", "Два")], staff_telegram_actions: [] as Row[] };
  const { bot, calls } = fakeBot(["c2"]);
  await runChatInvites(fakeDb(tables), bot, { ...args, allowPartial: true });
  assert.equal(calls.messages.length, 1);
  assert.match(calls.messages[0].text, /Не удалось создать приглашение: Два/);
  assert.deepEqual(calls.messages[0].buttons, [[{ text: "Один", url: "https://t.me/+c1" }]]);
  assert.ok(tables.staff_telegram_actions.some(r => r.chat_id === "*message*" && r.result === "invited"));
});

function unbanBot(unbanFail: string[] = []) {
  const { bot, calls } = fakeBot();
  const order: string[] = [];
  const b = bot as unknown as Record<string, unknown>;
  const create = b.createChatInviteLink as (id: string) => Promise<unknown>;
  b.createChatInviteLink = async (id: string) => { order.push(`link:${id}`); return create(id); };
  b.unbanChatMember = async (id: string, userId: number) => {
    order.push(`unban:${id}:${userId}`);
    return unbanFail.includes(id) ? { ok: false, description: "not enough rights" } : { ok: true, result: true };
  };
  return { bot, calls, order };
}

test("with a Telegram ID the ban is lifted in each chat before its link is created", async () => {
  const tables = { telegram_chats: [chat("c1", "Один"), chat("c2", "Два")], staff_telegram_actions: [] as Row[],
    profiles: [{ id: "u", telegram_id: " 12345 " }] };
  const { bot, calls, order } = unbanBot();
  await runChatInvites(fakeDb(tables), bot, args);
  assert.deepEqual(order, ["unban:c1:12345", "link:c1", "unban:c2:12345", "link:c2"]);
  assert.equal(calls.messages.length, 1);
  assert.doesNotMatch(calls.messages[0].text, /Telegram ID в карточке не указан/);
});

test("a ban that was not lifted counts as a failed chat: no link, the job retries", async () => {
  const tables = { telegram_chats: [chat("c1", "Один"), chat("c2", "Два")], staff_telegram_actions: [] as Row[],
    profiles: [{ id: "u", telegram_id: "12345" }] };
  const { bot, calls, order } = unbanBot(["c2"]);
  await assert.rejects(runChatInvites(fakeDb(tables), bot, args), /Два: Не удалось снять блокировку/);
  assert.ok(!order.includes("link:c2"));
  assert.equal(calls.messages.length, 0);
});

test("without a Telegram ID nothing is unbanned and the message explains the expired-link case", async () => {
  const tables = { telegram_chats: [chat("c1", "Один")], staff_telegram_actions: [] as Row[],
    profiles: [{ id: "u", telegram_id: null }] };
  const { bot, calls, order } = unbanBot();
  await runChatInvites(fakeDb(tables), bot, args);
  assert.deepEqual(order, ["link:c1"]);
  assert.match(calls.messages[0].text, /Telegram ID в карточке не указан/);
});
