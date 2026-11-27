import assert from "node:assert/strict";
import test from "node:test";

import { estimateCreateActSeconds, formatDurationRu } from "./act-create-progress.ts";



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


