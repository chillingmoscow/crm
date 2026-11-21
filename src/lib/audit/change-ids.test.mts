import assert from "node:assert/strict";
import test from "node:test";

import { collectChangeIds, resolveChangeIds } from "./change-ids.ts";

const details = {
  changes: [
    { field: "name", old: "Касса", new: "Касса бара" },
    { field: "group_id", old: null, new: "g1" },
    { field: "group_id", old: "g2", new: "g3" },
  ],
};

test("collectChangeIds: только id нужного поля, пустые пропускаются", () => {
  assert.deepEqual(collectChangeIds(details, "group_id"), ["g1", "g2", "g3"]);
  assert.deepEqual(collectChangeIds({}, "group_id"), []);
  assert.deepEqual(collectChangeIds(null, "group_id"), []);
});

test("resolveChangeIds: названия вместо id, удалённая — подписью", () => {
  const names = new Map([
    ["g1", "Банк"],
    ["g3", "Резервы"],
  ]);
  const out = resolveChangeIds(details, "group_id", names, "удалённая группа");
  assert.deepEqual(out.changes, [
    { field: "name", old: "Касса", new: "Касса бара" },
    { field: "group_id", old: null, new: "Банк" },
    { field: "group_id", old: "удалённая группа", new: "Резервы" },
  ]);
  // Исходные данные не меняются.
  assert.equal((details.changes[1] as { new: string }).new, "g1");
});

test("resolveChangeIds: без поля — тот же объект", () => {
  const plain = { changes: [{ field: "name", old: "А", new: "Б" }] };
  assert.equal(resolveChangeIds(plain, "group_id", new Map(), "—"), plain);
});
