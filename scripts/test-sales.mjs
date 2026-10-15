// Financial regression checks against the actual calculation modules, no database mutations.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
const dir = await mkdtemp(join(tmpdir(), "sheerly-sales-tests-"));
try {
  for (const name of ["types", "time", "calculate", "csv"]) {
    const input = await readFile(`src/lib/sales/${name}.ts`, "utf8");
    const output = ts
      .transpileModule(input, {
        compilerOptions: {
          module: ts.ModuleKind.ES2022,
          target: ts.ScriptTarget.ES2022,
        },
      })
      .outputText.replace(/from "\.\/([^"]+)"/g, 'from "./$1.mjs"');
    await writeFile(join(dir, `${name}.mjs`), output);
  }
  const mod = async (name) =>
    import(pathToFileURL(join(dir, `${name}.mjs`)).href);
  const { calculateOrders, zMetrics } = await mod("calculate"),
    { effectiveMetrics } = await mod("types"),
    { businessDate, dayWindow } = await mod("time"),
    { csvCell } = await mod("csv");
  const settings = {
    tip_products: { 679: -1 },
    deposit_products: { 751: -1000 },
    parking_product_ids: [1503],
  };
  const orders = Array.from({ length: 173 }, (_, i) => ({
    id: i + 1,
    payer_id: i >= 170 && i < 172 ? 900 : null,
    gross: 400,
    returned: false,
    deleted: false,
    status: i === 172 ? "canceled" : "",
  }));
  const details = orders.map((o) => ({
    id: o.id,
    returned: false,
    deleted: false,
    service: 20,
    lines: [
      { product_id: 1, amount: 180, quantity: 1 },
      { product_id: 679, amount: 100, quantity: -100 },
      { product_id: 751, amount: 50, quantity: -2 },
      { product_id: 1503, amount: 50, quantity: 1 },
    ],
  }));
  const result = calculateOrders(orders, details, [900], settings);
  assert.equal(result.turnover, 27200);
  assert.equal(result.service, 3440);
  assert.equal(result.parking, 8500);
  assert.equal(result.staff_checks, 800);
  assert.equal(result.checks, 172);
  assert.throws(
    () => calculateOrders(orders.slice(0, 150), details, [900], settings),
    /Неполные/,
  );
  assert.throws(
    () =>
      calculateOrders(
        [...orders, orders[0]],
        [...details, details[0]],
        [900],
        settings,
      ),
    /Неполные/,
  );
  assert.deepEqual(
    zMetrics(
      [
        {
          productOutgoing: [
            { product: { id: 679 }, amount: -100 },
            { product: { id: 751 }, amount: -2 },
          ],
        },
      ],
      settings,
    ),
    { tips: 100, deposits: 2000 },
  );
  assert.throws(() => zMetrics([{}], settings), /отсутствуют позиции/);
  const legacy = effectiveMetrics({
    calculated: { turnover: 100, hookah: 40, tips_total: 12 },
    overrides: {},
  });
  assert.equal(legacy.tips, null);
  assert.equal(legacy.service, null);
  assert.equal(legacy.tips_total, 12);
  assert.equal(
    effectiveMetrics({
      calculated: { turnover: 100, hookah: 40 },
      overrides: { turnover: 120 },
    }).bar,
    80,
  );
  assert.equal(
    effectiveMetrics({
      calculated: { turnover: 100, hookah: 40 },
      overrides: { turnover: 120, bar: 95 },
    }).bar,
    95,
  );
  assert.equal(
    businessDate(new Date("2026-10-13T05:59:59Z"), "Europe/Moscow", 9),
    "2026-10-12",
  );
  const fractional = effectiveMetrics({
    calculated: { turnover: 15.4, hookah: 5.2, tips: 0.1, service: 0.2 },
    overrides: {},
  });
  assert.equal(fractional.bar, 10.2);
  assert.equal(fractional.tips_total, 0.3);
  assert.equal(
    businessDate(new Date("2026-10-13T06:00:00Z"), "Europe/Moscow", 9),
    "2026-10-13",
  );
  let window = dayWindow("2026-03-28", "Europe/London", 9);
  assert.equal(window.end - window.start, 23 * 3600000);
  window = dayWindow("2026-10-24", "Europe/London", 9);
  assert.equal(window.end - window.start, 25 * 3600000);
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  console.log(
    "PASS: 173 receipts, Staff, cancellations, missing pages, Z metrics, legacy unknowns, overrides, day boundary/DST, CSV export",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
