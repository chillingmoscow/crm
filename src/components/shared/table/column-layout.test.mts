import assert from "node:assert/strict";
import test from "node:test";
import { fitColumnWidths, resizeColumnWidths } from "./column-layout.ts";
const columns = [
  { size: 44, min: 44, max: 44, fixed: true },
  { size: 260, min: 160, max: 600 },
  { size: 180, min: 140, max: 600 },
  { size: 180, min: 120, max: 600 },
];
test("A narrow viewport keeps labels readable and only the table scrolls", () => {
  const fitted = fitColumnWidths(columns, 320);
  assert.deepEqual(fitted, [44, 160, 140, 120]);
});
test("A wide viewport consumes its available width and never expands the checkbox", () => {
  const fitted = fitColumnWidths(columns, 1000);
  assert.equal(fitted[0], 44);
  assert.ok(Math.abs(fitted.reduce((a, b) => a + b) - 1000) < 0.01);
  assert.ok(fitted.every((v, i) => v >= columns[i].min && v <= columns[i].max));
});
test("A large drag cannot change service columns or shrink any header below its minimum", () => {
  const before = fitColumnWidths(columns, 900),
    after = resizeColumnWidths(before, columns, 1, 5000);
  assert.equal(after[0], 44);
  assert.ok(after.every((v, i) => v >= columns[i].min));
  assert.ok(after[1] > before[1]);
  assert.equal(after[2], before[2]);
  assert.equal(after[3], before[3]);
});
test("Dragging in either direction returns the same pixels at release", () => {
  const before = fitColumnWidths(columns, 900),
    larger = resizeColumnWidths(before, columns, 1, 25),
    back = resizeColumnWidths(larger, columns, 1, -25);
  assert.ok(back.every((v, i) => Math.abs(v - before[i]) < 0.01));
});
