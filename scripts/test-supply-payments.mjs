import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
const dir = await mkdtemp(join(tmpdir(), "supply-payment-test-"));
try {
  const code = ts
    .transpileModule(await readFile("src/lib/supplies/payments.ts", "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
      },
    })
    .outputText.replace(
      /from ["']zod["']/g,
      `from ${JSON.stringify(import.meta.resolve("zod"))}`,
    );
  await writeFile(join(dir, "payments.mjs"), code);
  const { mentionsInvoice: mentions, compareSupplyExpenses: compare } =
    await import(pathToFileURL(join(dir, "payments.mjs")));
  assert(mentions("Счёт № SF-5885 от 26 октября", "sf-5885"));
  assert(!mentions("Счёт № SF-58850 от 26 октября", "SF-5885"));
  assert(!mentions("НДС 13%, от 13 октября 2026", "13"));
  assert(mentions("Счёт №13 от 1 октября", "13"));
  assert(!mentions("Счёт №130", "13"));
  assert(mentions("719", "719"));
  assert(mentions("Счёт №719 от 26.10.2026", "719"));
  assert(!mentions("Оплата №ABX1", "AB.1"));
  assert(mentions("Оплата №AB.1", "AB.1"));
  assert(!mentions("Оплата №AB1", "AB'1"));
  assert(!mentions("Накладная №12", "Накладная №12"));
  const invoice = (id, number, amountCents, paid = true) => ({
    id,
    number,
    invoiceDate: "2026-10-26",
    amountCents,
    providerId: 1,
    providerName: "Поставщик",
    paid,
    processed: true,
  });
  const expense = (id, description, amountCents) => ({
    id,
    date: "2026-10-30",
    amountCents,
    currency: "RUB",
    actual: true,
    categoryId: 5,
    projectId: 7,
    description,
    bankId: 8,
    bankName: "Банк",
    counterpartyId: 9,
    counterpartyName: "Поставщик",
    sourceRow: `Sheet1!A${id}:O${id}`,
  });
  const input = (invoices, expenses) => ({
    invoiceSource: {
      complete: true,
      count: invoices.length,
      checkedAt: "2026-11-01T00:00:00Z",
    },
    source: {
      complete: true,
      count: expenses.length,
      amountCents: expenses.reduce((s, x) => s + x.amountCents, 0),
      checkedAt: "2026-11-01T00:00:00Z",
      from: "2026-10-01",
      to: "2026-10-31",
      categoryId: 5,
      projectId: 7,
    },
    invoices,
    expenses,
  });
  let report = compare(
    input(
      [invoice(1, "SF-5885", 2390000, false), invoice(2, "H791", 205849)],
      [expense(11, "Счёт № SF-5885", 2390000), expense(12, "H791", 205848)],
    ),
  );
  assert.equal(report.counts.uniqueNumberAndAmount, 1);
  assert.equal(report.counts.differentAmount, 1);
  assert.equal(
    report.proposals.find((p) => p.invoiceId === 2).differenceCents,
    -1,
  );
  assert.deepEqual(report.sourceUnpaidWithExactExpense, [
    { invoiceId: 1, expenseId: 11 },
  ]);
  assert.equal(report.confirmedLinks, 0);
  report = compare(
    input(
      [invoice(1, "719", 10000), invoice(2, "719", 20000)],
      [expense(11, "Счёт №719", 10000)],
    ),
  );
  assert(report.proposals.every((p) => p.ambiguous));
  assert.equal(report.counts.uniqueNumberAndAmount, 0);
  report = compare(
    input(
      [invoice(1, "A111", 10000)],
      [expense(11, "A111", 10000), expense(12, "A111", 10000)],
    ),
  );
  assert(report.proposals.every((p) => p.ambiguous));
  report = compare(
    input([invoice(1, "A111", 10000)], [expense(11, "Другая покупка", 10000)]),
  );
  assert.equal(report.proposals[0].evidence, "name_and_amount");
  assert.equal(report.counts.uniqueNumberAndAmount, 0);
  assert.deepEqual(report.expensesWithoutReference, [11]);
  report = compare(
    input(
      [invoice(1, "A111", 10000)],
      [{ ...expense(11, "A111", 10000), projectId: null }],
    ),
  );
  assert.equal(report.proposals[0].scope, "unassigned");
  assert.equal(report.counts.uniqueNumberAndAmount, 0);
  assert.throws(() =>
    compare(
      input(
        [invoice(1, "A111", 10000)],
        [{ ...expense(11, "A111", 10000), projectId: 999 }],
      ),
    ),
  );
  assert.throws(() =>
    compare(
      input(
        [invoice(1, "A111", 10000)],
        [{ ...expense(11, "A111", 10000), actual: false }],
      ),
    ),
  );
  assert.throws(() =>
    compare({
      ...input([], []),
      source: { ...input([], []).source, complete: false },
    }),
  );
  assert.throws(() =>
    compare({
      ...input([], []),
      invoiceSource: {
        complete: true,
        count: 1,
        checkedAt: "2026-11-01T00:00:00Z",
      },
    }),
  );
  assert.throws(() =>
    compare({
      ...input([], []),
      source: { ...input([], []).source, amountCents: 1 },
    }),
  );
  assert.throws(() =>
    compare(input([invoice(1, "A111", 10000), invoice(1, "A111", 10000)], [])),
  );
  assert.throws(() =>
    compare(
      input([], [expense(11, "A111", 10000), expense(11, "A111", 10000)]),
    ),
  );
  assert.throws(() =>
    compare(input([], [{ ...expense(11, "A111", 10000), date: "2026-11-01" }])),
  );
  console.log(
    "PASS: references vs dates/amounts, regex literals, duplicate invoices/payments, exact cents, unpaid-source conflicts, foreign/unassigned scope, completeness and proposal-only semantics",
  );
} finally {
  await rm(dir, { force: true, recursive: true });
}
