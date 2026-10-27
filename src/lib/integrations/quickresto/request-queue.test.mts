import test from "node:test";
import assert from "node:assert/strict";
import { createQuickRestoRequestQueue, QuickRestoRateLimitError } from "./request-queue.ts";
import { runWithConcurrency } from "../../run-with-concurrency.ts";

function fixture() {
  let now = Date.parse("2026-10-27T12:00:00Z");
  const waits: number[] = [];
  const request = createQuickRestoRequestQueue({
    now: () => now,
    sleep: async (ms) => { waits.push(ms); now += ms; },
  });
  return { request, waits, now: () => now };
}
const url = "https://example.quickresto.ru/platform/data/warehouse.inventory.items/update";
const options = { retryRateLimit: true, intervalMs: 250 };

test("rejected item is retried after Retry-After, preserving other quantities", async () => {
  const f = fixture();
  const calls: Array<{ item: number; time: number }> = [];
  let rejected = false;
  const values = new Map<number, number>();
  await Promise.all([1, 2, 3, 4, 5].map((item) => f.request(url, async () => {
    calls.push({ item, time: f.now() });
    if (item === 1 && !rejected) {
      rejected = true;
      return new Response("nginx", { status: 429, headers: { "Retry-After": "2" } });
    }
    values.set(item, item * 0.2);
    return Response.json({ id: item });
  }, options)));
  assert.equal(values.size, 5);
  assert.equal(calls.filter((c) => c.item === 1).length, 2);
  assert.equal(calls.length, 6);
  assert.ok(f.waits.some((ms) => ms >= 2_000));
});

test("repeated 429 without headers stops after bounded exponential retries", async () => {
  const f = fixture();
  let calls = 0;
  await assert.rejects(() => f.request(url, async () => {
    calls += 1;
    return new Response("nginx", { status: 429 });
  }, options), QuickRestoRateLimitError);
  assert.equal(calls, 4);
  assert.deepEqual(f.waits, [1_000, 2_000, 4_000]);
});

test("long Retry-After is respected by subsequent calls without blocking the action", async () => {
  const f = fixture();
  let calls = 0;
  const send = async () => {
    calls += 1;
    return new Response(null, { status: 429, headers: { "Retry-After": "3600" } });
  };
  await assert.rejects(() => f.request(url, send, options), QuickRestoRateLimitError);
  await assert.rejects(() => f.request(url, send, options), QuickRestoRateLimitError);
  assert.equal(calls, 1);
  assert.deepEqual(f.waits, []);
});

test("HTTP-date Retry-After and cooldown are isolated by origin", async () => {
  const f = fixture();
  let calls = 0;
  await f.request(url, async () => {
    calls += 1;
    return calls === 1
      ? new Response(null, { status: 429, headers: { "Retry-After": new Date(f.now() + 3_000).toUTCString() } })
      : new Response("ok");
  }, options);
  assert.deepEqual(f.waits, [3_000]);
  await f.request("https://other.quickresto.ru/read", async () => new Response("ok"), options);
  assert.deepEqual(f.waits, [3_000]);
});

test("creates, network failures and 5xx are not replayed", async () => {
  for (const kind of ["create", "network", "500"]) {
    const f = fixture();
    let calls = 0;
    const operation = f.request(url, async () => {
      calls += 1;
      if (kind === "network") throw new Error("socket reset after delivery");
      return new Response(null, { status: kind === "create" ? 429 : 500 });
    }, { retryRateLimit: kind !== "create" });
    if (kind === "500") assert.equal((await operation).status, 500);
    else await assert.rejects(operation);
    assert.equal(calls, 1);
  }
});

test("inventory writes are paced without serialising their HTTP latency", async () => {
  const f = fixture();
  let complete!: () => void;
  const pending = new Promise<void>((resolve) => { complete = resolve; });
  const first = f.request(url, async () => { await pending; return new Response("ok"); }, options);
  const second = f.request(url, async () => new Response("ok"), options);
  assert.equal((await second).status, 200);
  assert.deepEqual(f.waits, [250]);
  complete();
  await first;
});

test("345-line inventory with a partial upload resumes through provider throttling", async () => {
  const f = fixture();
  const alreadyUploaded = 93;
  const expected = Array.from({ length: 345 }, (_, id) => ({ id, amount: (id + 1) / 100 }));
  const stored = new Map(expected.slice(0, alreadyUploaded).map((item) => [item.id, item.amount]));
  const rejected = new Set<number>();
  const attempts = new Map<number, number>();
  // Submission already skips equal absolute quantities in the fresh QR payload.
  const remaining = expected.filter((item) => stored.get(item.id) !== item.amount);
  await runWithConcurrency(remaining, 5, async (item) => {
    await f.request(url, async () => {
      attempts.set(item.id, (attempts.get(item.id) ?? 0) + 1);
      if (item.id % 94 === 0 && !rejected.has(item.id)) {
        rejected.add(item.id);
        return new Response("nginx", { status: 429, headers: { "Retry-After": "1" } });
      }
      stored.set(item.id, item.amount);
      return Response.json({ id: item.id, actualAmount: item.amount });
    }, options);
  });
  assert.equal(stored.size, 345);
  for (const item of expected) assert.equal(stored.get(item.id), item.amount);
  for (let id = 0; id < alreadyUploaded; id += 1) assert.equal(attempts.has(id), false);
  for (const id of rejected) assert.equal(attempts.get(id), 2);
});
