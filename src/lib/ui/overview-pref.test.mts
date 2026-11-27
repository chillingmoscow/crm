import { test } from "node:test";
import assert from "node:assert/strict";
import { overviewCookieName, parseOverviewCookie } from "./overview-pref.ts";

test("имя cookie обзора — без точек и прочих символов", () => {
  assert.equal(overviewCookieName("people.overview.staff"), "sheerly_overview_people_overview_staff");
  assert.equal(overviewCookieName("payroll.overview"), "sheerly_overview_payroll_overview");
});

test("значение cookie обзора", () => {
  assert.equal(parseOverviewCookie("open"), true);
  assert.equal(parseOverviewCookie("closed"), false);
  assert.equal(parseOverviewCookie(undefined), undefined);
  assert.equal(parseOverviewCookie("junk"), undefined);
});
