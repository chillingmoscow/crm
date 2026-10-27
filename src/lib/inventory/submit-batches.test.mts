import test from "node:test";
import assert from "node:assert/strict";
import { submitInventoryBatches } from "./submit-batches.ts";

test("345-line draft resumes 93 accepted values and carries the refreshed version between chunks", async () => {
  const input = { baseLastUpdateDate: "initial", items: Array.from({ length: 345 }, (_, id) => ({ id, amount: id / 100 })) };
  let remaining = 345 - 93;
  let calls = 0;
  const result = await submitInventoryBatches(input, async (chunk) => {
    assert.equal(chunk.supportsBatches, true);
    assert.equal(chunk.items, input.items);
    assert.equal(chunk.baseLastUpdateDate, calls ? `version-${calls}` : "initial");
    calls += 1;
    remaining = Math.max(0, remaining - 32);
    return remaining ? {
      resultsHasLineAmounts: false, pendingItems: remaining,
      nextBaseLastUpdateDate: `version-${calls}`, error: null,
    } : { resultsHasLineAmounts: true, error: null };
  });
  assert.equal(calls, 8);
  assert.equal(result.resultsHasLineAmounts, true);
  assert.equal(input.baseLastUpdateDate, "initial");
});

test("a rate limit after a partial upload returns failure without pretending the act is finished", async () => {
  let calls = 0;
  const result = await submitInventoryBatches({ baseLastUpdateDate: null }, async () => {
    calls += 1;
    return calls === 1
      ? { resultsHasLineAmounts: false, pendingItems: 10, nextBaseLastUpdateDate: null, error: null }
      : { resultsHasLineAmounts: false, error: "rate limit" };
  });
  assert.equal(calls, 2);
  assert.equal(result.error, "rate limit");
  assert.equal(result.resultsHasLineAmounts, false);
});

test("provider not applying quantities cannot cause an endless submission loop", async () => {
  let calls = 0;
  const result = await submitInventoryBatches({ baseLastUpdateDate: null }, async () => {
    calls += 1;
    return { resultsHasLineAmounts: false, pendingItems: 10, nextBaseLastUpdateDate: null, error: null };
  });
  assert.equal(calls, 2);
  assert.ok(result.error);
});

test("external version conflicts are surfaced without starting another chunk", async () => {
  let calls = 0;
  const result = await submitInventoryBatches({ baseLastUpdateDate: "old" }, async () => {
    calls += 1;
    return { resultsHasLineAmounts: false, refreshDocument: true, error: "Акт изменился" };
  });
  assert.equal(calls, 1);
  assert.equal(result.refreshDocument, true);
  assert.equal(result.error, "Акт изменился");
});
