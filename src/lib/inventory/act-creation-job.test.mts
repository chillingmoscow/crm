import assert from "node:assert/strict";
import test from "node:test";

import {
  ACT_CREATION_MAX_ATTEMPTS,
  actCreationLabel,
  actCreationProgressText,
  actCreationRetryDelayMs,
  isActCreationActive,
  isActCreationStuck,
} from "./act-creation-job.ts";

test("isActCreationActive: идёт, пока не готово и попытки не кончились", () => {
  assert.equal(isActCreationActive({ state: "pending", attempts: 0 }), true);
  assert.equal(isActCreationActive({ state: "working", attempts: 3 }), true);
  assert.equal(isActCreationActive({ state: "error", attempts: 2 }), true);
  assert.equal(isActCreationActive({ state: "error", attempts: ACT_CREATION_MAX_ATTEMPTS }), false);
  assert.equal(isActCreationActive({ state: "complete", attempts: 1 }), false);
  assert.equal(isActCreationActive(null), false);
});

test("isActCreationStuck: последняя попытка остановилась вместе с процессом", () => {
  const now = Date.parse("2026-11-28T12:00:00Z");
  const expired = "2026-11-28T11:50:00Z";
  const live = "2026-11-28T12:02:00Z";
  const last = ACT_CREATION_MAX_ATTEMPTS;
  assert.equal(isActCreationStuck({ state: "working", attempts: last, lease_until: expired }, now), true);
  assert.equal(isActCreationStuck({ state: "working", attempts: last, lease_until: null }, now), true);
  assert.equal(isActCreationActive({ state: "working", attempts: last, lease_until: expired }, now), false);
  // Последняя попытка ещё идёт — акт создаётся.
  assert.equal(isActCreationStuck({ state: "working", attempts: last, lease_until: live }, now), false);
  assert.equal(isActCreationActive({ state: "working", attempts: last, lease_until: live }, now), true);
  // Не последняя — её подхватит cron.
  assert.equal(isActCreationStuck({ state: "working", attempts: 3, lease_until: expired }, now), false);
});

test("isActCreationStuck: только когда попытки кончились", () => {
  assert.equal(isActCreationStuck({ state: "error", attempts: ACT_CREATION_MAX_ATTEMPTS }), true);
  assert.equal(isActCreationStuck({ state: "error", attempts: 1 }), false);
  assert.equal(isActCreationStuck({ state: "complete", attempts: 9 }), false);
});

test("actCreationRetryDelayMs: растёт и упирается в 10 минут", () => {
  assert.equal(actCreationRetryDelayMs(1), 30_000);
  assert.equal(actCreationRetryDelayMs(2), 60_000);
  assert.equal(actCreationRetryDelayMs(20), 600_000);
});

test("actCreationLabel: в колонке — только короткий статус", () => {
  assert.equal(actCreationLabel({ state: "working", attempts: 1 }), "Создаётся");
  assert.equal(actCreationLabel({ state: "error", attempts: 2 }), "Создаётся");
  assert.equal(actCreationLabel({ state: "error", attempts: ACT_CREATION_MAX_ATTEMPTS }), "Не все позиции");
});

test("actCreationProgressText: ход и оставшееся время — в подсказке", () => {
  const plain = (text: string) => text.replace(/\u00a0/g, " ");
  assert.equal(
    plain(actCreationProgressText({ state: "working", done: 55, total: 313, attempts: 1, error: null })),
    "Добавлено 55 из 313 · осталось около 1 мин 30 с",
  );
  assert.equal(
    actCreationProgressText({ state: "error", done: 120, total: 313, attempts: ACT_CREATION_MAX_ATTEMPTS, error: "x" }),
    "Добавлено 120 из 313",
  );
});
