// Cash-control boundary and source-parity tests. No network or application writes.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import ts from "typescript";
const dir = await mkdtemp(join(tmpdir(), "cash-control-"));
try {
  for (const name of ["cash-control", "time"]) {
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
      .replace('from "./time"', 'from "./time.mjs"');
    await writeFile(join(dir, name + ".mjs"), s);
  }
  const {
    normalizeCashControl: normalize,
    cashControlResults: decide,
    initialCashControlRules: rules,
    sameCashControl,
    cashControlRulesSchema: schema,
  } = await import(pathToFileURL(join(dir, "cash-control.mjs")));
  const date = "2026-10-30",
    tz = "Europe/Moscow",
    hour = 9;
  const raw = (id, patch = {}) => ({
    id,
    shiftNumber: id,
    opened: "2026-10-30T09:00:00Z",
    closed: "2026-10-31T04:00:00Z",
    status: "CLOSED",
    incomplete: false,
    kkmTerminal: { id: 1, title: "Касса" },
    salePlace: { title: "Заведение" },
    openedEmployee: { fullName: "Тестовый сотрудник" },
    openCashInRegister: 1000,
    enteredOpenCashInRegister: 1000,
    closeCashInRegister: 1200,
    enteredCloseCashInRegister: 1200,
    ...patch,
  });
  const source = [
    raw(1, { enteredOpenCashInRegister: 900 }),
    raw(2, { enteredCloseCashInRegister: 1250 }),
    raw(3, { status: "OPENED", closed: null, enteredCloseCashInRegister: 0 }),
  ];
  const reports = normalize(source, date, tz, hour),
    rows = decide(reports, rules);
  assert.equal(rows.length, 5);
  assert.equal(rows.find((x) => x.key === "1:open").diff, -10000);
  assert.equal(rows.find((x) => x.key === "1:open").state, "shortage");
  assert.equal(rows.find((x) => x.key === "2:close").diff, 5000);
  assert.equal(reports[2].closeDeclared, null);
  assert.equal(
    decide(reports, { ...rules, thresholdCents: 10000 }).find(
      (x) => x.key === "1:open",
    ).state,
    "tolerated",
  );
  assert.equal(decide(reports, { ...rules, opening: false }).length, 2);
  assert.equal(decide(reports, { ...rules, closing: false }).length, 3);
  const missing = normalize(
    [raw(1, { enteredOpenCashInRegister: null })],
    date,
    tz,
    hour,
  );
  assert.equal(decide(missing, rules)[0].state, "unknown");
  assert.equal(decide(missing, rules)[0].diff, null);
  const incomplete = normalize(
    [raw(1, { incomplete: true, enteredOpenCashInRegister: 0 })],
    date,
    tz,
    hour,
  );
  assert.ok(decide(incomplete, rules).every((x) => x.state === "unknown"));
  const decimal = normalize(
    [raw(1, { openCashInRegister: 0.3, enteredOpenCashInRegister: 0.1 + 0.2 })],
    date,
    tz,
    hour,
  );
  assert.equal(decide(decimal, rules)[0].diff, 0);
  assert.deepEqual(normalize([], date, tz, hour), []);
  const edge = normalize(
    [
      raw(1, { opened: "2026-10-30T05:59:59Z" }),
      raw(2, { opened: "2026-10-30T06:00:00Z" }),
      raw(3, { opened: "2026-10-31T05:59:59Z" }),
      raw(4, { opened: "2026-10-31T06:00:00Z" }),
    ],
    date,
    tz,
    hour,
  );
  assert.deepEqual(
    edge.map((r) => r.id),
    [2, 3],
  );
  const reordered = JSON.parse(
    JSON.stringify(reports, (key, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse())
        : value,
    ),
  );
  assert.equal(sameCashControl(reports, reordered), true);
  reordered[0].openExpected++;
  assert.equal(sameCashControl(reports, reordered), false);
  assert.throws(() => normalize({ ds: [] }, date, tz, hour), /полный список/);
  assert.throws(
    () => normalize([raw(1), raw(1)], date, tz, hour),
    /повторяются/,
  );
  assert.throws(
    () =>
      normalize([raw(1, { opened: "2026-10-30T09:00:00" })], date, tz, hour),
    /времени/,
  );
  assert.throws(
    () => normalize([raw(1, { openCashInRegister: "bad" })], date, tz, hour),
    /сумма/,
  );
  assert.throws(
    () => normalize([raw(1, { status: "unknown" })], date, tz, hour),
    /состояние/,
  );
  assert.equal(
    schema.safeParse({ ...rules, thresholdCents: -1 }).success,
    false,
  );
  assert.equal(
    schema.safeParse({ ...rules, intervalMinutes: 1 }).success,
    false,
  );
  let parity = false;
  if (process.argv[2]) {
    const code = await readFile(process.argv[2], "utf8");
    const old = vm.runInNewContext(
      `(function(){${code}\n})()`,
      {
        $input: { all: () => source.map((json) => ({ json })) },
        $getWorkflowStaticData: () => ({}),
        console: { log: () => {} },
        Date,
      },
      { timeout: 1000 },
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(old)).map((x) => ({
        id: x.json.id,
        kind: x.json.kind,
        diff: Math.round(x.json.diff * 100),
      })),
      rows
        .filter((x) => x.state === "shortage" || x.state === "overage")
        .map((x) => ({ id: x.reportId, kind: x.kind, diff: x.diff })),
    );
    parity = true;
  }
  console.log(
    "PASS: cash-control exact cents, thresholds, open/closed reports, unknown/incomplete data, business-day boundaries, duplicate/source-change guards" +
      (parity ? ", parity with published n8n code" : ""),
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
