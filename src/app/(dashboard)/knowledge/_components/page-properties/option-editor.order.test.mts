import { test } from "node:test";
import assert from "node:assert/strict";
import { PALETTE_GRID } from "../../../../../lib/palette.ts";

test("PALETTE_GRID is 10 entries, default first, matching mzhv4 order", () => {
  assert.equal(PALETTE_GRID.length, 10);
  assert.equal(PALETTE_GRID[0].name, "default");
  assert.deepEqual(
    PALETTE_GRID.map((c) => c.name),
    [
      "default",
      "gray",
      "brown",
      "orange",
      "yellow",
      "green",
      "blue",
      "purple",
      "pink",
      "red",
    ],
  );
});
