import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
const dir = await mkdtemp(join(tmpdir(), "stock-writeoffs-"));
try {
  for (const file of ["writeoffs", "writeoff-view"]) {
    const source = await readFile(`src/lib/stock/${file}.ts`, "utf8");
    await writeFile(
      join(dir, file + ".mjs"),
      ts
        .transpileModule(source, {
          compilerOptions: {
            module: ts.ModuleKind.ES2022,
            target: ts.ScriptTarget.ES2022,
          },
        })
        .outputText.replace('"./writeoffs"', '"./writeoffs.mjs"')
        .replace("'./writeoffs'", "'./writeoffs.mjs'"),
    );
  }
  const {
    normalizeWriteoff: parse,
    validateWriteoffRules: validate,
    discardListIds: list,
    personalConsumptionPlan: plan,
    stockCalendarDate: date,
  } = await import(pathToFileURL(join(dir, "writeoffs.mjs")));
  const { writeoffTotal, writeoffRows, filterWriteoffs } = await import(
    pathToFileURL(join(dir, "writeoff-view.mjs"))
  );
  const rules = {
    storeIds: [1, 2],
    timezone: "Europe/Moscow",
    personalOperatorIds: [3],
    teamReasons: ["Бой посуды"],
    masterReasons: ["Кальянные мастера"],
    personalFinance: {
      legacyBankId: 1,
      incomeCategoryId: 2,
      expenseCategoryId: 3,
    },
  };
  const raw = {
    id: 12,
    documentNumber: "QA12",
    invoiceDate: "2026-10-11T13:00:00Z",
    processed: true,
    store: { id: 1, title: "Склад", bankDetails: "private" },
    customerType: "EMPLOYEE",
    operator: {
      id: 3,
      firstName: "QA",
      lastName: "Operator",
      dateOfBirth: "private",
      user: { password: "private" },
    },
    totalSum: 172.45015,
    invoiceItems: [
      {
        id: 1,
        product: {
          id: 9,
          name: "Item",
          parentItem: { id: 10, name: "Category" },
        },
        measureUnit: { name: "кг" },
        actualAmount: 0.266,
        fixedTotalSum: 110.124,
      },
      {
        id: 2,
        product: { id: 11, name: "Item 2" },
        actualAmount: 0.317,
        fixedTotalSum: 61.181,
      },
    ],
  };
  const d = parse(raw, rules),
    p = plan(d, rules.personalFinance);
  assert.equal(
    d.total,
    172.45015,
    "Provider invoice total is distinct from fixed line amounts",
  );
  assert.equal(p.amount, 171);
  assert.equal(p.operations.length, 4, "Preserve two effects per source item");
  assert.equal(new Set(p.operations.map((x) => x.key)).size, 4);
  assert.equal(
    p.operations.reduce(
      (s, x) => s + (x.type === "income" ? x.amount : -x.amount),
      0,
    ),
    0,
    "Personal consumption must not alter cash",
  );
  assert.equal(
    JSON.stringify(d).includes("private"),
    false,
    "Never persist nested provider user/bank/DOB data",
  );
  assert.equal(
    plan({ ...d, processed: false }, rules.personalFinance).eligible,
    false,
  );
  assert.equal(
    plan(d).eligible,
    false,
    "Missing finance mapping cannot make an executable plan",
  );
  assert.equal(
    plan({ ...d, issues: ["Нужна сверка"] }, rules.personalFinance).operations
      .length,
    0,
  );
  const team = parse(
    {
      ...raw,
      customerType: "SPECIAL",
      discardReason: { description: " бой ПОСУДЫ " },
    },
    rules,
  );
  assert.equal(team.kind, "team");
  assert.equal(
    team.legacyTotal,
    173,
    "Team legacy rule rounds each line UP, personal rounds to nearest",
  );
  const business = parse(
    {
      ...raw,
      customerType: "SPECIAL",
      discardReason: { description: "Прочее" },
    },
    rules,
  );
  assert.equal(business.kind, "business");
  assert.equal(business.legacyTotal, null);
  assert.equal(parse({ ...raw, operator: undefined }, rules).kind, "unknown");
  assert.equal(
    parse({ ...raw, store: { id: 2, title: "Другой" } }, rules).storeId,
    2,
  );
  assert.throws(() => parse({ ...raw, store: { id: 4 } }, rules));
  assert.deepEqual(
    list(
      [
        { id: 4, invoiceDate: raw.invoiceDate, store: { id: 4 } },
        { id: 1, invoiceDate: raw.invoiceDate, store: { id: 2 } },
      ],
      rules,
      "2026-10",
    ),
    [1],
  );
  assert.throws(() =>
    list(
      [
        { id: 1, invoiceDate: raw.invoiceDate, store: { id: 1 } },
        { id: 1, invoiceDate: raw.invoiceDate, store: { id: 2 } },
      ],
      rules,
      "2026-10",
    ),
  );
  assert.throws(
    () =>
      list(
        Array.from({ length: 5000 }, (_, i) => ({ id: i + 1 })),
        rules,
        "2026-10",
      ),
    "Provider truncation boundary fails closed",
  );
  assert.throws(() =>
    parse(
      { ...raw, invoiceItems: [raw.invoiceItems[0], raw.invoiceItems[0]] },
      rules,
    ),
  );
  const incomplete = parse(
    {
      ...raw,
      invoiceItems: [{ ...raw.invoiceItems[0], fixedTotalSum: undefined }],
    },
    rules,
  );
  assert.equal(incomplete.lines[0].amount, null);
  assert.equal(plan(incomplete, rules.personalFinance).eligible, false);
  const zero = parse(
    {
      ...raw,
      invoiceItems: [
        { ...raw.invoiceItems[0], fixedTotalSum: 0, actualAmount: 0 },
      ],
      totalSum: 0,
    },
    rules,
  );
  assert.equal(plan(zero, rules.personalFinance).amount, 0);
  assert.throws(() =>
    validate({ ...rules, personalFinance: { legacyBankId: 1 } }),
  );
  assert.throws(() => validate({ ...rules, storeIds: [1, 1] }));
  assert.throws(() => validate({ ...rules, timezone: undefined }));
  assert.throws(() => validate({ ...rules, masterReasons: ["БОЙ ПОСУДЫ"] }));
  assert.equal(date("2026-10-10T22:30:00Z", rules.timezone), "2026-10-11");
  assert.throws(() => date("2026-02-30T10:00:00Z", rules.timezone));
  assert.throws(() => date("2026-10-10T10:00:00", rules.timezone));
  const cycle = { id: 10, name: "Cycle" };
  cycle.parentItem = cycle;
  assert.throws(() =>
    parse(
      {
        ...raw,
        invoiceItems: [
          { ...raw.invoiceItems[0], product: { parentItem: cycle } },
        ],
      },
      rules,
    ),
  );
  const searchable = writeoffRows(
    [{ id: "QA", business_date: d.date, payload: d }],
    [],
    "native",
  );
  assert.equal(
    filterWriteoffs(searchable, "2026-10", "all", "Item 2").length,
    1,
    "Product search includes line items, shared with export",
  );
  assert.equal(
    filterWriteoffs(searchable, "2026-10", "all", "Category").length,
    1,
  );
  assert.equal(
    filterWriteoffs(searchable, "2026-09", "all", "Item 2").length,
    0,
  );
  assert.equal(
    filterWriteoffs(searchable, "2026-10", "Вся команда", "Item 2").length,
    0,
  );
  const summary = writeoffTotal([
    { total: 100, native: { payload: { processed: true } } },
    { total: 500, native: { payload: { processed: false } } },
    { total: 200, native: { payload: { processed: true }, missing_at: "x" } },
    { total: null, archive: { deleted: false } },
  ]);
  assert.deepEqual(
    summary,
    { value: 100, known: 1, total: 2 },
    "Draft/deleted acts excluded; unknown amount remains incomplete, not zero",
  );
  console.log(
    "PASS: stable doc/item keys, both stores/scope, exact legacy rounding, cash net zero, unknown vs zero, no PII, unsafe dates/categories/config, full-list limit, draft/deleted exclusion",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
