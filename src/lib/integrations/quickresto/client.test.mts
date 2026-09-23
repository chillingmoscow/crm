import { test } from "node:test";
import assert from "node:assert/strict";

import { quickRestoFetch } from "./client.ts";

const URL_UNDER_TEST = "https://id.quickresto.ru/realms/QR/protocol/openid-connect/auth";

function networkTypeError(code: string, message = `connect ${code}`) {
  return new TypeError("fetch failed", { cause: { code, message } });
}

test("quickRestoFetch: ретраит сетевую ошибку и возвращает ответ со 2-й попытки", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", () => {
    calls += 1;
    if (calls === 1) throw networkTypeError("ECONNRESET");
    return Promise.resolve(new Response("ok", { status: 200 }));
  });

  const response = await quickRestoFetch(URL_UNDER_TEST, { method: "GET" });

  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test("quickRestoFetch: после 3 неудачных попыток кидает сообщение с хостом и кодом", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", () => {
    calls += 1;
    return Promise.reject(networkTypeError("ECONNREFUSED"));
  });

  await assert.rejects(
    () => quickRestoFetch(URL_UNDER_TEST, { method: "GET" }),
    (error: Error) => {
      assert.match(
        error.message,
        /Quick Resto: не удалось соединиться с id\.quickresto\.ru \(ECONNREFUSED\)/,
      );
      return true;
    },
  );
  assert.equal(calls, 3);
});

test("quickRestoFetch: TLS-ошибку не ретраит", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", () => {
    calls += 1;
    return Promise.reject(networkTypeError("CERT_HAS_EXPIRED", "certificate has expired"));
  });

  await assert.rejects(
    () => quickRestoFetch(URL_UNDER_TEST, { method: "GET" }),
    /\(CERT_HAS_EXPIRED\)/,
  );
  assert.equal(calls, 1);
});

test("quickRestoFetch: HTTP-статус не считается сетевой ошибкой — ответ возвращается как есть", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", () => {
    calls += 1;
    return Promise.resolve(new Response("boom", { status: 500 }));
  });

  const response = await quickRestoFetch(URL_UNDER_TEST, { method: "GET" });
  assert.equal(response.status, 500);
  assert.equal(calls, 1);
});
