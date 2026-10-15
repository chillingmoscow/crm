// Meaningful financial scenarios against production calculation functions.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
const dir = await mkdtemp(join(tmpdir(), "sheerly-payroll-tests-"));
try {
  for (const [name, path] of [
    ["calculate", "src/lib/payroll/calculate.ts"],
    ["attendance", "src/lib/payroll/attendance.ts"],
    ["time", "src/lib/sales/time.ts"],
  ]) {
    const code = ts
      .transpileModule(await readFile(path, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.ES2022,
          target: ts.ScriptTarget.ES2022,
        },
      })
      .outputText.replace(
        /from ['"]@\/lib\/sales\/time['"]/g,
        'from "./time.mjs"',
      );
    await writeFile(join(dir, `${name}.mjs`), code);
  }
  const calc = await import(pathToFileURL(join(dir, "calculate.mjs")).href),
    { reconcileAttendance,attendanceRuleAtDate } = await import(
      pathToFileURL(join(dir, "attendance.mjs")).href
    ),
    { businessDate, dayWindow } = await import(
      pathToFileURL(join(dir, "time.mjs")).href
    );
  assert.equal(calc.recognizeTipComment(" ЧАЕВЫЕ ", ["чаевые"]), "exact");
  assert.equal(
    calc.recognizeTipComment("чаевые и хозяйственные расходы", ["чаевые"]),
    "ambiguous",
  );
  assert.equal(calc.recognizeTipComment("такси", ["чаевые"]), null);
  const employee = {
    id: "e1",
    model_id: "m1",
    name: "Same name",
    role_name: "Мастер",
    local_user_id: "u1",
    quickresto_id: 174,
    hired_on: "2026-06-01",
    experience_offset_months: 0,
    opening_balance: 100,
    opening_confirmed: true,
    active: true,
  };
  const model = {
    id: "m1",
    name: "Master",
    role_name: "Мастер",
    basis: "hookah",
    tips: true,
    experience: true,
    knowledge_amount: 200,
    food_amount: 0,
    cleaner_bonus: 0,
    monthly_amount: 0,
  };
  const rates = Object.fromEntries(
    [1, 2, 3, 4].map((n) => [
      String(n),
      Object.fromEntries(
        [1, 2, 3, 4, 5, 6, 7].map((d) => [
          String(d),
          { base: 1500, percent: 6 },
        ]),
      ),
    ]),
  );
  const rule = {
    id: "r1",
    model_id: "m1",
    employee_id: null,
    valid_from: "2026-09-01",
    rates,
    experience_steps: { 1: 120, 2: 220, 3: 300 },
    tenure_requires_exam: true,
    config: {},
  };
  const input = {
    employee,
    model,
    rule,
    date: "2026-10-12",
    roleCount: 2,
    tipRecipients: 4,
    metrics: { hookah: 67360, tips_total: 2200 },
    extra: 750,
    attendanceIssues: [],
    adjustments: [],
    cleanerPresent: true,
  };
  assert.equal(calc.hasShiftPay({...model,monthly_amount:20000},rule),true);
  assert.equal(calc.hasShiftPay({...model,monthly_amount:47700},{...rule,rates:{}}),false);
  assert.equal(calc.hasShiftPay(model,{...rule,config:{shift_pay:false}}),false);
  const merged=calc.mergeMonthlyAccrual({salary:6417,components:[{kind:"deduction",amount:-300}],issues:[],calculation_snapshot:{role:"Менеджер"}},20000,rule,"2026-10-01");
  assert.equal(merged.salary,26417);
  assert.equal(merged.components.filter(c=>c.kind==="deduction").length,1);
  assert.equal(merged.components.find(c=>c.kind==="monthly").amount,20000);
  assert.equal(merged.calculation_snapshot.role,"Менеджер");
  const withoutExtras=calc.computeAccrual({...input,model:{...model,extras_enabled:false}});
  assert.equal(withoutExtras.components.some(c=>c.kind==="extra"),false);
  const newer={...rule,id:"r2",created_at:"2026-10-15T12:00:00Z"};
  assert.equal(calc.selectRule([{...rule,created_at:"2026-10-15T11:00:00Z"},newer],employee,input.date).id,"r2");
  let result = calc.computeAccrual(input);
  assert.equal(result.salary, 5917);
  assert.equal(result.tips, 550);
  assert.equal(
    result.components.find((c) => c.kind === "experience").amount,
    0,
  );
  assert.equal(result.components.find((c) => c.kind === "knowledge").amount, 0);
  result = calc.computeAccrual({
    ...input,
    qualification: { knowledge: true, experience: true },
  });
  assert.equal(result.salary, 6417);
  for (const count of [3, 4]) {
    result = calc.computeAccrual({ ...input, roleCount: count });
    assert.equal(result.salary, 1500 + 4042 + Math.round(750 / count));
    assert.deepEqual(result.issues, []);
  }
  result = calc.computeAccrual({
    ...input,
    rule: { ...rule, rates: { 1: rates[1], 2: rates[2] } },
    roleCount: 3,
  });
  assert(result.issues.some((s) => s.includes("Не задана ставка")));
  assert.equal(result.components.find((c) => c.kind === "base").amount, null);
  assert.equal(
    calc.selectRule(
      [rule, { ...rule, id: "future", valid_from: "2027-01-01" }],
      employee,
      "2026-09-30",
    ).id,
    "r1",
  );
  assert.equal(
    calc.employeeAtDate(
      employee,
      [{ employee_id: "e1", model_id: "m2", valid_from: "2026-10-01" }],
      [model, { ...model, id: "m2", role_name: "Бармен" }],
      "2026-09-30",
    ).model_id,
    "m1",
  );
  assert.equal(
    calc.employeeAtDate(
      employee,
      [{ employee_id: "e1", model_id: "m2", valid_from: "2026-10-01" }],
      [model, { ...model, id: "m2", role_name: "Бармен" }],
      "2026-10-01",
    ).role_name,
    "Бармен",
  );
  const night = {
    id: 9127,
    owner: { id: 174 },
    startTime: Date.parse("2026-09-01T09:00:00Z"),
    endTime: Date.parse("2026-09-02T00:00:00Z"),
  };
  const shift = {
    id: "s1",
    venue_id: "v1",
    user_id: "u1",
    published: true,
    starts_at: "2026-09-01T09:00:00Z",
    ends_at: "2026-09-02T00:00:00Z",
  };
  assert.equal(
    reconcileAttendance(
      [night],
      [employee],
      [shift],
      "2026-09-01",
      "Europe/Moscow",
      9,
    ).items[0].status,
    "confirmed",
  );
  assert.equal(
    reconcileAttendance(
      [{ ...night, owner: { id: 175 } }],
      [employee],
      [shift],
      "2026-09-01",
      "Europe/Moscow",
      9,
    ).items[0].status,
    "unlinked",
  );
  assert.equal(
    reconcileAttendance(
      [{ ...night, endTime: null }],
      [employee],
      [shift],
      "2026-09-01",
      "Europe/Moscow",
      9,
    ).items[0].status,
    "open",
  );
  assert.equal(
    businessDate(new Date("2026-09-02T05:59:59Z"), "Europe/Moscow", 9),
    "2026-09-01",
  );
  assert.equal(
    businessDate(new Date("2026-09-02T06:00:00Z"), "Europe/Moscow", 9),
    "2026-09-02",
  );
  assert.equal(
    dayWindow("2026-09-01", "Europe/Moscow", 9).end -
      dayWindow("2026-09-01", "Europe/Moscow", 9).start,
    86400000,
  );
  const accruals = [
    {
      id: "a1",
      employee_id: "e1",
      business_date: "2026-09-02",
      salary: 1000,
      tips: 733.33,
      issues: [],
      components: [],
      calculation_snapshot: {},
    },
    {
      id: "a2",
      employee_id: "e2",
      business_date: "2026-09-02",
      salary: 1000,
      tips: 733.33,
      issues: [],
      components: [],
      calculation_snapshot: {},
    },
    {
      id: "a3",
      employee_id: "e3",
      business_date: "2026-09-02",
      salary: 1000,
      tips: 733.34,
      issues: [],
      components: [],
      calculation_snapshot: {},
    },
  ];
  for (const diff of [0, 100, 101])
    assert.equal(
      calc.tipMatch(accruals, 2200 - diff, 100).matches,
      diff <= 100,
    );
  const cash = [
      { id: "c1", amount: 333.33, occurred_at: "2026-09-03T00:00:00Z" },
      { id: "c2", amount: 777.77, occurred_at: "2026-09-03T00:10:00Z" },
      { id: "c3", amount: 988.9, occurred_at: "2026-09-03T00:20:00Z" },
    ],
    batch = calc.tipBatch(
      "2026-09-02",
      accruals,
      cash,
      () => "bank",
      "category",
    );
  for (const a of accruals)
    assert.equal(
      Math.round(
        batch
          .flatMap((p) => p.allocations)
          .filter((x) => x.accrual_id === a.id)
          .reduce((s, x) => s + x.settled_amount, 0) * 100,
      ),
      Math.round(a.tips * 100),
    );
  for (const p of batch)
    assert.equal(
      Math.round(p.allocations.reduce((s, x) => s + x.amount, 0) * 100),
      Math.round(p.amount * 100),
    );
  const prior = {
    ...accruals[0],
    id: "prior",
    business_date: "2026-08-01",
    salary: 500,
    tips: 0,
  };
  const payments = [
      { id: "p1", kind: "advance", state: "posted" },
      { id: "p2", kind: "salary", state: "cancelled" },
    ],
    allocations = [
      {
        employee_id: "e1",
        payment_id: "p1",
        month: "2026-09-01",
        settled_amount: 400,
      },
      {
        employee_id: "e1",
        payment_id: "p2",
        month: "2026-09-01",
        settled_amount: 500,
      },
    ];
  const statement = calc.statementRows(
    [employee, { ...employee, id: "e2" }],
    [prior, ...accruals],
    [],
    payments,
    allocations,
    "2026-09-01",
  );
  assert.equal(statement[0].opening, 100);
  assert.equal(statement[0].paid, 400);
  assert.equal(statement[0].remaining, 700);
  assert.equal(statement[1].paid, 0);
  assert.equal(
    calc.statementRows(
      [employee],
      accruals,
      [],
      payments,
      allocations,
      "2027-09-01",
    )[0].earned,
    0,
  );
  const transfer = {
    employee_id: "e1",
    from_month: "2026-09-01",
    to_month: "2026-10-01",
    amount: 700,
    state: "posted",
  };
  const september = calc.statementRows(
    [employee],
    accruals,
    [],
    payments,
    allocations,
    "2026-09-01",
    [transfer],
  )[0];
  const octoberWithoutTransfer = calc.statementRows(
    [employee],
    accruals,
    [],
    payments,
    allocations,
    "2026-10-01",
  )[0];
  const october = calc.statementRows(
    [employee],
    accruals,
    [],
    payments,
    allocations,
    "2026-10-01",
    [transfer],
  )[0];
  assert.equal(september.remaining, 0);
  assert.equal(september.transferredOut, 700);
  assert.equal(octoberWithoutTransfer.remaining, 0);
  assert.equal(october.remaining, 700);
  assert.equal(
    calc.statementRows(
      [employee],
      accruals,
      [],
      payments,
      allocations,
      "2026-10-01",
      [{ ...transfer, state: "cancelled" }],
    )[0].remaining,
    0,
  );
  const casualShift = {
    id: "casual-shift",
    user_id: null,
    payroll_employee_id: employee.id,
    payroll_fact_id: -101,
    payroll_model_id: model.id,
    published: true,
    starts_at: "2026-09-10T19:00:00Z",
    ends_at: "2026-09-11T03:00:00Z",
  };
  const regularPlan={...casualShift,id:"regular-plan",payroll_employee_id:null,payroll_model_id:null,user_id:employee.local_user_id};
  const scheduleEmployee={...employee,attendance_source:"schedule"};
  const regularFact=reconcileAttendance([], [scheduleEmployee], [regularPlan],"2026-09-10","Europe/Moscow",9);
  assert.equal(regularFact.items.length,1);
  assert.equal(regularFact.items[0].employee_id,employee.id);
  assert.equal(regularFact.missing.length,0);
  assert.equal(reconcileAttendance([{id:123,owner:{id:employee.quickresto_id},startTime:Date.parse(regularPlan.starts_at),endTime:Date.parse(regularPlan.ends_at)}],[scheduleEmployee],[regularPlan],"2026-09-10","Europe/Moscow",9).items.length,1,"QR and schedule do not double a regular employee");
  assert.equal(reconcileAttendance([], [scheduleEmployee], [{...regularPlan,published:false}],"2026-09-10","Europe/Moscow",9).items.length,0);
  assert.equal(reconcileAttendance([], [employee], [regularPlan],"2026-09-10","Europe/Moscow",9).items.length,0,"regular QR employees still require a clock-in");
  const sourceRules=[{id:"s1",employee_id:employee.id,valid_from:"2026-09-01",created_at:"2026-10-15",source:"schedule"},{id:"s2",employee_id:employee.id,valid_from:"2026-11-01",created_at:"2026-10-16",source:"quickresto"}];
  assert.equal(attendanceRuleAtDate(sourceRules,employee.id,"2026-10-01").source,"schedule");
  assert.equal(attendanceRuleAtDate(sourceRules,employee.id,"2026-11-01").source,"quickresto");
  assert.equal(attendanceRuleAtDate(sourceRules,employee.id,"2026-08-31"),null);
  const casualFact = reconcileAttendance(
    [],
    [{ ...employee, active: false }],
    [casualShift],
    "2026-09-10",
    "Europe/Moscow",
    9,
  );
  assert.equal(
    casualFact.items.length,
    1,
    "former casual shift accrues without QR or account",
  );
  assert.equal(casualFact.items[0].external_id, -101);
  assert.equal(casualFact.items[0].status, "confirmed");
  assert.equal(
    reconcileAttendance(
      [],
      [employee],
      [{ ...casualShift, published: false }],
      "2026-09-10",
      "Europe/Moscow",
      9,
    ).items.length,
    0,
    "draft is not earned",
  );
  assert.equal(
    reconcileAttendance(
      [],
      [employee],
      [
        {
          ...casualShift,
          payroll_employee_id: null,
          user_id: employee.local_user_id,
        },
      ],
      "2026-09-10",
      "Europe/Moscow",
      9,
    ).items.length,
    0,
    "ordinary schedule cannot replace QR",
  );
  assert.equal(
    reconcileAttendance(
      [],
      [employee],
      [
        {
          ...casualShift,
          starts_at: "2033-09-10T19:00:00Z",
          ends_at: "2033-09-11T03:00:00Z",
        },
      ],
      "2033-09-10",
      "Europe/Moscow",
      9,
    ).items.length,
    0,
    "future casual shift is not earned",
  );
  assert.equal(
    reconcileAttendance(
      [
        {
          id: 101,
          owner: { id: employee.quickresto_id },
          startTime: Date.parse(casualShift.starts_at),
          endTime: Date.parse(casualShift.ends_at),
        },
      ],
      [employee],
      [casualShift],
      "2026-09-10",
      "Europe/Moscow",
      9,
    ).items.length,
    1,
    "casual and old QR identity do not double count",
  );
  console.log(
    "PASS: real golden calculation, qualified benefits, 3/4 employees, missing rates, dated models/rules, overnight attendance, unmapped replacement, open shifts, 09:00 boundary, exact multi-withdrawal cent allocation, 0/100/101 RUB, explicit transfers, no automatic carry-forward, partial/cancelled payments, IDs and full year",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
