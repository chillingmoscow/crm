import test from "node:test";
import assert from "node:assert/strict";

import {
  TELEGRAM_NO_ANSWER,
  TELEGRAM_RETRY_DELAYS_MS,
  TELEGRAM_UNREACHABLE,
  TelegramNetworkError,
  fetchTelegram,
  isConnectFailure,
} from "./telegram-transport.ts";

// Так undici (fetch в Node) отдаёт ошибки: TypeError("fetch failed") с причиной.
const fetchFailed = (cause: object) => Object.assign(new TypeError("fetch failed"), { cause });
const sysError = (code: string, syscall?: string, message = code) =>
  Object.assign(new Error(message), { code, ...(syscall ? { syscall } : {}) });

const connectTimeout = () =>
  fetchFailed(Object.assign(new Error("Connect Timeout Error"), { code: "UND_ERR_CONNECT_TIMEOUT" }));
const ok = () => new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
const noSleep = async () => {};

test("isConnectFailure: соединение не установилось — запрос не ушёл", () => {
  assert.equal(isConnectFailure(connectTimeout()), true);
  assert.equal(isConnectFailure(fetchFailed(sysError("ECONNREFUSED", "connect"))), true);
  assert.equal(isConnectFailure(fetchFailed(sysError("ETIMEDOUT", "connect"))), true);
  assert.equal(isConnectFailure(fetchFailed(sysError("ENETUNREACH", "connect"))), true);
  assert.equal(isConnectFailure(fetchFailed(sysError("EAI_AGAIN", "getaddrinfo"))), true);
  assert.equal(
    isConnectFailure(fetchFailed(sysError("ECONNRESET", undefined, "Client network socket disconnected before secure TLS connection was established"))),
    true,
  );
  const aggregate = Object.assign(new AggregateError([sysError("ETIMEDOUT", "connect"), sysError("ENETUNREACH", "connect")]), { code: "ETIMEDOUT" });
  assert.equal(isConnectFailure(fetchFailed(aggregate)), true);
});

test("isConnectFailure: обрыв или тайм-аут после соединения — Telegram мог принять запрос", () => {
  assert.equal(isConnectFailure(fetchFailed(Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }))), false);
  assert.equal(isConnectFailure(fetchFailed(sysError("ECONNRESET", "read"))), false);
  assert.equal(isConnectFailure(new DOMException("The operation was aborted due to timeout", "TimeoutError")), false);
  assert.equal(isConnectFailure(new Error("что-то другое")), false);
  assert.equal(isConnectFailure(null), false);
});

test("fetchTelegram: повторяет запрос, пока соединение не установится", async () => {
  let calls = 0;
  const response = await fetchTelegram(async () => {
    calls++;
    if (calls < 3) throw connectTimeout();
    return ok();
  }, { sleep: noSleep });
  assert.equal(response.status, 200);
  assert.equal(calls, 3);
});

test("fetchTelegram: после всех попыток — «не удалось связаться», запрос точно не ушёл", async () => {
  let calls = 0;
  await assert.rejects(
    fetchTelegram(async () => {
      calls++;
      throw connectTimeout();
    }, { sleep: noSleep }),
    (e: unknown) => e instanceof TelegramNetworkError && e.delivery === "not_sent" && e.message === TELEGRAM_UNREACHABLE,
  );
  assert.equal(calls, TELEGRAM_RETRY_DELAYS_MS.length + 1);
});

test("fetchTelegram: ошибку после соединения не повторяет — иначе возможен дубль сообщения", async () => {
  let calls = 0;
  await assert.rejects(
    fetchTelegram(async () => {
      calls++;
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }, { sleep: noSleep }),
    (e: unknown) => e instanceof TelegramNetworkError && e.delivery === "unknown" && e.message === TELEGRAM_NO_ANSWER,
  );
  assert.equal(calls, 1);
});

test("fetchTelegram: ответ Telegram с ошибкой — это ответ, а не сбой сети", async () => {
  let calls = 0;
  const response = await fetchTelegram(async () => {
    calls++;
    return new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: chat not found" }), { status: 400 });
  }, { sleep: noSleep });
  assert.equal(response.status, 400);
  assert.equal(calls, 1);
});
