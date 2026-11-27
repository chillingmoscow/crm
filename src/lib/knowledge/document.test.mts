import test from "node:test";
import assert from "node:assert/strict";

import { kbReadingPlate } from "./document.ts";

const base = { required: true, readAt: null, needsReread: false, gateReady: false };

test("kbReadingPlate: необязательная страница — плашки нет", () => {
  assert.deepEqual(kbReadingPlate({ ...base, required: false }), { kind: "none" });
});

test("kbReadingPlate: не прочитано, порог не пройден — кнопка неактивна", () => {
  assert.deepEqual(kbReadingPlate(base), { kind: "unread", reread: false, canConfirm: false });
});

test("kbReadingPlate: страница изменилась и порог пройден — перечитать, кнопка активна", () => {
  assert.deepEqual(kbReadingPlate({ ...base, needsReread: true, gateReady: true }), {
    kind: "unread",
    reread: true,
    canConfirm: true,
  });
});

test("kbReadingPlate: прочитано — зелёная плашка с датой", () => {
  assert.deepEqual(kbReadingPlate({ ...base, readAt: "2026-11-27T10:00:00Z" }), {
    kind: "read",
    readAt: "2026-11-27T10:00:00Z",
  });
});

test("kbReadingPlate: новая версия важнее старого прочтения", () => {
  assert.deepEqual(
    kbReadingPlate({ ...base, readAt: "2026-11-01T10:00:00Z", needsReread: true, gateReady: true }),
    { kind: "unread", reread: true, canConfirm: true },
  );
});
