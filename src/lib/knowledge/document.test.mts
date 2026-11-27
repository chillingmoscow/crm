import test from "node:test";
import assert from "node:assert/strict";

import { kbPageMenuGroups, kbReadingPlate } from "./document.ts";

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

const allRights = {
  canEdit: true,
  canDelete: true,
  canDuplicate: true,
  canExport: true,
  canImport: true,
  canManageTemplates: true,
  canManageRequiredReading: true,
  canLock: true,
  canViewVersionHistory: true,
};

test("kbPageMenuGroups: полный набор прав — 9 пунктов в 7 группах", () => {
  assert.deepEqual(kbPageMenuGroups(allRights), [
    ["template"],
    ["show-children"],
    ["required", "lock"],
    ["duplicate"],
    ["export", "import"],
    ["history"],
    ["delete"],
  ]);
});

test("kbPageMenuGroups: права как раньше — каждый пункт по своему праву", () => {
  const noEdit = kbPageMenuGroups({ ...allRights, canEdit: false }).flat();
  assert.equal(noEdit.includes("show-children"), false);
  assert.equal(noEdit.includes("template"), true);
  const keys = kbPageMenuGroups({
    ...allRights,
    canManageTemplates: false,
    canManageRequiredReading: false,
    canImport: false,
  }).flat();
  for (const k of ["template", "required", "import"]) {
    assert.equal(keys.includes(k as never), false, k);
  }
});

test("kbPageMenuGroups: избранное, отмена и аналитика из меню убраны при любых правах", () => {
  const keys = kbPageMenuGroups(allRights).flat() as string[];
  for (const k of ["favorite", "undo", "redo", "analytics", "who-read"]) {
    assert.equal(keys.includes(k), false, k);
  }
});

test("kbPageMenuGroups: пустые группы выкидываются", () => {
  const groups = kbPageMenuGroups({
    canEdit: false,
    canDelete: false,
    canDuplicate: false,
    canExport: false,
    canImport: false,
    canManageTemplates: false,
    canManageRequiredReading: false,
    canLock: false,
    canViewVersionHistory: false,
  });
  assert.deepEqual(groups, []);
});
