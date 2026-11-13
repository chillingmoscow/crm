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
    { applyScheduleReviews,reconcileAttendance,reconcileBoundaryClocks,attendanceRuleAtDate,payrollFactRows } = await import(
      pathToFileURL(join(dir, "attendance.mjs")).href
    ),
    { businessDate, dayWindow } = await import(
      pathToFileURL(join(dir, "time.mjs")).href
    );
  const clocks=[{id:1,owner:{id:84},startTime:Date.parse("2026-09-01T02:00:00Z"),endTime:null},{id:2,owner:{id:174},startTime:Date.parse("2026-09-01T10:00:00Z"),endTime:Date.parse("2026-09-01T18:00:00Z")}];
  const staff=[{id:"technical",quickresto_id:84,attendance_source:"excluded",active:true,local_user_id:null,role_name:"Мастер"},{id:"real",quickresto_id:174,attendance_source:"quickresto",active:true,local_user_id:null,role_name:"Мастер"}];
  assert.deepEqual(payrollFactRows(clocks,staff).map(r=>r.owner.id),[174],"Technical open clocks cannot affect day boundaries or team shares");
  assert.deepEqual(reconcileAttendance(clocks,staff,[],"2026-09-01","Europe/Moscow",9).items.map(r=>r.employee_id),["real"]);
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
  const calculateOn = (date, patch = {}) => calc.computeAccrual({ ...input, date,
    experienceStartsOn: "2026-11-10", ...patch });
  const tenure = (date, patch) => calculateOn(date, patch).components.find(c => c.kind === "experience")?.amount;
  assert.equal(tenure("2026-11-09"), 0, "No tenure supplement before the owner-selected date");
  assert.equal(tenure("2026-11-10"), 300, "The first configured day earns the normal full tenure step");
  assert.equal(tenure("2026-11-11"), 300);
  assert.equal(tenure("2026-11-10", { experienceStartsOn: null }), 0, "Unconfigured start must fail closed");
  assert.equal(tenure("2026-11-10", { rule: { ...rule, tenure_requires_exam: true } }), 300,
    "Former test flags cannot block tenure after the start date");
  assert.equal(calculateOn("2026-11-10", { qualification: { knowledge: true, experience: true } }).salary,
    calculateOn("2026-11-10").salary, "Retired test payloads must not add money");
  assert.equal(calculateOn("2026-11-10").components.some(c => c.kind === "knowledge"), false,
    "Former model knowledge amounts must never produce new knowledge components");
  assert.equal(calc.computeAccrual({ ...input, experienceStartsOn: "2026-11-10" }).salary, 5917);
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
  assert.equal(result.components.some((c) => c.kind === "knowledge"), false);
  result = calc.computeAccrual({
    ...input,
    date: "2026-11-10",
    experienceStartsOn: "2026-11-10",
  });
  assert.equal(result.salary, 6217);
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
  const barModel = {
    ...model, id: "bar-pay", role_id: "bartender", role_name: "Бармен",
    basis: "bar", is_role_default: true, experience: false, extras_enabled: false,
  };
  const seniorModel = { ...barModel, id: "senior-pay", role_id: "senior-bartender" };
  const barShift = { role_id: "bartender", department_id: "bar", payroll_model_id: null };
  const senior = { ...employee, model_id: seniorModel.id, role_id: seniorModel.role_id, role_name: "Бармен" };
  const payModels = [barModel, seniorModel, { ...model, role_id: "master" }];
  const departments = new Map([["bartender", "bar"], ["senior-bartender", "bar"], ["master", "lounge"]]);
  const payModelFor = (shift, person, newRule = true) =>
    calc.shiftPayModelId(shift, person, payModels, departments, newRule);

  assert.equal(payModelFor(barShift, senior), seniorModel.id, "Same department keeps the primary pay model");
  assert.equal(payModelFor({ ...barShift, department_id: null }, senior), seniorModel.id, "Legacy shift department can come from its position");
  assert.equal(payModelFor(barShift, { ...employee, role_id: "master" }), barModel.id, "A substitute from another department uses the shift default");
  assert.equal(payModelFor(barShift, senior, false), barModel.id, "Existing shifts keep the previous policy");
  assert.equal(payModelFor({ ...barShift, payroll_model_id: barModel.id }, senior), barModel.id, "An explicit shift model takes precedence");
  assert.equal(payModelFor({ ...barShift, role_id: null }, senior), seniorModel.id, "An unspecified shift position keeps the personal model");
  assert.equal(payModelFor(barShift, { ...senior, model_id: null }), barModel.id, "The position default covers an employee with no own model");

  const barRules = [barModel, seniorModel].map((payModel) => ({
    ...rule,
    model_id: payModel.id,
    rates: { 1: { 1: { base: 2500, percent: payModel === seniorModel ? 7.5 : 6 } } },
  }));
  const barPayFor = (person) => {
    const modelId = payModelFor(barShift, person);
    const resolved = { ...person, model_id: modelId, role_name: "Бармен" };
    return calc.computeAccrual({
      ...input,
      employee: resolved,
      model: payModels.find((payModel) => payModel.id === modelId),
      rule: calc.selectRule(barRules, resolved, "2026-11-09"),
      date: "2026-11-09",
      roleCount: 1,
      metrics: { bar: 100000, tips_total: 0 },
    }).salary;
  };
  assert.equal(barPayFor(senior), 10000);
  assert.equal(barPayFor({ ...employee, role_id: "master" }), 8500);

  // Same-department substitute: own rate, but the duty is the shift position.
  const leadModel = { ...barModel, id: "lead-pay", role_id: "bar-lead", role_name: "Старший смены", is_role_default: true };
  const lead = { ...employee, model_id: leadModel.id, role_id: "bar-lead", role_name: "Старший смены" };
  const dutyModels = [barModel, leadModel];
  const dutyDepartments = new Map([["bartender", "bar"], ["bar-lead", "bar"]]);
  const leadModelId = calc.shiftPayModelId(barShift, lead, dutyModels, dutyDepartments, true);
  assert.equal(leadModelId, leadModel.id, "A same-department substitute keeps the own rate");
  assert.equal(
    calc.shiftDutyRoleName(barShift, dutyModels, leadModelId, "Бармен", lead.role_name),
    "Бармен",
    "The shift position decides who shares the bar rate and extras",
  );
  assert.equal(
    calc.shiftDutyRoleName({ ...barShift, role_id: "no-default" }, dutyModels, leadModelId, "Бармен-стажёр", lead.role_name),
    "Бармен-стажёр",
    "A position without a default model still names the duty",
  );
  assert.equal(
    calc.shiftDutyRoleName({ ...barShift, payroll_model_id: leadModel.id }, dutyModels, leadModel.id, "Бармен", lead.role_name),
    "Старший смены",
    "An explicit shift model keeps its own duty",
  );
  assert.equal(
    calc.shiftDutyRoleName({ ...barShift, role_id: null }, dutyModels, leadModelId, null, lead.role_name),
    "Старший смены",
    "A shift without a position keeps the personal duty",
  );
  assert.equal(
    calc.shiftPayModelId(barShift, lead, dutyModels, dutyDepartments, true, (id) => id !== leadModel.id),
    barModel.id,
    "A salary-only primary position does not leave the substitute shift unpaid",
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
    version: 3,
    payroll_fact_id: -101,
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
  for (const changed of [
    { startTime: night.startTime - 30 * 60000 },
    { startTime: night.startTime + 30 * 60000 },
    { endTime: night.endTime - 30 * 60000 },
  ]) {
    const result = reconcileAttendance(
      [{ ...night, ...changed }],
      [employee],
      [shift],
      "2026-09-01",
      "Europe/Moscow",
      9,
    );
    assert.equal(result.items[0].status, "confirmed");
    assert.equal(result.items[0].issue, null);
    assert.equal(result.missing.length, 0);
  }
  assert.equal(
    reconcileAttendance([], [employee], [shift], "2026-09-01", "Europe/Moscow", 9)
      .missing[0].shift.id,
    shift.id,
  );
  const workDay = "2026-09-01";
  const missing = reconcileAttendance([], [employee], [shift], workDay, "Europe/Moscow", 9);
  const fallback = applyScheduleReviews(missing, [shift], [], workDay, "2026-08-31T00:00:00Z");
  assert.equal(fallback.items[0].external_id, -101);
  assert.equal(fallback.marks.s1.state, "scheduled");
  assert.equal(fallback.marks.s1.shiftVersion, shift.version);
  assert.equal(fallback.missing.length, 0);
  const former = reconcileAttendance([], [{ ...employee, active: false }], [shift], workDay, "Europe/Moscow", 9);
  assert.equal(applyScheduleReviews(former, [shift], [], workDay, "2026-08-31T00:00:00Z").items.length, 0);
  assert.equal(applyScheduleReviews(former, [shift], [], workDay, "2026-08-31T00:00:00Z", { prior: fallback.items }).items[0].external_id, -101);
  const priorExcluded = [{ ...fallback.items[0], status: "ignored", starts_at: "2026-09-01T09:00:00+00:00",
    reviewed_by: "manager", review_reason: "Смена отменена" }];
  const replayExcluded = applyScheduleReviews(missing, [shift], [], workDay, "2026-08-31T00:00:00Z", { prior: priorExcluded });
  assert.equal(replayExcluded.items[0].status, "ignored");
  assert.equal(replayExcluded.marks.s1.state, "excluded");
  assert.equal(replayExcluded.marks.s1.reason, "Смена отменена");
  assert.equal(applyScheduleReviews(former, [shift], [], workDay, null, { prior: priorExcluded }).items[0].status, "ignored");
  const unmatched = reconcileAttendance(
    [{ ...night, startTime: Date.parse("2026-09-01T06:00:00Z"), endTime: Date.parse("2026-09-01T08:00:00Z") }],
    [employee],
    [shift],
    workDay,
    "Europe/Moscow",
    9,
  );
  const ambiguous = applyScheduleReviews(unmatched, [shift], [], workDay, "2026-08-31T00:00:00Z");
  assert.equal(ambiguous.items.length, 1);
  assert.equal(ambiguous.marks.s1.state, "missing");
  assert.equal(ambiguous.marks.s1.hasQuickResto, true);
  const historical = applyScheduleReviews(missing, [shift], [], workDay, "2026-09-02T00:00:00Z");
  assert.equal(historical.items.length, 0);
  assert.equal(historical.marks.s1.state, "missing");
  const reviewed = {
    shift_id: shift.id,
    employee_id: employee.id,
    snapshot: shift,
    reason: "Проверено управляющим",
  };
  const included = applyScheduleReviews(missing, [shift], [{ ...reviewed, decision: "include" }], workDay, null);
  assert.equal(included.items[0].status, "confirmed");
  assert.equal(included.marks.s1.state, "included");
  const reincluded = applyScheduleReviews(
    missing, [shift], [{ ...reviewed, decision: "include" }], workDay, null, { prior: priorExcluded },
  );
  assert.equal(reincluded.items[0].status, "confirmed");
  assert.equal(reincluded.items[0].schedule_review_override, true);
  const earlyShift = { ...shift, starts_at: "2026-09-01T06:05:00Z", ends_at: "2026-09-01T12:00:00Z" };
  const earlyClock = { ...night, startTime: Date.parse("2026-09-01T05:55:00Z"), endTime: Date.parse(earlyShift.ends_at) };
  const previous = {
    ...fallback.items[0], external_id: earlyClock.id, business_date: "2026-08-31",
    starts_at: "2026-09-01T05:55:00+00:00", ends_at: earlyShift.ends_at,
    reviewed_by: "manager", status: "confirmed",
  };
  const boundary = reconcileBoundaryClocks([earlyClock], [previous], [employee]);
  assert.equal(boundary.unresolved.length, 0);
  assert.equal(boundary.countable.length, 1);
  const earlyMissing = reconcileAttendance([], [employee], [earlyShift], workDay, "Europe/Moscow", 9);
  const noDuplicate = applyScheduleReviews(earlyMissing, [earlyShift], [], workDay, "2026-08-31T00:00:00Z", {
    boundaryClocks: boundary.countable, confirmedOnAnotherDay: [previous],
  });
  assert.equal(noDuplicate.items.length, 0);
  assert.equal(noDuplicate.missing.length, 0);
  const awaitingBoundary = applyScheduleReviews(earlyMissing, [earlyShift], [], workDay, "2026-08-31T00:00:00Z", {
    boundaryClocks: [earlyClock],
  });
  assert.equal(awaitingBoundary.items.length, 0);
  assert.equal(awaitingBoundary.marks.s1.crossBoundary, true);
  assert.equal(reconcileBoundaryClocks([earlyClock], [{ ...previous, status: "ignored" }], [employee]).countable.length, 0);
  const actual = reconcileAttendance([night], [employee], [shift], workDay, "Europe/Moscow", 9);
  const excluded = applyScheduleReviews(actual, [shift], [{ ...reviewed, decision: "exclude" }], workDay, null);
  assert.equal(excluded.items[0].status, "ignored");
  assert.equal(excluded.marks.s1.state, "excluded");
  const stale = applyScheduleReviews(missing, [shift], [
    { ...reviewed, snapshot: { ...shift, user_id: "other" }, decision: "include" },
  ], workDay, null);
  assert.equal(stale.marks.s1.state, "missing");
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
    "PASS: real golden calculation, tenure starts on 10 November without tests or knowledge payments, 3/4 employees, missing rates, dated models/rules, overnight attendance, unmapped replacement, open shifts, 09:00 boundary, exact multi-withdrawal cent allocation, 0/100/101 RUB, explicit transfers, no automatic carry-forward, partial/cancelled payments, IDs and full year",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
