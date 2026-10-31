// Financial invariants and optional differential execution of the reviewed legacy calculation.
// No database, network calls, provider writes or account mutations.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import ts from "typescript";
const dir = await mkdtemp(join(tmpdir(), "sales-settlement-"));
try {
  for (const name of ["settlement", "time"]) {
    let source = ts.transpileModule(
      await readFile(`src/lib/sales/${name}.ts`, "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.ES2022,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText;
    source = source
      .replace(
        /from ["']zod["']/g,
        `from ${JSON.stringify(import.meta.resolve("zod"))}`,
      )
      .replace(/from ["']\.\/time["']/g, 'from "./time.mjs"');
    await writeFile(join(dir, name + ".mjs"), source);
  }
  const {
    normalizeSettlementReceipt: normalize,
    calculateSettlement: calculate,
    compareSettlement: compare,
    settlementSettingsSchema: schema,
  } = await import(pathToFileURL(join(dir, "settlement.mjs")));
  const venue = "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    cash = "11111111-1111-4111-8111-111111111111",
    sber = "22222222-2222-4222-8222-222222222222",
    tbank = "33333333-3333-4333-8333-333333333333",
    revenue = "44444444-4444-4444-8444-444444444444",
    personalIn = "55555555-5555-4555-8555-555555555555",
    personalOut = "66666666-6666-4666-8666-666666666666";
  const method = (
    paymentTypeId,
    bankAccountId,
    feePercent = 0,
    feeAccounting = "net",
  ) => ({
    paymentTypeId,
    bankAccountId,
    feePercent,
    feeAccounting,
    excluded: null,
  });
  const settings = {
    venueId: venue,
    timezone: "Europe/Moscow",
    dayStartHour: 9,
    revenueCategoryId: revenue,
    methods: [
      method(1, cash),
      method(25, cash),
      method(2, sber, 1.704),
      method(108, tbank, 1.22, "separate"),
      { ...method(9, null), excluded: "no_payment" },
      { ...method(99, null), excluded: "bonus" },
    ],
    personal: {
      payerId: 2,
      bankAccountId: cash,
      incomeCategoryId: personalIn,
      expenseCategoryId: personalOut,
    },
  };
  const date = "2026-10-30",
    createdAt = Date.parse(date + "T12:00:00+03:00");
  const raw = (
    n,
    kind,
    amount,
    {
      payer = 10,
      cost = 1.6,
      returned = false,
      detailReturned = false,
      returnId = 0,
      ...extra
    } = {},
  ) => ({
    order: {
      object: { id: n, createDate: createdAt, payer: { id: payer }, returned },
    },
    detail: {
      id: n,
      returned: detailReturned,
      returnId,
      orderItemList: [
        {
          costPrice: cost,
          amount: 1,
          totalPrice: amount,
          totalAbsoluteDiscount: 0,
          totalAbsoluteCharge: 0,
        },
      ],
    },
    payments: {
      orderId: n,
      complete: true,
      rows: [
        {
          object: {
            id: 1000 + n,
            amount,
            paymentType: {
              id: kind,
              title:
                kind === 99 ? "Бонусы" : kind === 9 ? "Без оплаты" : "Оплата",
            },
            ownerContextId: n,
          },
        },
      ],
    },
    ...extra,
  });
  const sources = [
    raw(1, 1, 100.01, { payer: 2 }),
    raw(2, 2, 1234.56),
    raw(3, 108, 1420.75),
    raw(4, 25, 0.5, { payer: 2 }),
    raw(5, 99, 50.14),
    raw(6, 9, 77.7),
    raw(7, 1, 999, { returned: true }),
    raw(8, 1, 700, { returnId: 92 }),
    raw(9, 1, 20, { payer: 3, cost: 9000 }),
  ];
  const make = (sources, settingsOverride = settings) =>
    calculate({
      date,
      complete: true,
      expectedOrderIds: sources.map((r) => r.order.object.id),
      receipts: sources.map(normalize),
      settings: settingsOverride,
    });
  const plan = make(sources);
  assert.equal(
    plan.personalCost,
    3,
    "Round aggregate personal cost once, not per receipt or item",
  );
  assert.deepEqual(
    plan.personalReceiptIds,
    [1, 4],
    "Receipt payer 2 is not warehouse operator 3",
  );
  assert.deepEqual(
    plan.returnedIds,
    [7, 8],
    "Return ID overrides a stale false returned flag",
  );
  assert.equal(
    plan.effects.find((e) => e.kind === "revenue" && e.bankAccountId === cash)
      .amount,
    121,
    "Round methods before combining the same bank",
  );
  assert.equal(
    plan.effects.find((e) => e.bankAccountId === sber).amount,
    1214,
    "Sber net settlement uses 1.704%",
  );
  assert.equal(
    plan.effects.find((e) => e.bankAccountId === tbank).amount,
    1421,
    "Separate bank commission is not subtracted twice",
  );
  assert.equal(
    plan.effects
      .filter((e) => e.kind !== "revenue")
      .reduce((s, e) => s + (e.type === "income" ? e.amount : -e.amount), 0),
    0,
    "Personal income/expense pair has zero net cash effect",
  );
  assert.deepEqual(plan.excludedPayments, [
    { reason: "bonus", amount: 50.14 },
    { reason: "no_payment", amount: 77.7 },
  ]);
  assert.deepEqual(
    make(sources.slice().reverse()),
    plan,
    "Response order never changes binding, effects or rounding",
  );
  const many = Array.from({ length: 173 }, (_, i) => raw(i + 1, 1, 1));
  assert.equal(
    make(many).effects[0].amount,
    173,
    "No silent first-page limit of 150 receipts",
  );
  assert.throws(
    () =>
      calculate({
        date,
        complete: false,
        expectedOrderIds: [1],
        receipts: [normalize(sources[0])],
        settings,
      }),
    /полная/,
  );
  assert.throws(
    () =>
      calculate({
        date,
        complete: true,
        expectedOrderIds: [1, 2],
        receipts: [normalize(sources[0])],
        settings,
      }),
    /Неполные/,
  );
  assert.throws(() => make([sources[0], sources[0]]), /повторяющиеся/);
  assert.throws(() => make([raw(1, 500, 1)]), /Не настроен/);
  assert.throws(
    () =>
      normalize({ ...sources[0], detail: { ...sources[0].detail, id: 999 } }),
    /другому/,
  );
  assert.throws(
    () =>
      normalize({
        ...sources[0],
        payments: { ...sources[0].payments, orderId: 999 },
      }),
    /платежи/,
  );
  assert.throws(
    () =>
      normalize({
        ...sources[0],
        payments: { ...sources[0].payments, complete: false },
      }),
    /платежи/,
  );
  assert.throws(
    () =>
      normalize({
        ...sources[0],
        detail: { ...sources[0].detail, returned: undefined },
      }),
    /возврата/,
  );
  assert.throws(
    () => make([raw(1, 1, 1, { payer: 2, cost: null })]),
    /себестоимости/,
  );
  assert.throws(
    () =>
      make([
        raw(1, 1, 1, {
          order: {
            object: {
              ...sources[0].order.object,
              createDate: Date.parse("2026-10-31T09:00:00+03:00"),
            },
          },
        }),
      ]),
    /пределами/,
  );
  assert.throws(
    () =>
      make([
        {
          ...sources[0],
          payments: {
            ...sources[0].payments,
            rows: [sources[0].payments.rows[0], sources[0].payments.rows[0]],
          },
        },
      ]),
    /повторяющиеся платежи/,
  );
  const virtualPayment = {
    ...sources[0],
    payments: {
      ...sources[0].payments,
      rows: [
        {
          object: {
            id: -79781,
            amount: 4200,
            paymentType: { id: 1 },
            ownerContextId: 1,
          },
        },
      ],
    },
  };
  assert.equal(make([virtualPayment]).methods[0].gross, 4200);
  const deleted = raw(10, 1, 999);
  deleted.order.object.deleted = true;
  assert.equal(
    make([deleted]).effects.length,
    0,
    "Deleted orders cannot become money",
  );
  assert.throws(() =>
    schema.parse({
      ...settings,
      methods: [...settings.methods, settings.methods[0]],
    }),
  );
  const txs = plan.effects.map((e, i) => ({
    id: "tx" + i,
    venueId: venue,
    sourceKey: e.key,
    date: e.date,
    bankAccountId: e.bankAccountId,
    categoryId: e.categoryId,
    type: e.type,
    amount: e.amount,
    description: e.description,
    deleted: false,
    planned: false,
  }));
  assert.equal(compare(plan, txs, true).ready, true);
  assert.throws(() => compare(plan, txs, false), /полный список/);
  assert.throws(() => compare(plan, [...txs, txs[0]], true), /без дублей/);
  assert.throws(
    () => compare(plan, [{ ...txs[0], venueId: cash }], true),
    /заведения/,
  );
  assert.equal(
    compare(
      plan,
      [{ ...txs[0], amount: txs[0].amount + 1 }, ...txs.slice(1)],
      true,
    ).matches[0].state,
    "changed",
  );
  assert.equal(
    compare(plan, [{ ...txs[0], deleted: true }, ...txs.slice(1)], true)
      .matches[0].state,
    "cancelled",
    "Intentional source-bound cancellation is terminal, never recreate",
  );
  assert.equal(
    compare(plan, [{ ...txs[0], planned: true }, ...txs.slice(1)], true)
      .matches[0].state,
    "review",
  );
  const marker = (e) =>
    e.kind === "revenue"
      ? "auto"
      : e.kind === "personal_income"
        ? "Антон Мостяев - Чек (auto)"
        : "Списание по чеку";
  const legacy = txs.map((t, i) => ({
    ...t,
    sourceKey: null,
    description: marker(plan.effects[i]),
  }));
  assert.equal(compare(plan, legacy, true).ready, true);
  const warehouse = legacy
    .filter((_, i) => plan.effects[i].kind !== "revenue")
    .map((t, i) => ({
      ...t,
      id: "warehouse" + i,
      description:
        t.type === "income"
          ? "Антон Мостяев - Списание (auto)"
          : "Списание товара (Товар)",
    }));
  assert.equal(
    compare(plan, [...legacy, ...warehouse], true).ready,
    true,
    "Warehouse pair cannot match or suppress daily receipt pair",
  );
  assert.equal(
    compare(
      plan,
      [{ ...legacy[0], description: "Ручная операция" }, ...legacy.slice(1)],
      true,
    ).matches[0].state,
    "review",
    "Same date/amount is insufficient without provenance",
  );
  assert.equal(
    compare(plan, [...legacy, { ...legacy[0], id: "duplicate" }], true)
      .matches[0].state,
    "review",
  );
  const empty = make([]);
  assert.equal(
    compare(empty, legacy, true).extraLegacy.length,
    legacy.length,
    "Removed/returned receipts expose old orphan effects, not a false all-clear",
  );
  assert.equal(compare(empty, txs, true).extraNative.length, txs.length);
  if (process.argv[2]) {
    const source = await readFile(process.argv[2], "utf8");
    // This exact reviewed node only calculates JSON; the context has no I/O or n8n execution methods.
    const nodes = {
      "Готовим смену": [
        {
          json: {
            bankMap: { 1: "46913", 2: "112657", 25: "46913", 108: "291212" },
            dateAdesk: date,
            dateSheet: "30.10.2026",
          },
        },
      ],
      "QR / Список чеков": [{ json: { ds: sources.map((r) => r.order) } }],
      "QR / Платежи": sources.map((r) => ({ json: { ds: r.payments.rows } })),
      "QR / Детали чека": sources.map((r) => ({ json: r.detail })),
      "QR / Все гости и группы": [{ json: { ds: [] } }],
      "Разбираем маркеры": [{ json: { seenKeys: [], transactions: [] } }],
      "Дата запуска": [{ json: { auditOnly: true } }],
    };
    const result = vm.runInNewContext(
      `(function(){${source}\n})()`,
      {
        $: (name) => {
          assert.ok(nodes[name], name);
          return {
            first: () => structuredClone(nodes[name][0]),
            all: () => structuredClone(nodes[name]),
          };
        },
        console: { log() {} },
      },
      { timeout: 1000 },
    )[0].json;
    const bankIds = { [cash]: "46913", [sber]: "112657", [tbank]: "291212" };
    assert.deepEqual(
      Object.fromEntries(
        plan.effects
          .filter((e) => e.kind === "revenue")
          .map((e) => [bankIds[e.bankAccountId], e.amount]),
      ),
      Object.fromEntries(
        result.perType.map((e) => [String(e.bank_account), e.amount]),
      ),
    );
    assert.equal(plan.personalCost, result.antonCost);
    assert.deepEqual(
      plan.returnedIds,
      Array.from(result.excludedReturnedCheckIds),
    );
  }
  console.log(
    "PASS: settlement rounding/fees, all 173 checks, return/deletion guards, complete payment binding, zero-net owner pair, no warehouse collision, provenance/delta/duplicate/cancellation reconciliation" +
      (process.argv[2] ? ", parity with reviewed live n8n calculation" : ""),
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
