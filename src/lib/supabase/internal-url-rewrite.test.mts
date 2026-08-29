import assert from "node:assert/strict";
import test from "node:test";

import { isRewriteEnabled, normalizeBase, rewriteToInternal } from "./internal-url-rewrite.ts";

const PUB = "https://supabase.sheerly.app";
const INT = "http://supabase-kong-abc:8000";

test("запрос к Supabase уходит на внутренний адрес", () => {
  assert.equal(
    rewriteToInternal(`${PUB}/rest/v1/documents?select=id`, PUB, INT),
    `${INT}/rest/v1/documents?select=id`,
  );
  assert.equal(rewriteToInternal(`${PUB}/auth/v1/user`, PUB, INT), `${INT}/auth/v1/user`);
});

test("без внутреннего адреса ничего не меняется", () => {
  const url = `${PUB}/rest/v1/documents`;
  assert.equal(rewriteToInternal(url, PUB, ""), url);
  assert.equal(isRewriteEnabled(PUB, ""), false);
});

test("совпадающие адреса подмену не включают", () => {
  assert.equal(isRewriteEnabled(PUB, PUB), false);
  assert.equal(rewriteToInternal(`${PUB}/rest/v1/x`, PUB, PUB), `${PUB}/rest/v1/x`);
});

test("чужие адреса не трогаем — через тот же fetch ходит не только Supabase", () => {
  const foreign = "https://api.quickresto.ru/platform/data";
  assert.equal(rewriteToInternal(foreign, PUB, INT), foreign);
});

test("похожий, но другой хост не подменяется", () => {
  // Проверка границы: префикс совпадает, а адрес — чужой.
  const lookalike = `${PUB}-staging/rest/v1/documents`;
  assert.equal(rewriteToInternal(lookalike, PUB, INT), lookalike);
});

test("хвостовые слэши не дают двойного слэша при склейке", () => {
  assert.equal(normalizeBase("https://x.dev/"), "https://x.dev");
  assert.equal(normalizeBase("https://x.dev///"), "https://x.dev");
  assert.equal(normalizeBase(undefined), "");
  assert.equal(
    rewriteToInternal(`${PUB}/rest/v1/x`, normalizeBase(`${PUB}/`), normalizeBase(`${INT}/`)),
    `${INT}/rest/v1/x`,
  );
});

test("голый базовый адрес тоже подменяется", () => {
  assert.equal(rewriteToInternal(PUB, PUB, INT), INT);
});
