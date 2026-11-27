import test from "node:test";
import assert from "node:assert/strict";
import { carryAlert, kpiAlert, kpiPlanAlert, reconcileAlert, shortAlert, transferAlert } from "./payout-alert-text.ts";

test("карточка сверки: сколько проведено и сколько изъято", () => {
  const a = reconcileAlert({
    date: "2026-12-05",
    issued: 110000,
    withdrawn: 65000,
    lines: [{ name: "Гамлет", amount: 65000 }, { name: "Анна", amount: 45000 }],
  });
  assert.equal(a.title, "Проверьте выдачу 05.12: проведено 110 000 ₽, изъято 65 000 ₽");
  assert.deepEqual(a.lines.slice(0, 2), ["Гамлет — 65 000 ₽", "Анна — 45 000 ₽"]);
});

test("карточка нехватки наличных", () => {
  const a = shortAlert("2026-12-16", [{ name: "Гамлет", amount: 20000 }]);
  assert.equal(a.title, "Не хватило наличных 16.12");
  assert.equal(a.lines[0], "Гамлет — не выдано 20 000 ₽");
});

test("карточка переноса: месяц и причины", () => {
  const a = carryAlert("2026-11-01", [{ name: "Анна", reason: "не выдано по плану 20 000 ₽" }]);
  assert.equal(a.title, "Перенос остатка за ноябрь ждёт");
  assert.equal(a.lines[0], "Анна — не выдано по плану 20 000 ₽");
});

test("карточка выплаты переводом", () => {
  const a = transferAlert({ month: "2026-11-01", payoutNo: 1, name: "Татьяна", amount: 25000.5 });
  assert.equal(a.title, "Выплата переводом не внесена: Татьяна");
  assert.equal(a.lines[0], "Первая выплата за ноябрь — 25 000,50 ₽.");
});

test("карточка KPI: кто не подведён за месяц", () => {
  assert.deepEqual(kpiAlert("2026-11-01", [{ name: "Гамлет", role: "Старший бармен" }]), {
    title: "KPI за ноябрь 2026 не подведены",
    lines: ["Гамлет — Старший бармен"],
  });
});

test("карточка плана алкоголя: на какой месяц нет плана", () => {
  assert.deepEqual(kpiPlanAlert("2026-12-01"), {
    title: "План продаж алкоголя на декабрь 2026 не задан",
    lines: ["Задайте план во вкладке «KPI» зарплаты"],
  });
});

test("карточка KPI: итог без плана — досчитать", () => {
  assert.deepEqual(kpiAlert("2026-11-01", [{ name: "Гамлет", role: "Старший бармен", recount: true }]), {
    title: "KPI за ноябрь 2026 не подведены",
    lines: ["Гамлет — Старший бармен: досчитайте план, когда придёт отчёт продаж"],
  });
});
