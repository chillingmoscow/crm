import test from "node:test";
import assert from "node:assert/strict";

import {
  DIALOG_FOOTER_CTA_CLASS,
  DIALOG_TONE_ICON_CLASS,
  archiveImpactToConsequences,
  canConfirm,
  deleteImpactToConsequences,
  hotkeyAllowed,
  hotkeyEventFrom,
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

test("isConfirmHotkey ignores IME keyCode 229 and auto-repeat", () => {
  assert.equal(isConfirmHotkey(key({ metaKey: true, keyCode: 229 })), false);
  assert.equal(isConfirmHotkey(key({ metaKey: true, repeat: true })), false);
});

test("hotkeyEventFrom reads composing from the native event", () => {
  const e = { ...key({ metaKey: true }), nativeEvent: { isComposing: true } };
  assert.equal(isConfirmHotkey(hotkeyEventFrom(e)), false);
  const ok = { ...key({ metaKey: true }), nativeEvent: { isComposing: false } };
  assert.equal(isConfirmHotkey(hotkeyEventFrom(ok)), true);
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

test("hotkeyVerb: whole short label, first letter lower case", () => {
  assert.equal(hotkeyVerb("Отправить"), "отправить");
  assert.equal(hotkeyVerb("В архив"), "в архив");
  assert.equal(hotkeyVerb("Не учитывать"), "не учитывать");
  assert.equal(hotkeyVerb("Удалить должность"), "удалить должность");
});

test("hotkeyVerb: long or quoted label falls back to «подтвердить»", () => {
  assert.equal(hotkeyVerb("Перевести в «Не подходит»"), "подтвердить");
  assert.equal(hotkeyVerb("Обновить смены · 12"), "подтвердить");
  assert.equal(hotkeyVerb("Отправить новые приглашения в чаты"), "подтвердить");
});

test("deleteImpactToConsequences: cascade first, unbind next, irreversible last, zeros dropped", () => {
  assert.deepEqual(
    deleteImpactToConsequences([
      { label: "Смены", count: 3, tone: "unbind" },
      { label: "Акты", count: 0, tone: "cascade" },
      { label: "Заметки", count: 2, tone: "cascade" },
    ]),
    [
      { kind: "remove", text: "Заметки: удалятся вместе с записью", count: 2 },
      { kind: "unlink", text: "Смены: отвяжутся, но сохранятся", count: 3 },
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
    [{ kind: "archive", text: "Склады: сохранятся в архиве", count: 2 }],
  );
});

test("tone class maps cover every tone", () => {
  const tones: DialogTone[] = ["default", "warning", "destructive"];
  for (const tone of tones) {
    assert.ok(DIALOG_TONE_ICON_CLASS[tone], `icon class for ${tone}`);
  }
  assert.match(DIALOG_TONE_ICON_CLASS.warning, /amber/);
});

test("footer keeps a disabled filled button in its own colour, pale", () => {
  for (const variant of ["default", "brand", "destructive"]) {
    assert.match(
      DIALOG_FOOTER_CTA_CLASS,
      new RegExp(`\\[&>button\\[data-variant=${variant}\\]:disabled\\]:opacity-40`),
    );
  }
  assert.match(DIALOG_FOOTER_CTA_CLASS, /\[data-variant=destructive\]:disabled\]:bg-destructive/);
  assert.match(DIALOG_FOOTER_CTA_CLASS, /\[data-variant=default\]:disabled\]:bg-brand/);
  assert.doesNotMatch(DIALOG_FOOTER_CTA_CLASS, /data-variant=outline/);
});
