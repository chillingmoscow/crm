import test from "node:test";
import assert from "node:assert/strict";
import { formatAdjustmentMessage, reportDelivered, sendWithPhotoFallback, type NotifyRow } from "./adjustment-notify.ts";

const base: NotifyRow = {
  kind: "deduction", medium: "money", amount: -800, reason: "Опоздание",
  business_date: "2026-10-28", employee_name: "Иван Петров", warnings_in_month: 0,
};

test("предупреждение: без суммы, со счётчиком", () => {
  const text = formatAdjustmentMessage({ ...base, kind: "warning", medium: "none", amount: 0, warnings_in_month: 3 });
  assert.equal(text, "<b>ПРЕДУПРЕЖДЕНИЕ</b>\n📅  28.10.2026\n👫  Иван Петров\n📜  Опоздание\n📮 Кол-во предупреждений: 3");
  assert.ok(!text.includes("💰"));
});

test("штраф деньгами", () => {
  assert.equal(formatAdjustmentMessage(base), "<b>ШТРАФ</b>\n📅  28.10.2026\n👫  Иван Петров\n💰  800₽\n📜  Опоздание");
});

test("штраф бонусами", () => {
  const text = formatAdjustmentMessage({ ...base, medium: "bonus", amount: -3600 });
  assert.ok(text.includes("💰  3600 бонусов"));
});

test("премия", () => {
  const text = formatAdjustmentMessage({ ...base, amount: 500 });
  assert.ok(text.startsWith("<b>ПРЕМИЯ</b>"));
  assert.ok(text.includes("💰  500₽"));
});

test("дробная сумма", () => {
  assert.ok(formatAdjustmentMessage({ ...base, amount: -150.5 }).includes("💰  150.5₽"));
});

test("экранирование HTML в имени и причине", () => {
  const text = formatAdjustmentMessage({ ...base, employee_name: "A&B <x>", reason: "<b>&</b>" });
  assert.ok(text.includes("👫  A&amp;B &lt;x&gt;"));
  assert.ok(text.includes("📜  &lt;b&gt;&amp;&lt;/b&gt;"));
});

test("длинная причина обрезается под лимит Telegram", () => {
  const text = formatAdjustmentMessage({ ...base, kind: "warning", employee_name: "Александров Александр Александрович", reason: "&".repeat(4000) });
  const visible = text.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
  assert.ok([...visible].length <= 4096);
  assert.ok(text.includes("…"));
  assert.ok(!/&(?!amp;)/.test(text));
});

test("reportDelivered: сбой записи после отправки не превращается в ошибку очереди", async () => {
  const calls: string[] = [];
  const ok = await reportDelivered(async () => { calls.push("finish"); });
  assert.deepEqual(ok, { idle: false, sent: true });
  const failed = await reportDelivered(async () => { calls.push("finish"); throw new Error("db down"); });
  assert.equal(failed.sent, true);
  assert.match(failed.error ?? "", /db down/);
  assert.equal(calls.length, 2);
});

test("sendWithPhotoFallback: без фото — только текст", async () => {
  const calls: string[] = [];
  const r = await sendWithPhotoFallback(null, async () => { calls.push("text"); return { ok: true, result: { message_id: 1 } }; });
  assert.equal(r.result?.message_id, 1);
  assert.deepEqual(calls, ["text"]);
});

test("sendWithPhotoFallback: фото принято — текст не шлётся", async () => {
  const calls: string[] = [];
  const r = await sendWithPhotoFallback(
    async () => { calls.push("photo"); return { ok: true, result: { message_id: 7 } }; },
    async () => { calls.push("text"); return { ok: true, result: { message_id: 8 } }; },
  );
  assert.equal(r.result?.message_id, 7);
  assert.deepEqual(calls, ["photo"]);
});

test("sendWithPhotoFallback: фото отклонено — тот же текст в той же попытке", async () => {
  const calls: string[] = [];
  const r = await sendWithPhotoFallback(
    async () => { calls.push("photo"); return { ok: false, description: "Bad Request: wrong file" }; },
    async () => { calls.push("text"); return { ok: true, result: { message_id: 9 } }; },
  );
  assert.equal(r.ok, true);
  assert.equal(r.result?.message_id, 9);
  assert.deepEqual(calls, ["photo", "text"]);
});

test("sendWithPhotoFallback: отклонены оба — ошибка с причиной", async () => {
  const r = await sendWithPhotoFallback(
    async () => ({ ok: false, description: "wrong file" }),
    async () => ({ ok: false, description: "chat not found" }),
  );
  assert.equal(r.ok, false);
  assert.match(r.description ?? "", /chat not found/);
});

test("sendWithPhotoFallback: сетевая ошибка фото не ведёт к повтору текстом", async () => {
  const calls: string[] = [];
  await assert.rejects(sendWithPhotoFallback(
    async () => { calls.push("photo"); throw new Error("Telegram не ответил"); },
    async () => { calls.push("text"); return { ok: true, result: { message_id: 1 } }; },
  ), /Telegram не ответил/);
  assert.deepEqual(calls, ["photo"]);
});
