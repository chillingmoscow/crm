// Paging, complete source verification, source changes and unknown costs.
// Synthetic data only; no network or financial side effects.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
const dir = await mkdtemp(join(tmpdir(), "settlement-reader-"));
try {
  for (const name of ["settlement", "settlement-reader", "time"]) {
    let s = ts.transpileModule(
      await readFile(`src/lib/sales/${name}.ts`, "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.ES2022,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText;
    s = s
      .replace(
        /from ["']zod["']/g,
        `from ${JSON.stringify(import.meta.resolve("zod"))}`,
      )
      .replace(/from ["']\.\/(settlement|time)["']/g, 'from "./$1.mjs"');
    await writeFile(join(dir, name + ".mjs"), s);
  }
  const { advanceSettlementReader: advance, SettlementSourceChanged } =
    await import(pathToFileURL(join(dir, "settlement-reader.mjs")));
  const start = Date.parse("2026-10-30T09:00:00+03:00");
  const header = (id) => ({
    id,
    createDate: start + id * 1000,
    payer: id === 2 ? { id: 2 } : null,
    returned: false,
  });
  const detail = (id) => ({
    id,
    returned: false,
    returnId: 0,
    orderItemList: [{ costPrice: 12.3, amount: 2 }],
  });
  const payment = (id) => ({
    id: id * 100,
    ownerContextId: id,
    amount: 100.01,
    paymentType: { id: 1, title: "Наличные" },
  });
  const initial = () => ({
    business_date: "2026-10-30",
    phase: "orders",
    cursor: 0,
    request: { timezone: "Europe/Moscow", dayStartHour: 9 },
    payload: { orders: [], facts: [], methods: [] },
  });
  const run = async (source, onStep = () => {}) => {
    let j = initial();
    for (let i = 0; i < 5000; i++) {
      onStep(j);
      const r = await advance(j, source);
      if (r.publish) return r.publish;
      // PostgreSQL jsonb does not preserve JavaScript key insertion order.
      j = JSON.parse(
        JSON.stringify({ ...j, ...r }, (key, value) =>
          value && typeof value === "object" && !Array.isArray(value)
            ? Object.fromEntries(
                Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
              )
            : value,
        ),
      );
    }
    throw new Error("Reader did not finish");
  };
  // 173 checks: the endpoint may return short non-final pages. Only an empty
  // page proves exhaustion. Every order/detail/payment is checked twice.
  const ids = Array.from({ length: 173 }, (_, i) => i + 1),
    reads = { orders: [], detail: [], payments: [] };
  const source = {
    orders: async (offset) => {
      reads.orders.push(offset);
      return {
        ds: ids
          .slice(offset, offset + 37)
          .map((id) => ({ object: header(id) })),
      };
    },
    detail: async (id) => {
      reads.detail.push(id);
      return detail(id);
    },
    payments: async (id, offset) => {
      reads.payments.push([id, offset]);
      return { ds: offset === 0 ? [{ object: payment(id) }] : [] };
    },
  };
  const result = await run(source);
  assert.equal(result.facts.length, 173);
  assert.equal(result.summary.double_checked, true);
  assert.deepEqual(
    reads.orders,
    [0, 37, 74, 111, 148, 173, 0, 37, 74, 111, 148, 173],
  );
  assert.equal(reads.detail.length, 346);
  assert.equal(reads.payments.length, 692);
  assert.equal(result.facts[1].cost, 24.6);
  assert.equal(result.facts[0].payments[0].amountCents, 10001);
  const one = {
    orders: async (n) => ({ ds: n ? [] : [header(2)] }),
    detail: async (id) => detail(id),
    payments: async (id, n) => ({ ds: n ? [] : [payment(id)] }),
  };
  // Re-reading a changed list or amount must not publish a partial replacement.
  let orderPass = 0;
  await assert.rejects(
    () =>
      run({
        ...one,
        orders: async (n) => {
          if (n === 0) orderPass++;
          return { ds: n ? [] : [header(orderPass === 1 ? 2 : 3)] };
        },
      }),
    SettlementSourceChanged,
  );
  let detailPass = 0;
  await assert.rejects(
    () =>
      run({
        ...one,
        detail: async (id) => ({
          ...detail(id),
          returnId: ++detailPass === 1 ? 0 : 9,
        }),
      }),
    SettlementSourceChanged,
  );
  let paymentPass = 0;
  await assert.rejects(
    () =>
      run({
        ...one,
        payments: async (id, n) => ({
          ds: n
            ? []
            : [{ ...payment(id), amount: ++paymentPass === 1 ? 100 : 101 }],
        }),
      }),
    SettlementSourceChanged,
  );
  const anonymous = await run({
    ...one,
    orders: async (n) => ({
      ds: n
        ? []
        : [header(2), { id: 3, createDate: start + 3000, returned: false }],
    }),
  });
  assert.equal(anonymous.facts[1].payerId, null);
  const signed = await run({
    ...one,
    payments: async (id, n) => ({
      ds: n ? [] : [{ ...payment(id), id: -79781 }],
    }),
  });
  assert.equal(signed.facts[0].payments[0].id, -79781);
  const noCost = await run({
    ...one,
    detail: async (id) => ({ id, returned: false }),
  });
  assert.equal(noCost.facts[0].cost, null);
  let paymentReads = 0;
  const returned = await run({
    ...one,
    detail: async (id) => ({ ...detail(id), returnId: 8 }),
    payments: async () => {
      paymentReads++;
      throw new Error("Unexpected payments read");
    },
  });
  assert.equal(returned.facts[0].excluded, "returned");
  assert.equal(paymentReads, 0);
  const empty = await run({ ...one, orders: async () => ({ ds: [] }) });
  assert.deepEqual(empty.facts, []);
  await assert.rejects(
    () => run({ ...one, orders: async () => ({ data: [] }) }),
    /не подтвердил список/,
  );
  await assert.rejects(
    () => run({ ...one, orders: async () => ({ ds: [header(2), header(2)] }) }),
    /повторяющийся/,
  );
  await assert.rejects(
    () => run({ ...one, detail: async () => detail(3) }),
    /детали чека/,
  );
  await assert.rejects(
    () =>
      run({
        ...one,
        payments: async () => ({ ds: [{ ...payment(2), ownerContextId: 3 }] }),
      }),
    /другому чеку/,
  );
  await assert.rejects(
    () =>
      run({
        ...one,
        orders: async () => ({ ds: [{ ...header(2), createDate: start - 1 }] }),
      }),
    /пределами/,
  );
  await assert.rejects(
    () =>
      run({
        ...one,
        orders: async () => ({
          ds: [{ id: 2, returned: false, createDate: start }],
        }),
      }),
    /плательщик/,
  );
  console.log(
    "PASS: complete paging, double read, changed-source rejection, order/payment binding, unknown cost, exclusions, empty days",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
