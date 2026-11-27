import test from "node:test";
import assert from "node:assert/strict";

import {
  DIALOG_CTA_DISABLED_CLASS,
  DIALOG_TONE_ICON_CLASS,
  archiveImpactToConsequences,
  canConfirm,
  deleteImpactToConsequences,
  hotkeyAllowed,
  hotkeyVerb,
  isConfirmHotkey,
  resolveDialogTone,
  type DialogTone,
  type HotkeyEventLike,
} from "./dialog-tone.ts";

const key = (over: Partial<HotkeyEventLike>): HotkeyEventLike => ({
  key: "Enter",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});

test("resolveDialogTone: destructive wins over tone", () => {
  assert.equal(resolveDialogTone({ destructive: true, tone: "warning" }), "destructive");
  assert.equal(resolveDialogTone({ tone: "warning" }), "warning");
  assert.equal(resolveDialogTone({}), "default");
});

test("isConfirmHotkey: Enter with Cmd or Ctrl", () => {
  assert.equal(isConfirmHotkey(key({ metaKey: true })), true);
  assert.equal(isConfirmHotkey(key({ ctrlKey: true })), true);
  assert.equal(isConfirmHotkey(key({})), false);
  assert.equal(isConfirmHotkey(key({ metaKey: true, shiftKey: true })), false);
  assert.equal(isConfirmHotkey(key({ ctrlKey: true, altKey: true })), false);
  assert.equal(isConfirmHotkey(key({ key: "a", metaKey: true })), false);
});

test("isConfirmHotkey ignores composing", () => {
  assert.equal(isConfirmHotkey(key({ metaKey: true, isComposing: true })), false);
});

test("hotkeyAllowed: never for destructive", () => {
  assert.equal(hotkeyAllowed("destructive"), false);
  assert.equal(hotkeyAllowed("warning"), true);
  assert.equal(hotkeyAllowed("default"), true);
});

test("canConfirm: blocked by busy, confirmDisabled, restriction", () => {
  assert.equal(canConfirm({}), true);
  assert.equal(canConfirm({ busy: true }), false);
  assert.equal(canConfirm({ confirmDisabled: true }), false);
  assert.equal(canConfirm({ restricted: true }), false);
});

test("hotkeyVerb: first word, lower case", () => {
  assert.equal(hotkeyVerb("Перевести в «Не подходит»"), "перевести");
  assert.equal(hotkeyVerb("Отправить"), "отправить");
});

test("deleteImpactToConsequences: cascade first, unbind next, irreversible last, zeros dropped", () => {
  assert.deepEqual(
    deleteImpactToConsequences([
      { label: "Смены", count: 3, tone: "unbind" },
      { label: "Акты", count: 0, tone: "cascade" },
      { label: "Заметки", count: 2, tone: "cascade" },
    ]),
    [
      { kind: "remove", text: "Заметки: удалится вместе с записью", count: 2 },
      { kind: "unlink", text: "Смены: отвяжется, но сохранится", count: 3 },
      { kind: "irreversible", text: "Удаление нельзя отменить" },
    ],
  );
});

test("deleteImpactToConsequences: empty impact keeps the irreversible row", () => {
  assert.deepEqual(deleteImpactToConsequences([]), [
    { kind: "irreversible", text: "Удаление нельзя отменить" },
  ]);
});

test("archiveImpactToConsequences: rows with count > 0", () => {
  assert.deepEqual(
    archiveImpactToConsequences([
      { label: "Склады", count: 2 },
      { label: "Акты", count: 0 },
    ]),
    [{ kind: "archive", text: "Склады: сохранится в архиве", count: 2 }],
  );
});

test("tone class maps cover every tone", () => {
  const tones: DialogTone[] = ["default", "warning", "destructive"];
  for (const tone of tones) {
    assert.ok(DIALOG_TONE_ICON_CLASS[tone], `icon class for ${tone}`);
    assert.ok(DIALOG_CTA_DISABLED_CLASS[tone], `cta class for ${tone}`);
  }
  assert.match(DIALOG_CTA_DISABLED_CLASS.destructive, /disabled:bg-destructive/);
  assert.match(DIALOG_CTA_DISABLED_CLASS.warning, /disabled:bg-brand/);
  assert.match(DIALOG_TONE_ICON_CLASS.warning, /amber/);
});
