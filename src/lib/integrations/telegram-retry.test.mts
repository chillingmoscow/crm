import { test } from "node:test";
import assert from "node:assert/strict";
import { isConnectFailure, withConnectRetry } from "./telegram-retry.ts";

const connectError = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: { code } });

test("isConnectFailure: only errors before the request reached Telegram", () => {
  assert.equal(isConnectFailure(connectError("UND_ERR_CONNECT_TIMEOUT")), true);
  assert.equal(isConnectFailure(connectError("ECONNREFUSED")), true);
  assert.equal(isConnectFailure(connectError("EHOSTUNREACH")), true);
  // Обрыв после отправки: сообщение могло уйти — повторять нельзя.
  assert.equal(isConnectFailure(connectError("ECONNRESET")), false);
  assert.equal(isConnectFailure(connectError("UND_ERR_SOCKET")), false);
  assert.equal(isConnectFailure(new DOMException("aborted", "TimeoutError")), false);
  assert.equal(isConnectFailure(new Error("x")), false);
});

test("withConnectRetry: retries connect failures, then succeeds", async () => {
  let calls = 0;
  const result = await withConnectRetry(async () => {
    calls++;
    if (calls < 3) throw connectError("UND_ERR_CONNECT_TIMEOUT");
    return "ok";
  }, 5);
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("withConnectRetry: gives up after the limit with the last error", async () => {
  let calls = 0;
  await assert.rejects(
    withConnectRetry(async () => { calls++; throw connectError("UND_ERR_CONNECT_TIMEOUT"); }, 4),
    (e: unknown) => isConnectFailure(e),
  );
  assert.equal(calls, 4);
});

test("withConnectRetry: other errors are not retried", async () => {
  let calls = 0;
  await assert.rejects(withConnectRetry(async () => { calls++; throw connectError("ECONNRESET"); }, 4));
  assert.equal(calls, 1);
});
