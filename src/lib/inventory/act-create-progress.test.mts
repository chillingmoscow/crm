import assert from "node:assert/strict";
import test from "node:test";

import {
  createProgressStore,
  estimateCreateActSeconds,
  formatDurationRu,
  progressFraction,
  remainingSeconds,
} from "./act-create-progress.ts";

test("progress store: ход видит только тот, кто создаёт акт", () => {
  const store = createProgressStore(() => 1_000);
  store.set("a1", "u1", { phase: "items", done: 10, total: 313 });
  assert.deepEqual(store.get("a1", "u1"), { phase: "items", done: 10, total: 313 });
  assert.equal(store.get("a1", "u2"), null);
  assert.equal(store.get("nope", "u1"), null);
  store.delete("a1");
  assert.equal(store.get("a1", "u1"), null);
});

test("progress store: брошенная запись устаревает", () => {
  let now = 0;
  const store = createProgressStore(() => now);
  store.set("a1", "u1", { phase: "creating", done: 0, total: 5 });
  now = 16 * 60_000;
  assert.equal(store.get("a1", "u1"), null);
});

test("estimateCreateActSeconds: 313 позиций — около двух минут", () => {
  const seconds = estimateCreateActSeconds(313);
  assert.ok(seconds > 100 && seconds < 140, String(seconds));
  assert.equal(plain(formatDurationRu(seconds)), "2 мин");
});

const plain = (text: string) => text.replace(/\u00a0/g, " ");

test("formatDurationRu: неразрывные пробелы", () => {
  assert.ok(!formatDurationRu(91).includes(" "));
});

test("formatDurationRu", () => {
  assert.equal(plain(formatDurationRu(3)), "5 с");
  assert.equal(plain(formatDurationRu(38)), "40 с");
  assert.equal(plain(formatDurationRu(60)), "1 мин");
  assert.equal(plain(formatDurationRu(91)), "1 мин 30 с");
  assert.equal(plain(formatDurationRu(119)), "2 мин");
  assert.equal(plain(formatDurationRu(300)), "5 мин");
});

test("progressFraction: реальный ход важнее времени, без хода — не выше 95%", () => {
  assert.equal(progressFraction({ progress: null, elapsedSeconds: 500, estimatedSeconds: 100 }), 0.95);
  assert.equal(progressFraction({ progress: null, elapsedSeconds: 50, estimatedSeconds: 100 }), 0.5);
  const half = progressFraction({ progress: { phase: "items", done: 150, total: 300 }, elapsedSeconds: 1, estimatedSeconds: 100 });
  assert.ok(Math.abs(half - 0.5) < 1e-9);
  assert.equal(progressFraction({ progress: { phase: "finishing", done: 300, total: 300 }, elapsedSeconds: 1, estimatedSeconds: 100 }), 0.97);
});

test("remainingSeconds: по оставшимся позициям", () => {
  assert.ok(remainingSeconds({ progress: { phase: "items", done: 300, total: 313 }, elapsedSeconds: 0, estimatedSeconds: 0 }) < 10);
  assert.equal(remainingSeconds({ progress: null, elapsedSeconds: 30, estimatedSeconds: 100 }), 70);
});
