import { test } from "node:test";
import assert from "node:assert/strict";

import {
  loginQuickRestoBackOffice,
  processInventoryDocumentBackOffice,
  quickRestoFetch,
  selectInventoryItemsBackOffice,
  readInventoryDocument,
  updateInventoryItemBackOffice,
  callQuickRestoBackOfficeData,
  QuickRestoRateLimitError,
} from "./client.ts";

const URL_UNDER_TEST = "https://id.quickresto.ru/realms/QR/protocol/openid-connect/auth";

test("inventory item update retries a rejected 429 with the same absolute quantity", async (t) => {
  const bodies: string[] = [];
  t.mock.method(globalThis, "fetch", (_url: string, init: RequestInit) => {
    bodies.push(String(init.body));
    return Promise.resolve(bodies.length === 1
      ? new Response("nginx", { status: 429, headers: { "Retry-After": "0" } })
      : Response.json({ id: 42, actualAmount: 1.6 }));
  });
  const result = await updateInventoryItemBackOffice({
    layerName: "rate-limit-item", authorization: "Bearer hidden", documentId: 7,
    item: { id: 42, actualAmount: 0 }, actualAmount: 1.6,
  });
  assert.equal(result.actualAmount, 1.6);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
});

test("public inventory read recovers from nginx 429", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", () => Promise.resolve(++calls === 1
    ? new Response("nginx", { status: 429, headers: { "Retry-After": "0" } })
    : Response.json({ id: 7, processed: false })));
  assert.equal((await readInventoryDocument({
    layerName: "rate-limit-public", login: "api", password: "hidden", objectId: 7,
  })).id, 7);
  assert.equal(calls, 2);
});

test("document creation is not replayed and hides the nginx response", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", () => {
    calls += 1;
    return Promise.resolve(new Response("Bearer leaked-token nginx", { status: 429 }));
  });
  await assert.rejects(() => callQuickRestoBackOfficeData({
    layerName: "rate-limit-create", authorization: "Bearer hidden",
    path: "warehouse.inventory.document.v2/create", body: { invoiceDate: 0 },
  }), (error: Error) => {
    assert.ok(error instanceof QuickRestoRateLimitError);
    assert.doesNotMatch(error.message, /leaked-token|nginx/);
    return true;
  });
  assert.equal(calls, 1);
});

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

test("back-office read: 401 does not expose response body or token", async (t) => {
  t.mock.method(globalThis, "fetch", () =>
    Promise.resolve(new Response("Bearer leaked-token", { status: 401 })),
  );
  await assert.rejects(
    () => selectInventoryItemsBackOffice({ layerName: "example", authorization: "Bearer real-token", documentId: 1 }),
    (error: Error) => {
      assert.equal(error.message, "Quick Resto back-office auth failed (401)");
      return true;
    },
  );
});

test("Keycloak login exchanges authorization code for a Bearer token", async (t) => {
  let step = 0;
  t.mock.method(globalThis, "fetch", (_url: string, init: RequestInit) => {
    step += 1;
    if (step === 1) return Promise.resolve(new Response('{"loginAction":"https://id.quickresto.ru/login-one"}', { status: 200 }));
    if (step === 2) return Promise.resolve(new Response('{"loginAction":"https://id.quickresto.ru/login-two"}', { status: 200 }));
    if (step === 3) return Promise.resolve(new Response(null, { status: 302, headers: { Location: "https://example.quickresto.ru/?code=one-time-code" } }));
    assert.match(String(init.body), /grant_type=authorization_code/);
    return Promise.resolve(Response.json({ access_token: "short-lived-token", expires_in: 300 }));
  });
  const result = await loginQuickRestoBackOffice({ layerName: "example", login: "bot@example.com", password: "secret" });
  assert.equal(result.authorization, "Bearer short-lived-token");
  assert.equal(result.expiresInSeconds, 300);
  assert.equal(step, 4);
});

test("Keycloak token exchange error does not expose response secrets", async (t) => {
  let step = 0;
  t.mock.method(globalThis, "fetch", () => {
    step += 1;
    if (step === 1) return Promise.resolve(new Response('{"loginAction":"https://id.quickresto.ru/login-one"}', { status: 200 }));
    if (step === 2) return Promise.resolve(new Response('{"loginAction":"https://id.quickresto.ru/login-two"}', { status: 200 }));
    if (step === 3) return Promise.resolve(new Response(null, { status: 302, headers: { Location: "https://example.quickresto.ru/?code=one-time-code" } }));
    return Promise.resolve(new Response("Bearer leaked-token", { status: 400 }));
  });
  await assert.rejects(
    () => loginQuickRestoBackOffice({ layerName: "example", login: "bot@example.com", password: "secret" }),
    (error: Error) => {
      assert.match(error.message, /token exchange failed \(400\)/);
      assert.doesNotMatch(error.message, /leaked-token|secret/);
      return true;
    },
  );
});

test("back-office action: 403 reports missing permissions without leaking response body", async (t) => {
  t.mock.method(globalThis, "fetch", () =>
    Promise.resolve(new Response("Bearer leaked-token", { status: 403 })),
  );
  await assert.rejects(
    () => processInventoryDocumentBackOffice({ layerName: "example", authorization: "Bearer real-token", documentId: 1 }),
    (error: Error) => {
      assert.match(error.message, /access denied \(403\)/);
      assert.doesNotMatch(error.message, /leaked-token|real-token/);
      return true;
    },
  );
});

test("back-office action: login redirect is classified for token refresh", async (t) => {
  t.mock.method(globalThis, "fetch", () =>
    Promise.resolve(new Response(null, { status: 302, headers: { Location: "https://id.quickresto.ru/login" } })),
  );
  await assert.rejects(
    () => processInventoryDocumentBackOffice({ layerName: "example", authorization: "Bearer real-token", documentId: 1 }),
    /Quick Resto back-office auth failed \(302\)/,
  );
});

// Creation may commit before a connection reset; reconciliation owns the retry.
test("quickRestoFetch: creation does not replay an ambiguous network failure", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", () => {
    calls++;
    throw networkTypeError("ECONNRESET");
  });
  await assert.rejects(() => quickRestoFetch("https://example.quickresto.ru/platform/online/api/create", {
    method: "POST", body: JSON.stringify({ firstName: "QA" }),
  }, { retryNetwork: false }));
  assert.equal(calls, 1);
});
