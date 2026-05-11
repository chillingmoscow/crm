import test from "node:test";
import assert from "node:assert/strict";

import { runWithConcurrency } from "./run-with-concurrency.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("runWithConcurrency: empty input returns immediately", async () => {
  let calls = 0;
  await runWithConcurrency<number>([], 4, async () => {
    calls += 1;
  });
  assert.equal(calls, 0);
});

test("runWithConcurrency: respects limit (never more than N in flight)", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const items = Array.from({ length: 10 }, (_, i) => i);

  await runWithConcurrency(items, 3, async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    // Yield so other workers can pick up items.
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
  });

  assert.equal(maxInFlight, 3);
});

test("runWithConcurrency: processes every item exactly once", async () => {
  const items = Array.from({ length: 50 }, (_, i) => i);
  const processed: number[] = [];

  await runWithConcurrency(items, 4, async (item) => {
    processed.push(item);
  });

  assert.equal(processed.length, 50);
  // Order is not guaranteed across runners, but the multiset is identical.
  const sorted = [...processed].sort((a, b) => a - b);
  assert.deepEqual(sorted, items);
});

test("runWithConcurrency: limit > items collapses to items.length runners", async () => {
  let started = 0;
  await runWithConcurrency([1, 2, 3], 100, async () => {
    started += 1;
  });
  assert.equal(started, 3);
});

test("runWithConcurrency: worker rejection bubbles up as Promise.all rejects", async () => {
  const items = [1, 2, 3];
  await assert.rejects(
    () =>
      runWithConcurrency(items, 2, async (item) => {
        if (item === 2) throw new Error("boom");
      }),
    /boom/,
  );
});

test("runWithConcurrency: stops dispatching new items after a worker throws", async () => {
  // Once worker for item 5 throws, no worker should start a new item.
  // In-flight workers (here: limit=2 so at most 1 other peer) finish
  // their current item and then loop-exits via the aborted flag.
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const started: number[] = [];

  await assert.rejects(
    () =>
      runWithConcurrency(items, 2, async (item) => {
        started.push(item);
        if (item === 5) throw new Error("boom");
        // Tiny delay so peers have a chance to pick up next items
        // if we *weren't* aborting properly.
        await new Promise((resolve) => setTimeout(resolve, 5));
      }),
    /boom/,
  );

  // The serial baseline (limit=1) would have started exactly 5 items.
  // With limit=2 a single peer may have been in flight when item 5
  // threw — so up to ~6 items max. The point is we shouldn't see
  // every item dispatched (10) as we would without the abort gate.
  assert.ok(
    started.length <= 6,
    `expected ≤6 dispatched after abort, got ${started.length}: ${started.join(",")}`,
  );
});

test("runWithConcurrency: concurrent workers really run in parallel", async () => {
  // Each worker takes its own deferred; runner only completes when
  // the deferred resolves. If concurrency is honoured (limit=3),
  // three workers should be unblocked simultaneously.
  const deferreds = [deferred<void>(), deferred<void>(), deferred<void>()];
  const started = [false, false, false];

  const runPromise = runWithConcurrency(
    [0, 1, 2],
    3,
    async (index: number) => {
      started[index] = true;
      await deferreds[index]!.promise;
    },
  );

  // Yield two microtask turns so workers can start.
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(started, [true, true, true]);
  // Unblock and finish.
  deferreds.forEach((d) => d.resolve());
  await runPromise;
});
