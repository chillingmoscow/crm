import { test } from "node:test";
import assert from "node:assert/strict";

import { isDeploymentSkewError } from "./deployment-skew.ts";

test("детектит пропавший Server Action (deploy skew)", () => {
  const e = new Error(
    'Failed to find Server Action "8dea774d9f24340c02edfde59fef0b3061ca9d73". This request might be from an older or newer deployment.',
  );
  assert.equal(isDeploymentSkewError(e), true);
});

test("детектит ChunkLoadError по name и по message", () => {
  const byName = Object.assign(new Error("boom"), { name: "ChunkLoadError" });
  assert.equal(isDeploymentSkewError(byName), true);
  assert.equal(
    isDeploymentSkewError(new Error("Loading chunk 42 failed.")),
    true,
  );
  assert.equal(
    isDeploymentSkewError(new Error("Loading CSS chunk 7 failed")),
    true,
  );
});

test("детектит провал динамического импорта модуля", () => {
  assert.equal(
    isDeploymentSkewError(
      new Error("Failed to fetch dynamically imported module: /_next/x.js"),
    ),
    true,
  );
});

test("работает со строкой и plain-object", () => {
  assert.equal(isDeploymentSkewError("ChunkLoadError: nope"), true);
  assert.equal(
    isDeploymentSkewError({ name: "ChunkLoadError", message: "x" }),
    true,
  );
});

test("обычные ошибки НЕ считаются skew (не маскируем реальные баги)", () => {
  assert.equal(
    isDeploymentSkewError(new TypeError("Cannot read properties of undefined")),
    false,
  );
  assert.equal(isDeploymentSkewError(new Error("Network request failed")), false);
  assert.equal(isDeploymentSkewError(null), false);
  assert.equal(isDeploymentSkewError(undefined), false);
  assert.equal(isDeploymentSkewError(42), false);
});
