import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
const dir = await mkdtemp(join(tmpdir(), "stock-rules-"));
try {
  for (const file of ["deduction-rules", "shared-shortage"]) {
    let source = ts.transpileModule(
      await readFile(`src/lib/stock/${file}.ts`, "utf8"),
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
      .replace(
        /from ["']\.\/deduction-rules["']/g,
        'from "./deduction-rules.mjs"',
      );
    await writeFile(join(dir, file + ".mjs"), source);
  }
  const {
    companyShortage: split,
    deductionDraft,
    deductionRulesSchema: schema,
  } = await import(pathToFileURL(join(dir, "deduction-rules.mjs")));
  const { allocateSharedShortage: allocate } = await import(
    pathToFileURL(join(dir, "shared-shortage.mjs"))
  );
  const A = "11111111-1111-4111-8111-111111111111",
    B = "22222222-2222-4222-8222-222222222222",
    C = "33333333-3333-4333-8333-333333333333";
  const cfg = {
    enabled: true,
    companyAllowance: 10000,
    multiplier: 1.1,
    ingredientTolerance: 250,
    distribution: "groups",
    split: "pending",
    inventoryExclusions: [],
    roleSpecificCategories: [],
    writeoffReasons: ["Бой посуды"],
    excludedRoleIds: [],
    groups: [
      { id: "bar", name: "Бар", share: 55, roleIds: [A], categories: [] },
      {
        id: "managers",
        name: "Менеджеры",
        share: 35,
        roleIds: [B],
        categories: [],
      },
      {
        id: "masters",
        name: "Мастера",
        share: 10,
        roleIds: [C],
        categories: [],
      },
    ],
  };
  assert.deepEqual(split(5339, 10000), {
    total: 5339,
    company: 5339,
    employees: 0,
  });
  assert.deepEqual(split(10000, 10000), {
    total: 10000,
    company: 10000,
    employees: 0,
  });
  assert.deepEqual(split(10000.01, 10000), {
    total: 10000.01,
    company: 10000,
    employees: 0.01,
  });
  assert.deepEqual(split(null, 10000), {
    total: null,
    company: null,
    employees: null,
  });
  assert.throws(() => split(-1, 10000));
  assert.throws(() => split(20000, NaN));
  const weights = [
    { employeeId: "e1", roleId: A, shifts: 5 },
    { employeeId: "e2", roleId: A, shifts: 5 },
    { employeeId: "e1", roleId: B, shifts: 5 },
    { employeeId: "e3", roleId: C, shifts: 10 },
  ];
  const r = allocate(11000, cfg, weights);
  assert.equal(r.allocated, 1000);
  assert.equal(r.state, "period_required");
  assert.deepEqual(r.allocations, [
    { employeeId: "e1", amount: 625 },
    { employeeId: "e2", amount: 275 },
    { employeeId: "e3", amount: 100 },
  ]);
  assert.deepEqual(
    allocate(11000, cfg, weights.slice().reverse()),
    r,
    "Query order does not alter cents or employee role substitutions",
  );
  const missing = allocate(
    11000,
    cfg,
    weights.filter((w) => w.roleId !== C),
  );
  assert.equal(missing.unallocated, 100);
  assert.equal(
    missing.state,
    "incomplete",
    "Absent group cannot silently shift its charge onto other staff",
  );
  const once = { ...cfg, split: "once" };
  assert.equal(allocate(10000.01, once, weights).allocated, 0.01);
  assert.equal(allocate(10000.01, once, weights).state, "ready");
  const unknown = allocate(11000, cfg, [
    ...weights,
    { employeeId: "new", roleId: "unmapped", shifts: 1 },
  ]);
  assert.equal(unknown.state, "incomplete");
  assert.deepEqual(unknown.unassignedRoles, ["unmapped"]);
  assert.throws(() => allocate(11000, cfg, [weights[0], weights[0]]));
  assert.equal(allocate(null, cfg, weights).state, "incomplete");
  assert.equal(allocate(10000, cfg, weights).state, "ready");
  assert.equal(
    allocate(11000, { ...cfg, enabled: false }, weights).company,
    11000,
  );
  assert.equal(
    allocate(
      11000,
      { ...once, distribution: "shifts", excludedRoleIds: [C], groups: [] },
      weights,
    ).allocated,
    1000,
  );
  assert.throws(() =>
    schema.parse({
      ...cfg,
      groups: [...cfg.groups, { ...cfg.groups[0], id: "duplicate-role" }],
    }),
  );
  const alpha = "abcdefab-abcd-4abc-8abc-abcdefabcdef";
  assert.throws(() =>
    schema.parse({
      ...cfg,
      groups: [{ ...cfg.groups[0], share: 100, roleIds: [alpha] }],
      excludedRoleIds: [alpha.toUpperCase()],
    }),
  );
  assert.throws(() => schema.parse({ ...cfg, companyAllowance: -1 }));
  assert.throws(() =>
    schema.parse({ ...cfg, writeoffReasons: ["Бой посуды", "БОЙ ПОСУДЫ"] }),
  );
  if (process.argv[2]) {
    const source = JSON.parse(await readFile(process.argv[2], "utf8")),
      draft = deductionDraft(source.origin, source.roles);
    assert.equal(source.total, 5339);
    assert.equal(draft.companyAllowance, 10000);
    assert.equal(draft.multiplier, 1.1);
    assert.equal(draft.ingredientTolerance, 250);
    assert.equal(draft.split, "pending");
    assert.equal(allocate(source.total, draft, []).employees, 0);
    assert.equal(draft.inventoryExclusions.length, 32);
  }
  console.log(
    "PASS: actual 5339 RUB company-only pool, unknown/negative rejection, no unused-limit bonus, cent conservation, role substitutions, missing/unmapped groups blocked, exact dated-source draft, pending installment policy",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
