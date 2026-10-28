import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
const dir = await mkdtemp(join(tmpdir(), "native-payroll-rules-"));
try {
  const code = ts.transpileModule(
    await readFile("src/lib/automations/payroll-rules.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  await writeFile(join(dir, "rules.mjs"), code);
  const { planPayrollAutomations: plan, uniformSchedule } = await import(
    pathToFileURL(join(dir, "rules.mjs")).href
  );
  const defaults = JSON.parse(
    await readFile("src/lib/payroll/automation-defaults.json", "utf8"),
  );
  const baseEmployee = {
    id: "employee-1",
    employmentId: "employment-1",
    active: true,
    hiredOn: "2026-01-01",
    birthday: "1990-10-28",
    gender: "male",
    giftRole: "Мастер",
    medicalRequired: true,
    medicalCase: {
      id: "document-1",
      examinedOn: "2026-01-02",
      validUntil: "2026-10-27",
      reimbursementRecorded: true,
    },
  };
  const input = (patch = {}) => ({
    venueId: "venue-1",
    businessDate: "2026-10-28",
    ruleVersion: 1,
    config: structuredClone(defaults),
    employees: [structuredClone(baseEmployee)],
    tasks: [],
    uniformIssues: [],
    recordedKeys: [],
    ...patch,
  });
  const result = plan(input());
  const expiry = result.decisions.filter((d) => d.rule === "medical_expired");
  assert.equal(expiry.length, 1);
  assert.equal(expiry[0].amount, 3000);
  assert.equal(
    plan(input({ businessDate: "2026-10-29" })).decisions.filter(
      (d) => d.rule === "medical_expired",
    ).length,
    0,
  );
  assert.equal(
    plan(
      input({
        recordedKeys: result.decisions.map((d) => d.key),
        ruleVersion: 2,
      }),
    ).decisions.length,
    0,
    "Rule edit must not give existing events new identities",
  );
  const correctedExpiry = plan(
    input({
      businessDate: "2026-10-29",
      employees: [
        {
          ...baseEmployee,
          medicalCase: {
            ...baseEmployee.medicalCase,
            validUntil: "2026-10-28",
          },
        },
      ],
      recordedKeys: [expiry[0].key],
    }),
  );
  assert.equal(
    correctedExpiry.decisions.filter((d) => d.rule === "medical_expired")
      .length,
    0,
  );
  assert.equal(
    correctedExpiry.recordedCandidates.find((d) => d.rule === "medical_expired")
      .key,
    expiry[0].key,
    "Correcting expiry date within the same case must not produce a second fine",
  );
  assert.equal(
    result.decisions.find((d) => d.rule === "holiday").amount,
    7000,
    "Birthday amount comes from numeric configuration",
  );
  const otherVenue = plan(input({ venueId: "venue-2" }));
  assert.notEqual(result.decisions[0].key, otherVenue.decisions[0].key);
  const unknown = plan(
    input({
      employees: [{ ...baseEmployee, medicalCase: undefined, giftRole: null }],
    }),
  );
  assert.equal(unknown.decisions.length, 0);
  assert(unknown.blockers.some((b) => b.code === "medical_case_unreconciled"));
  assert(unknown.blockers.some((b) => b.code === "gift_role_unmapped"));
  const provided = plan(
    input({
      businessDate: "2026-02-01",
      employees: [{ ...baseEmployee, hiredOn: "2026-01-01", birthday: null }],
    }),
  );
  assert.equal(
    provided.decisions.filter((d) => d.rule === "medical_missing").length,
    0,
    "Existing document must prevent missing-document fine",
  );
  const missing = plan(
    input({
      businessDate: "2026-02-01",
      employees: [{ ...baseEmployee, medicalCase: null, birthday: null }],
    }),
  );
  assert.equal(
    missing.decisions.filter((d) => d.rule === "medical_missing").length,
    1,
  );
  const missingKey = missing.decisions.find(
    (d) => d.rule === "medical_missing",
  ).key;
  const correctedHire = plan(
    input({
      businessDate: "2026-02-02",
      employees: [
        {
          ...baseEmployee,
          hiredOn: "2026-01-02",
          medicalCase: null,
          birthday: null,
        },
      ],
      recordedKeys: [missingKey],
    }),
  );
  assert.equal(
    correctedHire.decisions.filter((d) => d.rule === "medical_missing").length,
    0,
  );
  assert.equal(
    correctedHire.recordedCandidates.find((d) => d.rule === "medical_missing")
      .key,
    missingKey,
    "A corrected hire date cannot create a second absence-case fine",
  );
  const unknownEmployment = plan(
    input({
      businessDate: "2026-02-01",
      employees: [
        {
          ...baseEmployee,
          employmentId: null,
          medicalCase: null,
          birthday: null,
        },
      ],
    }),
  );
  assert.equal(
    unknownEmployment.decisions.filter((d) => d.rule === "medical_missing")
      .length,
    0,
  );
  assert(
    unknownEmployment.blockers.some(
      (b) => b.code === "medical_employment_unreconciled",
    ),
  );
  const reimbursementInput = input({
    businessDate: "2026-04-02",
    employees: [
      {
        ...baseEmployee,
        birthday: null,
        medicalCase: {
          ...baseEmployee.medicalCase,
          reimbursementRecorded: null,
        },
      },
    ],
  });
  const held = plan(reimbursementInput);
  assert.equal(
    held.decisions.filter((d) => d.rule === "medical_reimbursement").length,
    0,
  );
  assert(
    held.blockers.some((b) => b.code === "medical_reimbursement_unreconciled"),
  );
  reimbursementInput.employees[0].medicalCase.reimbursementRecorded = false;
  assert.equal(
    plan(reimbursementInput).decisions.find(
      (d) => d.rule === "medical_reimbursement",
    ).amount,
    3000,
  );
  const parts = uniformSchedule(1000.01, "2026-12-18", 4, [3, 18]);
  assert.deepEqual(
    parts.map((p) => p.dueOn),
    ["2026-12-18", "2027-01-03", "2027-01-18", "2027-02-03"],
  );
  assert.equal(
    parts.reduce((s, p) => s + Math.round(p.amount * 100), 0),
    100001,
  );
  assert.equal(
    uniformSchedule(0.02, "2026-10-03", 4, [3, 18]).some((p) => p.amount < 0),
    false,
  );
  assert.throws(() => uniformSchedule(100, "2026-10-04", 4, [3, 18]));
  const task = {
    id: "task-1",
    occurrenceId: "occurrence-1",
    employeeId: "employee-1",
    businessDate: "2026-10-28",
    title: "Test task",
    result: "incomplete",
    transferred: true,
    fineAmount: null,
    rewardAmount: 300,
  };
  const finePlan = plan(input({ tasks: [task] }));
  assert.equal(finePlan.decisions.find((d) => d.rule === "task").amount, 200);
  const rewardPlan = plan(input({ tasks: [{ ...task, result: "completed" }] }));
  assert.equal(
    rewardPlan.decisions.find((d) => d.rule === "task").medium,
    "bonus",
  );
  assert.equal(
    finePlan.decisions.find((d) => d.rule === "task").key,
    rewardPlan.decisions.find((d) => d.rule === "task").key,
    "Correcting one outcome must be reconciled, not become a second event",
  );
  const correctedTask = plan(
    input({
      tasks: [{ ...task, result: "completed" }],
      recordedKeys: [finePlan.decisions.find((d) => d.rule === "task").key],
    }),
  );
  assert.equal(
    correctedTask.decisions.filter((d) => d.rule === "task").length,
    0,
  );
  assert.equal(
    correctedTask.recordedCandidates.find((d) => d.rule === "task").kind,
    "bonus",
    "A changed existing outcome must remain visible for reconciliation, never be reapplied",
  );
  for (const outcome of [
    { ...task, result: "completed", transferred: false },
    { ...task, result: "completed", rewardAmount: null },
    { ...task, result: "completed", rewardAmount: 0 },
  ]) {
    const uncharged = plan(
      input({
        tasks: [outcome],
        recordedKeys: [finePlan.decisions.find((d) => d.rule === "task").key],
      }),
    );
    assert.equal(
      uncharged.decisions.filter((d) => d.rule === "task").length,
      0,
    );
    assert(
      uncharged.blockers.some((b) => b.code === "recorded_task_has_no_charge"),
      "A corrected outcome with no new charge must not hide the previously recorded fine",
    );
  }
  const futureHire = plan(
    input({
      employees: [{ ...baseEmployee, hiredOn: "2026-11-01" }],
      tasks: [task],
      uniformIssues: [
        {
          id: "uniform-1",
          employeeId: "employee-1",
          installments: [{ dueOn: "2026-10-28", amount: 100 }],
        },
      ],
    }),
  );
  assert.equal(
    futureHire.decisions.length,
    0,
    "No payroll effects before the hire date",
  );
  const taskOff = input({ tasks: [task] });
  taskOff.config.tasks.missing_enabled = false;
  assert.equal(
    plan(taskOff).decisions.filter((d) => d.rule === "task").length,
    0,
  );
  const pending = plan(
    input({ tasks: [{ ...task, result: "awaiting_review" }] }),
  );
  assert.equal(pending.decisions.filter((d) => d.rule === "task").length, 0);
  assert(pending.blockers.some((b) => b.code === "task_awaiting_review"));
  assert.equal(
    plan(
      input({ employees: [{ ...baseEmployee, active: false }], tasks: [task] }),
    ).decisions.length,
    0,
  );
  assert.throws(() => plan(input({ ruleVersion: 0 })));
  assert.throws(() => plan(input({ employees: [baseEmployee, baseEmployee] })));
  console.log(
    "PASS: once-per-case medical fine, legacy-state holds, gift eligibility, numeric gifts, stable event keys, exact uniform residuals, confirmed task outcomes, disabled rules, no external calls",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
