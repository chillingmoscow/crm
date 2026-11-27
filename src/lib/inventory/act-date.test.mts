import assert from "node:assert/strict";
import test from "node:test";

import {
  backOfficeTimeZoneParam,
  getInventoryDateLockReason,
  invoiceDayInZone,
  isCalendarDay,
  moveInvoiceDateToDay,
} from "./act-date.ts";

const MSK = "Europe/Moscow";

test("isCalendarDay отсекает несуществующие дни и чужой формат", () => {
  assert.equal(isCalendarDay("2026-11-27"), true);
  assert.equal(isCalendarDay("2026-02-29"), false);
  assert.equal(isCalendarDay("2026-13-01"), false);
  assert.equal(isCalendarDay("27.11.2026"), false);
  assert.equal(isCalendarDay(""), false);
});

test("invoiceDayInZone берёт день по поясу заведения, а не UTC", () => {
  // 22:30 UTC 16-го — это уже 17-е в Москве.
  assert.equal(invoiceDayInZone("2026-11-16T22:30:00.000Z", MSK), "2026-11-17");
  assert.equal(invoiceDayInZone("2026-11-16T09:00:00.000Z", MSK), "2026-11-16");
  assert.equal(invoiceDayInZone(null, MSK), null);
  assert.equal(invoiceDayInZone("не дата", MSK), null);
});

test("moveInvoiceDateToDay сохраняет время суток акта и меняет только день", () => {
  // 23:59:59 по Москве 20.11 → 23:59:59 по Москве 18.11.
  const moved = moveInvoiceDateToDay({
    original: "2026-11-20T20:59:59.000Z",
    day: "2026-11-18",
    timeZone: MSK,
  });
  assert.equal(new Date(moved!).toISOString(), "2026-11-18T20:59:59.000Z");
});

test("moveInvoiceDateToDay без исходной даты ставит полдень по времени заведения", () => {
  const moved = moveInvoiceDateToDay({ original: null, day: "2026-11-18", timeZone: MSK });
  assert.equal(new Date(moved!).toISOString(), "2026-11-18T09:00:00.000Z");
});

test("moveInvoiceDateToDay учитывает переход на летнее время", () => {
  // Берлин: 10:00 местного зимой = 09:00Z, летом = 08:00Z.
  const moved = moveInvoiceDateToDay({
    original: "2026-01-10T09:00:00.000Z",
    day: "2026-07-10",
    timeZone: "Europe/Berlin",
  });
  assert.equal(new Date(moved!).toISOString(), "2026-07-10T08:00:00.000Z");
});

test("moveInvoiceDateToDay отклоняет невалидный день", () => {
  assert.equal(moveInvoiceDateToDay({ original: null, day: "2026-02-30", timeZone: MSK }), null);
});

test("getInventoryDateLockReason: проведённый, зафиксированный и удалённый акт — без смены даты", () => {
  const open = { status: "in_progress", processed: false, results_finalized_at: null, archived_at: null };
  assert.equal(getInventoryDateLockReason(open), null);
  assert.equal(getInventoryDateLockReason({ ...open, status: "ready_for_review" }), null);
  assert.equal(getInventoryDateLockReason({ ...open, status: "recount_pending" }), null);
  assert.match(getInventoryDateLockReason({ ...open, status: "processed" })!, /проведён/);
  assert.match(getInventoryDateLockReason({ ...open, processed: true })!, /проведён/);
  assert.match(
    getInventoryDateLockReason({ ...open, results_finalized_at: "2026-11-20T10:00:00Z" })!,
    /зафиксированы/,
  );
  assert.match(getInventoryDateLockReason({ ...open, archived_at: "2026-11-20T10:00:00Z" })!, /удалён/);
});

test("timeZone для бэк-офиса — как getTimezoneOffset в поясе заведения", () => {
  const at = Date.parse("2026-11-25T15:00:00Z");
  assert.equal(backOfficeTimeZoneParam(at, "Europe/Moscow"), -180);
  assert.equal(backOfficeTimeZoneParam(at, "UTC"), 0);
  assert.equal(backOfficeTimeZoneParam(Date.parse("2026-07-01T12:00:00Z"), "Europe/Berlin"), -120);
});
