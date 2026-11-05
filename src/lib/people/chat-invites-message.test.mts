import test from "node:test";
import assert from "node:assert/strict";
import { buildInviteMessage } from "./chat-invites-message.ts";

test("one button per chat with the chat title", () => {
  const m = buildInviteMessage("Иван Петров", "Бармен", [
    { title: "Бары", url: "https://t.me/+a" }, { title: "Общий", url: "https://t.me/+b" },
  ]);
  assert.match(m.text, /Приглашения для Иван Петров \(Бармен\)/);
  assert.match(m.text, /2–3 чата в минуту/);
  assert.deepEqual(m.buttons, [[{ text: "Бары", url: "https://t.me/+a" }], [{ text: "Общий", url: "https://t.me/+b" }]]);
});
test("no chats: short message without buttons", () => {
  const m = buildInviteMessage("Иван Петров", "Бармен", []);
  assert.equal(m.text, "Для должности Бармен нет чатов с приглашениями (Иван Петров)");
  assert.equal(m.buttons, undefined);
});
test("missing role name", () => {
  assert.match(buildInviteMessage("А Б", null, []).text, /без должности/);
});
test("failed chats are listed under the message, links stay as buttons", () => {
  const m = buildInviteMessage("А Б", "Бармен", [{ title: "Общий", url: "https://t.me/+b" }], ["Бары", "Кухня"]);
  assert.match(m.text, /\nНе удалось создать приглашение: Бары, Кухня$/);
  assert.equal(m.buttons?.length, 1);
});
