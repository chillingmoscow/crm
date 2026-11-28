import { test } from "node:test";
import assert from "node:assert/strict";
import { attentionKey, serverDataFresh } from "./attention-snapshot.ts";

test("ключ месяцев: без повторов и по порядку", () => {
  assert.equal(attentionKey(["2026-12", "2026-11", "2026-11"]), "2026-11,2026-12");
});

test("серверные данные свежие полминуты", () => {
  const at = 1_000_000;
  assert.equal(serverDataFresh(at, at + 5_000), true);
  assert.equal(serverDataFresh(at, at + 30_000), false);
  assert.equal(serverDataFresh(undefined, at), false);
  // Часы устройства отстают от сервера — не доверяем, перечитываем.
  assert.equal(serverDataFresh(at, at - 1), false);
});
