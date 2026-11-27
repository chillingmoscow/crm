import assert from "node:assert/strict";
import test from "node:test";

import {
  processedInQuickRestoMessage,
  quickRestoActId,
  quickRestoDeleteFailedMessage,
  quickRestoDeleteStep,
} from "./act-delete.ts";

test("quickRestoActId: только положительное целое", () => {
  assert.equal(quickRestoActId("10971"), 10971);
  assert.equal(quickRestoActId(null), null);
  assert.equal(quickRestoActId(""), null);
  assert.equal(quickRestoActId("store-1"), null);
  assert.equal(quickRestoActId("0"), null);
});

test("quickRestoDeleteStep: открытый акт удаляем в Quick Resto", () => {
  assert.equal(quickRestoDeleteStep({ id: 7, processed: false, processingState: "UNPROCESSED" }, 7), "remove");
});

test("quickRestoDeleteStep: без явного «не проведён» не удаляем", () => {
  assert.equal(quickRestoDeleteStep({ id: 7 }, 7), "unknown");
  assert.equal(quickRestoDeleteStep({ id: 7, processingState: "UNPROCESSED" }, 7), "unknown");
  assert.equal(quickRestoDeleteStep({ id: 7, processed: "false" }, 7), "unknown");
});

test("quickRestoDeleteStep: проведённый и проводимый акт не трогаем", () => {
  assert.equal(quickRestoDeleteStep({ id: 7, processed: true }, 7), "processed");
  assert.equal(quickRestoDeleteStep({ id: 7, processed: false, processingState: "PROCESSING" }, 7), "processed");
});

test("quickRestoDeleteStep: уже удалён или не найден — удаляем только у нас", () => {
  assert.equal(quickRestoDeleteStep({ id: 7, deleted: true, processed: false }, 7), "already_deleted");
  assert.equal(quickRestoDeleteStep({ id: 8 }, 7), "missing");
  assert.equal(quickRestoDeleteStep(null, 7), "missing");
});

test("тексты ошибок: номер акта как есть", () => {
  assert.match(processedInQuickRestoMessage("СВ397"), /^Акт № СВ397 проведён в Quick Resto/);
  assert.match(quickRestoDeleteFailedMessage("СВ397"), /^Quick Resto не удалил акт № СВ397 — у нас он тоже остался/);
  assert.match(quickRestoDeleteFailedMessage(null), /^Quick Resto не удалил акт — у нас/);
});
