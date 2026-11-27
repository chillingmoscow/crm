import test from "node:test";
import assert from "node:assert/strict";
import { FORECAST_WEIGHTS, forecastShare, forecastTurnover, monthWeight, priceLevel } from "./forecast.ts";

const FLAT = Array(12).fill(1);
const UNIFORM = Array(7).fill(1);
const days = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
const round10k = (n: number) => Math.round(n / 10000) * 10000;
const series = (entries: [string, number][]) => new Map(entries);

test("priceLevel: подъём 16-го — половина месяца", () => {
  const changes = [{ date: "2026-11-16", percent: 10 }];
  assert.ok(Math.abs(priceLevel(changes, "2026-11-01") - 1.1 ** (15 / 30)) < 1e-9);
  assert.ok(Math.abs(priceLevel(changes, "2026-12-01") - 1.1) < 1e-9);
  assert.equal(priceLevel(changes, "2026-10-01"), 1);
});

test("monthWeight: пятницы и субботы весят больше", () => {
  const w = [1, 1, 1, 1, 2, 2, 1];
  const byCalendar = (m: string) => {
    let sum = 0;
    for (let d = 1; d <= days(m); d++) {
      const wd = (new Date(`${m.slice(0, 8)}${String(d).padStart(2, "0")}T12:00:00Z`).getUTCDay() + 6) % 7;
      sum += w[wd];
    }
    return sum;
  };
  assert.equal(monthWeight(w, "2026-11-01"), byCalendar("2026-11-01"));
  assert.ok(monthWeight(w, "2026-11-01") > monthWeight(w, "2026-02-01"));
  assert.equal(monthWeight(UNIFORM, "2026-12-01"), 31);
});

const autumn = series([["2026-09-01", 3_600_000], ["2026-10-01", 4_150_000], ["2026-11-01", 3_750_000]]);
const complete = (keys: string[]) => new Set(keys);

test("forecast: без истории года — только М и У с весами 0,6/0,4", () => {
  const f = forecastTurnover({
    target: "2026-12-01", turnover: autumn, complete: complete([...autumn.keys()]),
    prices: [], season: FLAT, weekdayWeights: UNIFORM,
  });
  const z = (m: string) => autumn.get(m)! / days(m);
  const mom = z("2026-11-01") * 31;
  const level = ((z("2026-09-01") + z("2026-10-01") + z("2026-11-01")) / 3) * 31;
  assert.deepEqual(f.estimates.map((e) => [e.key, e.weight]), [["mom", 0.6], ["level", 0.4]]);
  assert.equal(f.value, round10k(0.6 * mom + 0.4 * level));
});

test("forecast: неполный месяц не база — берём последний полный", () => {
  const f = forecastTurnover({
    target: "2026-12-01", turnover: autumn, complete: complete(["2026-09-01", "2026-10-01"]),
    prices: [], season: FLAT, weekdayWeights: UNIFORM,
  });
  const z = (m: string) => autumn.get(m)! / days(m);
  // Ноябрь идёт: «месяц к месяцу» — от октября, «уровень» — по октябрю и сентябрю.
  assert.deepEqual(f.estimates.map((e) => e.key), ["mom", "level"]);
  assert.match(f.estimates[0].basis, /октябрь 2026/);
  assert.equal(f.value, round10k(0.6 * z("2026-10-01") * 31 + 0.4 * ((z("2026-09-01") + z("2026-10-01")) / 2) * 31));
});

test("forecast: год к году при идущем прошлом месяце — темп по последним полным", () => {
  const t = twoYears();
  const done = complete([...t.keys()].filter((m) => m !== "2026-11-01"));
  const f = forecastTurnover({ target: "2026-12-01", turnover: t, complete: done, prices: [], season: FLAT, weekdayWeights: UNIFORM });
  assert.deepEqual(f.estimates.map((e) => e.key), ["yoy", "mom", "level"]);
});

test("forecast: истории нет совсем — прогноза нет", () => {
  const f = forecastTurnover({ target: "2026-12-01", turnover: new Map(), complete: new Set(), prices: [], season: FLAT, weekdayWeights: UNIFORM });
  assert.equal(f.value, null);
  assert.deepEqual(f.estimates, []);
});

/** Два года по 3 000 000 в месяц, в текущем году +10%. */
function twoYears(lastYear = 3_000_000, thisYear = 3_300_000) {
  const m = new Map<string, number>();
  for (let i = 0; i < 24; i++) {
    const d = new Date(Date.UTC(2024, 11 + i, 1));
    const key = d.toISOString().slice(0, 10);
    m.set(key, key >= "2025-12-01" ? thisYear : lastYear);
  }
  return m;
}

test("forecast: все три оценки и веса 0,5/0,3/0,2", () => {
  const t = twoYears();
  const f = forecastTurnover({ target: "2026-12-01", turnover: t, complete: complete([...t.keys()]), prices: [], season: FLAT, weekdayWeights: UNIFORM });
  assert.deepEqual(f.estimates.map((e) => [e.key, e.weight]), [["yoy", FORECAST_WEIGHTS.turnover.yoy], ["mom", 0.3], ["level", 0.2]]);
  const weighted = f.estimates.reduce((s, e) => s + e.value * e.weight, 0);
  assert.equal(f.value, round10k(weighted));
  assert.equal(f.value! % 10000, 0);
  for (const e of f.estimates) assert.ok(e.basis.length > 0);
});

test("forecast: расхождение больше 15% помечено", () => {
  const t = twoYears(1_000_000, 3_300_000);
  t.set("2025-12-01", 6_000_000); // прошлый декабрь резко выше — оценка год к году уходит вверх
  const f = forecastTurnover({ target: "2026-12-01", turnover: t, complete: complete([...t.keys()]), prices: [], season: FLAT, weekdayWeights: UNIFORM });
  assert.equal(f.diverge, true);
});

test("forecast: цены поднялись после базы — оценка выше", () => {
  const base = { target: "2026-12-01", turnover: autumn, complete: complete([...autumn.keys()]), season: FLAT, weekdayWeights: UNIFORM };
  const plain = forecastTurnover({ ...base, prices: [] });
  const raised = forecastTurnover({ ...base, prices: [{ date: "2026-12-01", percent: 10 }] });
  assert.ok(raised.value! > plain.value!);
});

test("share: год к году и месяц к месяцу, до 0,1", () => {
  const share = series([
    ["2025-09-01", 7], ["2025-10-01", 9], ["2025-11-01", 9.5], ["2025-12-01", 11],
    ["2026-09-01", 7.8], ["2026-10-01", 10.4], ["2026-11-01", 10.3],
  ]);
  const f = forecastShare({ target: "2026-12-01", share, complete: complete([...share.keys()]) });
  const yoy = 11 + ((7.8 + 10.4 + 10.3) / 3 - (7 + 9 + 9.5) / 3);
  const mom = 10.3 * (11 / 9.5);
  assert.deepEqual(f.estimates.map((e) => [e.key, e.weight]), [["yoy", 0.6], ["mom", 0.4]]);
  assert.equal(f.value, Math.round((0.6 * yoy + 0.4 * mom) * 10) / 10);
});

test("share: без прошлого года — прошлый месяц", () => {
  const share = series([["2026-10-01", 10.4], ["2026-11-01", 10.3]]);
  const f = forecastShare({ target: "2026-12-01", share, complete: complete([...share.keys()]) });
  assert.deepEqual(f.estimates.map((e) => e.key), ["mom"]);
  assert.equal(f.value, 10.3);
});
