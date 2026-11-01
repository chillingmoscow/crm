// Complete invoice source, independent financial list and date/identity guards.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
const dir = await mkdtemp(join(tmpdir(), "supply-reader-"));
try {
  for (const [name, path] of [
    ["source", "src/lib/supplies/source.ts"],
    ["canonical", "src/lib/source/canonical.ts"],
  ]) {
    let code = ts
      .transpileModule(await readFile(path, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.ES2022,
          target: ts.ScriptTarget.ES2022,
        },
      })
      .outputText.replace(
        /from ["']zod["']/g,
        `from ${JSON.stringify(import.meta.resolve("zod"))}`,
      )
      .replace("@/lib/source/canonical", "./canonical.mjs");
    await writeFile(join(dir, name + ".mjs"), code);
  }
  const {
    advanceSupplyRead: advance,
    normalizeSupplyHeader: header,
    normalizeSupplyList: financial,
    supplyCalendarDate,
  } = await import(pathToFileURL(join(dir, "source.mjs")));
  const grid = (id) => ({
    object: {
      id,
      version: 1,
      documentNumber: "SAME NUMBER",
      invoiceDate: Date.parse("2026-10-01T21:30:00Z"),
      provider: { id: 1, title: "Supplier" },
      store: { id: 2, title: "Store" },
      authorWeb: { title: "Author" },
      processed: true,
      paid: true,
      totalSum: 0.29,
      deleted: false,
    },
  });
  const pub = (id) => ({
    id,
    documentNumber: "SAME NUMBER",
    invoiceDate: "2026-10-01T21:30:00Z",
    provider: { id: 1 },
    store: { id: 2, liteBusiness: { id: 1 } },
    processed: true,
    paid: true,
    totalSum: 0.29,
    paymentDate: "2026-10-02T21:30:00Z",
    transactionAccount: { id: 7, name: "Bank" },
  });
  const h = header(grid(1));
  assert.equal(h.amountCents, 29);
  assert.equal(supplyCalendarDate(h.invoiceAt, "Europe/Moscow"), "2026-10-02");
  const facts = financial([pub(1)], [h], "Europe/Moscow", [1]);
  assert.equal(facts[0].paidDate, "2026-10-03");
  assert.deepEqual(facts[0].issues, []);
  assert.throws(
    () => financial([pub(1)], [h], "Europe/Moscow", [2]),
    /неподтверждённому/,
  );
  assert.throws(() => financial([], [h], "Europe/Moscow", [1]), /полный/);
  assert.throws(
    () => financial([pub(2)], [h], "Europe/Moscow", [1]),
    /отсутствующая/,
  );
  assert.throws(
    () => financial([{ ...pub(1), totalSum: 0.28 }], [h], "Europe/Moscow", [1]),
    /изменилась/,
  );
  const missing = financial(
    [{ ...pub(1), paymentDate: null, transactionAccount: null }],
    [h],
    "Europe/Moscow",
    [1],
  );
  assert.deepEqual(missing[0].issues, [
    "Не указана дата оплаты",
    "Не указан счёт оплаты",
  ]);
  assert.throws(
    () => header({ object: { ...grid(1).object, deleted: true } }),
    /удалённую/,
  );
  assert.throws(
    () => header({ object: { ...grid(1).object, totalSum: -1 } }),
    /сумма/,
  );
  let j = {
      phase: "grid_first",
      cursor: 0,
      payload: { first: [], second: [], facts: [] },
      request: { timezone: "Europe/Moscow", businessIds: [1] },
    },
    pages = [],
    financialReads = 0,
    published;
  const source = {
    page: async (start) => {
      pages.push(start);
      return {
        ds: Array.from(
          { length: Math.min(500, Math.max(0, 501 - start)) },
          (_, n) => grid(start + n + 1),
        ),
      };
    },
    financial: async () => {
      financialReads++;
      return Array.from({ length: 501 }, (_, n) => pub(n + 1));
    },
  };
  for (let i = 0; i < 10; i++) {
    const r = await advance(j, source);
    if ("publish" in r) {
      published = r.publish;
      break;
    }
    j = { ...j, ...r };
  }
  assert.equal(published.length, 501);
  assert.equal(financialReads, 2);
  assert.deepEqual(pages, [0, 500, 501, 0, 500, 501]);
  assert.equal(
    published.filter((r) => r.number === "SAME NUMBER").length,
    501,
    "Document numbers do not identify invoices",
  );
  let empty = {
    phase: "grid_first",
    cursor: 0,
    payload: { first: [], second: [], facts: [] },
    request: { timezone: "Europe/Moscow", businessIds: [1] },
  };
  for (let i = 0; i < 4; i++) {
    const r = await advance(empty, {
      page: async () => ({ ds: [] }),
      financial: async () => [],
    });
    if ("publish" in r) {
      assert.deepEqual(r.publish, []);
      break;
    }
    empty = { ...empty, ...r };
  }
  await assert.rejects(
    () =>
      advance(
        {
          phase: "grid_verify",
          cursor: 0,
          payload: { first: [h], second: [], facts },
          request: j.request,
        },
        { page: async () => ({ ds: [] }), financial: async () => [pub(1)] },
      ),
    /Состав/,
  );
  await assert.rejects(
    () =>
      advance(
        {
          phase: "financial_verify",
          cursor: 1,
          payload: { first: [h], second: [h], facts },
          request: j.request,
        },
        {
          page: async () => ({ ds: [] }),
          financial: async () => [
            { ...pub(1), paymentDate: "2026-10-03T21:30:00Z" },
          ],
        },
      ),
    /Оплата/,
  );
  await assert.rejects(
    () =>
      advance(
        {
          phase: "grid_first",
          cursor: 1,
          payload: { first: [h], second: [], facts: [] },
          request: j.request,
        },
        { page: async () => ({ ds: [grid(1)] }), financial: async () => [] },
      ),
    /повторил/,
  );
  console.log(
    "PASS: paginated/independent double invoice reads, truncation, changed payments, duplicate IDs vs shared numbers, money rounding, Moscow dates, unknown legacy fields and venue scope",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
