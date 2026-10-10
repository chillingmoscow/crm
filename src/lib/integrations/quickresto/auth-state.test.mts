import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isBackOfficeAuthError,
  isBackOfficeAuthFresh,
  isBackOfficePermissionError,
  parseStoredBackOfficeAuth,
} from "./auth-state.ts";

test("Keycloak cache: only tokens with a known future expiry are reusable", () => {
  const now = Date.parse("2026-10-01T12:00:00.000Z");
  const token = { authorization: "Bearer secret", expiresAt: null };
  assert.equal(isBackOfficeAuthFresh(token, now), false);
  assert.equal(isBackOfficeAuthFresh({ ...token, expiresAt: "invalid" }, now), false);
  assert.equal(isBackOfficeAuthFresh({ ...token, expiresAt: new Date(now + 60_000).toISOString() }, now), false);
  assert.equal(isBackOfficeAuthFresh({ ...token, expiresAt: new Date(now + 61_000).toISOString() }, now), true);
  assert.equal(parseStoredBackOfficeAuth("JSESSIONID=legacy"), null);
});

test("Keycloak retry: refresh on 401, preserve 403 as a permissions error", () => {
  assert.equal(isBackOfficeAuthError(new Error("Quick Resto back-office auth failed (401)")), true);
  assert.equal(isBackOfficeAuthError(new Error("Quick Resto back-office auth failed (302)")), true);
  assert.equal(isBackOfficeAuthError(new Error("Quick Resto back-office access denied (403)")), false);
  assert.equal(isBackOfficePermissionError(new Error("Quick Resto back-office access denied (403)")), true);
});
