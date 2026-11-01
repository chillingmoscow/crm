// Financial-chain invariants. No network or application writes.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import vm from "node:vm";
const dir = await mkdtemp(join(tmpdir(), "cash-movements-"));
try {
  for (const name of ["cash-movements", "time"]) {
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
    normalizeCashMovements: normalize,
    planCashMovements: plan,
    compareCashMovements: compare,
    cashMovementRulesSchema: schema,
    cashMovementDefaults: defaults,
    sameCashMovements: same,
  } = await import(pathToFileURL(join(dir, "cash-movements.mjs")));
  const scope = {
    from: "2026-10-01",
    through: "2026-10-30",
    timezone: "Europe/Moscow",
  };
  const raw = (id, comment, amount = 10, patch = {}) => ({
    id,
    comment,
    amount,
    typeTransaction: "cashOut",
    serverRegisterTime: "2026-10-31T09:00:00Z",
    timeEncashment: "2026-10-31T01:00:00Z",
    shift: {
      id: 1,
      opened: "2026-10-30T09:00:00Z",
      localOpenedTime: "2026-10-30T12:00:00Z",
    },
    ...patch,
  });
  const source = [
    raw(1, "Инкассация"),
    raw(2, "Чаевые", 25),
    raw(3, "Такси", 30),
    raw(4, "Такси Натали", 40),
    raw(5, "Внесение", 50, { typeTransaction: "cashIn" }),
    raw(6, "Не сделали инкассацию"),
    raw(7, "Такси и чаевые"),
  ];
  const rows = normalize(source, scope),
    rules = {
      ...defaults,
      cashAccountId: "cash",
      safeAccountId: "safe",
      operatingAccountId: "operating",
      incomeCategoryId: "income",
      taxiCategoryId: "taxi",
      tipsCategoryId: "tips",
    };
  assert.equal(rows[0].date, "2026-10-30");
  assert.equal(rows[0].arrivedAt, "2026-10-31T09:00:00.000Z");
  assert.throws(() => normalize([...source, source[0]], scope), /повторная/);
  assert.throws(() => normalize([raw(1, "", null)], scope), /сумма/);
  assert.throws(() => normalize([raw(1, "", [10])], scope), /сумма/);
  assert.throws(() => normalize([raw(1, "", 10, { id: [1] })], scope), /номер/);
  assert.throws(
    () => normalize([raw(1, "", 10, { typeTransaction: ["cashOut"] })], scope),
    /неизвестная/,
  );
  assert.throws(() => normalize([raw(1, "", 1.001)], scope), /сумма/);
  assert.throws(
    () => normalize([raw(1, "", 10, { deleted: true })], scope),
    /Удалённая/,
  );
  assert.throws(
    () =>
      normalize(
        [
          raw(1, "", 10, {
            shift: {
              id: 1,
              opened: "2026-10-30T09:00:00Z",
              localOpenedTime: "2026-10-29T12:00:00Z",
            },
          }),
        ],
        scope,
      ),
    /совпадают/,
  );
  assert.equal(
    normalize(
      [
        raw(1, "", 10, {
          shift: {
            id: 1,
            opened: "2026-10-29T22:30:00Z",
            localOpenedTime: "2026-10-30T01:30:00Z",
          },
        }),
      ],
      scope,
    )[0].date,
    "2026-10-30",
  );
  assert.equal(same(rows, JSON.parse(JSON.stringify(rows))), true);
  assert.equal(
    same(
      rows,
      rows.map((r) => (r.id === 1 ? { ...r, amountCents: 1 } : r)),
    ),
    false,
  );
  assert.equal(
    schema.safeParse({ ...rules, safeAccountId: "cash" }).success,
    false,
  );
  assert.equal(
    schema.safeParse({ ...rules, safePattern: "(а+)+$" }).success,
    false,
  );
  assert.equal(
    schema.safeParse({ ...rules, safePattern: "инк.*.*ация" }).success,
    false,
  );
  assert.equal(schema.safeParse({ ...rules, safePattern: "[" }).success, false);
  assert.equal(schema.safeParse({ ...rules, lookbackDays: 91 }).success, false);
  const result = plan("venue", rows, rules);
  assert.equal(result.review.length, 2);
  assert.equal(result.plans.length, 7);
  assert.equal(result.plans.find((p) => p.label === "Такси").amountCents, 7000);
  assert.equal(
    result.plans.find((p) => p.sourceIds[0] === 1).toBankAccountId,
    "safe",
  );
  assert.equal(
    result.plans.find((p) => p.label === "Выдача чаевых").bankAccountId,
    "operating",
  );
  const tx = result.plans.map((p, i) => ({
    id: "tx" + i,
    venueId: "venue",
    sourceKey: p.key,
    date: p.date,
    type: p.type,
    bankAccountId: p.bankAccountId,
    toBankAccountId: p.toBankAccountId,
    categoryId: p.categoryId,
    amountCents: p.amountCents,
    description: p.sourceIds.map((id) => "#" + id).join(" "),
    deleted: false,
    planned: false,
  }));
  const run = (transactions) =>
    compare({
      venueId: "venue",
      plans: result.plans,
      source: rows,
      transactions,
      complete: true,
    });
  assert.ok(run(tx).every((r) => r.state === "matched"));
  const tipExpense = tx.find((t) => t.categoryId === "tips");
  const linkedTips = tx.map((t) =>
    t === tipExpense
      ? {
          ...t,
          sourceKey: "quickresto:encashment:venue:2",
          sourceIds: [2],
          description: "Чаевые сотрудникам",
        }
      : t,
  );
  assert.ok(
    run(linkedTips).every((r) => r.state === "matched"),
    "Existing payroll tip expense must be recognized without a # marker",
  );
  assert.equal(
    run(
      linkedTips.map((t) =>
        t === linkedTips.find((x) => x.sourceIds) ? { ...t, deleted: true } : t,
      ),
    ).find((r) => r.plan.categoryId === "tips").state,
    "conflict",
    "Cancelled linked expense must not become a new missing expense",
  );
  assert.equal(run([]).filter((r) => r.state === "missing").length, 7);
  assert.equal(
    run([{ ...tx[0], sourceKey: null, description: "Перевод без номера" }])[0]
      .state,
    "conflict",
    "Unmarked equal operation must require review instead of being offered twice",
  );
  assert.throws(
    () =>
      compare({
        venueId: "venue",
        plans: result.plans,
        source: rows,
        transactions: tx,
        complete: false,
      }),
    /полный/,
  );
  assert.throws(() => run([...tx, tx[0]]), /полный/);
  for (const patch of [
    { date: "2026-10-29" },
    { deleted: true },
    { planned: true },
    { venueId: "foreign" },
    { amountCents: 1 },
    { toBankAccountId: "wrong" },
  ])
    assert.equal(
      run(tx.map((t, i) => (i === 0 ? { ...t, ...patch } : t)))[0].state,
      "conflict",
    );
  assert.equal(
    run([...tx, { ...tx[0], id: "duplicate", sourceKey: null }])[0].state,
    "conflict",
  );
  const taxi = tx.find((t) => t.categoryId === "taxi");
  const parts = [
    {
      ...taxi,
      id: "taxi-a",
      sourceKey: null,
      description: "#3",
      amountCents: 3000,
    },
    {
      ...taxi,
      id: "taxi-b",
      sourceKey: null,
      description: "#4",
      amountCents: 4000,
    },
  ];
  assert.equal(
    run([...tx.filter((t) => t !== taxi), ...parts]).find(
      (r) => r.plan.categoryId === "taxi",
    ).state,
    "matched",
  );
  assert.equal(
    run([
      ...tx.filter((t) => t !== taxi),
      { ...taxi, sourceKey: null, description: "#3 #3", amountCents: 6000 },
    ]).find((r) => r.plan.categoryId === "taxi").state,
    "conflict",
  );
  assert.equal(
    run([
      ...tx.filter((t) => t !== taxi),
      { ...taxi, sourceKey: null, description: "#3 #99" },
    ]).find((r) => r.plan.categoryId === "taxi").state,
    "conflict",
  );
  const override = {
    sourceId: 1,
    date: "2026-10-30",
    amountCents: 1000,
    comment: "Инкассация",
    route: "hold",
    reason: "Оставить без изменений",
  };
  assert.equal(
    plan("venue", rows, { ...rules, overrides: [override] }).review.length,
    3,
  );
  assert.ok(
    plan(
      "venue",
      rows.map((r) => (r.id === 1 ? { ...r, amountCents: 1001 } : r)),
      { ...rules, overrides: [{ ...override, route: "operating" }] },
    ).review.some((r) => r.sourceId === 1 && r.message.includes("изменилась")),
  );
  assert.equal(
    schema.safeParse({ ...rules, overrides: [override, override] }).success,
    false,
  );
  if (process.env.CASH_MOVEMENT_REAL_FIXTURE) {
    const real = normalize(
      JSON.parse(
        await readFile(process.env.CASH_MOVEMENT_REAL_FIXTURE, "utf8"),
      ),
      { ...scope, from: "2026-09-30" },
    );
    assert.ok(real.length > 0);
    assert.equal(new Set(real.map((r) => r.id)).size, real.length);
    await writeFile(
      "/private/tmp/encashments-normalized-20261031.json",
      JSON.stringify(real),
      { mode: 0o600 },
    );
    console.log(
      `Real source validated: ${real.length} operations, ${new Set(real.map((r) => r.date)).size} cash-shift dates`,
    );
    if (
      process.env.CASH_MOVEMENT_LEGACY_CODE &&
      process.env.CASH_MOVEMENT_ADESK_SNAPSHOT
    ) {
      const input = JSON.parse(
        await readFile(process.env.CASH_MOVEMENT_REAL_FIXTURE, "utf8"),
      );
      const snapshot = JSON.parse(
        await readFile(process.env.CASH_MOVEMENT_ADESK_SNAPSHOT, "utf8"),
      );
      const dt = (value, zone = "UTC") => {
        const instant = new Date(value);
        return {
          isValid: Number.isFinite(instant.getTime()),
          setZone: (z) => dt(instant, z),
          toISODate: () =>
            Number.isFinite(instant.getTime())
              ? new Intl.DateTimeFormat("en-CA", {
                  timeZone: zone,
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                }).format(instant)
              : null,
          toFormat: () => {
            const s = dt(instant, zone).toISODate();
            return s
              ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`
              : "";
          },
        };
      };
      const cfg = {
        targetDate: "2026-10-30",
        sourceStartDate: "2026-09-30",
        auditOnly: true,
      };
      const code = await readFile(
        process.env.CASH_MOVEMENT_LEGACY_CODE,
        "utf8",
      );
      const oracle = new vm.Script(`(function(){${code}\n})()`).runInNewContext(
        {
          DateTime: { fromISO: dt },
          $input: {
            first: () => ({ json: { statusCode: 200, body: input } }),
            all: () => [{ json: { statusCode: 200, body: input } }],
          },
          $: (name) => ({
            first: () => ({
              json:
                name === "Задаём даты"
                  ? cfg
                  : {
                      snapshotComplete: true,
                      transactions: snapshot.transactions,
                    },
            }),
          }),
        },
        { timeout: 3000 },
      )[0].json;
      const all = normalize(input, { ...scope, from: "2000-01-01" });
      const oldRules = {
        ...rules,
        cashAccountId: "46913",
        safeAccountId: "46914",
        operatingAccountId: "85576",
        incomeCategoryId: "274953",
        taxiCategoryId: "274928",
        tipsCategoryId: "1818613",
        overrides: all
          .filter((r) => r.id === 5002)
          .map((r) => ({
            sourceId: r.id,
            date: r.date,
            amountCents: r.amountCents,
            comment: r.comment,
            route: "safe",
            reason: "Проверенный прежний ручной перевод",
          })),
      };
      const native = plan("venue", all, oldRules),
        ids = new Set(all.map((r) => r.id));
      const mark = (s) =>
        [...String(s ?? "").matchAll(/#(\d+)(?!\d)/g)].map((m) => Number(m[1]));
      const marked = snapshot.transactions.filter((t) =>
          mark(t.description).some((i) => ids.has(i)),
        ),
        normalized = [],
        groups = new Map();
      for (const t of marked) {
        if (t.isTransfer) {
          const key = String(t.transferId ?? "missing-" + t.id);
          groups.set(key, [...(groups.get(key) ?? []), t]);
        } else
          normalized.push({
            id: "adesk:" + t.id,
            venueId: Number(t.projectId) === 268648 ? "venue" : "foreign",
            sourceKey: null,
            date: t.dateIso,
            type: Number(t.type) === 1 ? "income" : "expense",
            bankAccountId: String(t.bankAccountId),
            toBankAccountId: null,
            categoryId: String(t.categoryId),
            amountCents: Math.round(Number(t.amount) * 100),
            description: t.description ?? "",
            deleted: false,
            planned: t.isPlanned === true,
          });
      }
      for (const [key, legs] of groups) {
        const out = legs.find((t) => Number(t.type) === 2),
          inc = legs.find((t) => Number(t.type) === 1),
          valid =
            legs.length === 2 &&
            out &&
            inc &&
            Number(out.pairedTransactionId) === Number(inc.id) &&
            Number(inc.pairedTransactionId) === Number(out.id) &&
            Number(out.amount) === Number(inc.amount) &&
            out.dateIso === inc.dateIso;
        normalized.push({
          id: "adesk-transfer:" + key,
          venueId: "venue",
          sourceKey: null,
          date: out?.dateIso ?? inc?.dateIso,
          type: "transfer",
          bankAccountId: String(out?.bankAccountId),
          toBankAccountId: inc ? String(inc.bankAccountId) : null,
          categoryId: null,
          amountCents: valid ? Math.round(Number(out.amount) * 100) : -1,
          description: out?.description ?? inc?.description ?? "",
          deleted: false,
          planned: legs.some((t) => t.isPlanned === true),
        });
      }
      const compared = compare({
        venueId: "venue",
        plans: native.plans,
        source: all,
        transactions: normalized,
        complete: true,
      });
      assert.equal(
        oracle.issues.length,
        0,
        "Published n8n reconciliation has unresolved issues",
      );
      assert.equal(
        compared.filter((r) => r.state === "conflict").length,
        0,
        "Native chain differs from verified legacy ledger",
      );
      assert.deepEqual(
        [
          ...new Set(
            compared
              .filter((r) => r.state === "missing")
              .flatMap((r) => r.plan.sourceIds),
          ),
        ].sort((a, b) => a - b),
        [...oracle.fresh.map((r) => Number(r.id))].sort((a, b) => a - b),
        "Missing native chains must be exactly the fresh source operations found by n8n",
      );
      const report = {
        execution: snapshot.sourceExecution,
        sourceOperations: all.length,
        matched: compared.filter((r) => r.state === "matched").length,
        missing: compared
          .filter((r) => r.state === "missing")
          .map((r) => ({
            key: r.plan.key,
            sourceIds: r.plan.sourceIds,
            label: r.plan.label,
          })),
        conflicts: compared
          .filter((r) => r.state === "conflict")
          .map((r) => ({ sourceIds: r.plan.sourceIds, problems: r.problems })),
        legacyIssues: oracle.issues,
        legacyFresh: oracle.fresh.map((r) => r.id),
        review: native.review,
      };
      await writeFile(
        "/private/tmp/encashment-comparison-20261031.json",
        JSON.stringify(report, null, 2),
        { mode: 0o600 },
      );
      console.log(JSON.stringify(report));
    }
  }
  console.log(
    "PASS: cash-shift dates, delayed arrivals, exact cents, complete chains, accounts/categories, duplicate/partial aggregates, reviewed overrides and source-change holds",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
