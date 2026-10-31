import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
const dir = await mkdtemp(join(tmpdir(), "automation-state-"));
try {
  await symlink(resolve("node_modules"), join(dir, "node_modules"));
  const modules = {
    state: "src/lib/automations/state.ts",
    "payroll-rules": "src/lib/automations/payroll-rules.ts",
    settings: "src/lib/payroll/automation-settings.ts",
    time: "src/lib/sales/time.ts",
  };
  for (const [name, path] of Object.entries(modules)) {
    let source = ts.transpileModule(await readFile(path, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    source = source
      .replaceAll("@/lib/sales/time", "./time.mjs")
      .replaceAll("@/lib/payroll/automation-settings", "./settings.mjs")
      .replaceAll("./payroll-rules", "./payroll-rules.mjs");
    // The runtime's JSON import support varies between bundled Node versions.
    source = source.replace(
      /import defaults from [^;]+;/,
      "const defaults = " +
        (await readFile("src/lib/payroll/automation-defaults.json", "utf8")) +
        ";",
    );
    await writeFile(join(dir, name + ".mjs"), source);
  }
  const { planFromSnapshot, automationPersonSchema } = await import(
    pathToFileURL(join(dir, "state.mjs")).href
  );
  const defaults = JSON.parse(
    await readFile("src/lib/payroll/automation-defaults.json", "utf8"),
  );
  const person = {
    employee_id: "employee",
    employment_id: "episode",
    hired_on: "2026-01-01",
    birthday: null,
    gender: null,
    gift_role: null,
    medical_required: true,
    medical_state: "present",
    medical_case_id: "case",
    examined_on: "2026-01-02",
    valid_until: "2026-10-28",
    reimbursement_state: "recorded",
    legacy_reconciled: true,
    missing_fine_state: "not_recorded",
    expiry_fine_state: "not_recorded",
    version: 1,
  };
  const snapshot = {
    account_id: "account",
    venue_id: "venue",
    timezone: "Europe/Moscow",
    settings: { version: 1, config: defaults },
    employees: [
      {
        id: "employee",
        name: "Сотрудник",
        role_name: "Бармен",
        active: true,
        subject: person,
      },
    ],
    uniform: [],
    recorded: [],
  };
  const result = planFromSnapshot(snapshot, "2026-10-29");
  const fine = result.decisions.find((d) => d.rule === "medical_expired");
  assert.ok(fine);
  assert.equal(fine.amount, 3000);
  const unchecked = structuredClone(snapshot);
  unchecked.employees[0].subject.legacy_reconciled = false;
  unchecked.employees[0].subject.expiry_fine_state = "unknown";
  assert.ok(
    planFromSnapshot(unchecked, "2026-10-29").blockers.some(
      (b) => b.code === "legacy_fine_unreconciled",
    ),
  );
  const changed = structuredClone(snapshot);
  changed.settings.version = 2;
  changed.settings.config.medical.expiry_amount = 3500;
  changed.recorded = [{ key: fine.key, decision: fine }];
  const correction = planFromSnapshot(changed, "2026-10-29");
  assert.equal(
    correction.decisions.filter((d) => d.rule === "medical_expired").length,
    0,
  );
  assert.ok(
    correction.blockers.some((b) => b.code === "recorded_effect_changed"),
  );
  const previouslyCharged = structuredClone(snapshot);
  previouslyCharged.employees[0].subject.expiry_fine_state = "recorded";
  assert.equal(
    planFromSnapshot(previouslyCharged, "2026-10-29").decisions.filter(
      (d) => d.rule === "medical_expired",
    ).length,
    0,
  );
  const waived = structuredClone(snapshot);
  waived.employees[0].subject.expiry_fine_state = "waived";
  assert.equal(
    planFromSnapshot(waived, "2026-10-29").decisions.filter(
      (d) => d.rule === "medical_expired",
    ).length,
    0,
    "A deleted legacy fine must not reappear",
  );
  const cleaner = structuredClone(snapshot);
  Object.assign(cleaner.employees[0].subject, {
    medical_required: false,
    gift_role: "Клиннер",
    hired_on: null,
  });
  assert.equal(
    planFromSnapshot(cleaner, "2026-10-29").blockers.length,
    0,
    "Ineligible gift roles do not need a hire date",
  );
  const unknown = structuredClone(snapshot);
  unknown.employees[0].subject.medical_state = "unknown";
  assert.ok(
    !planFromSnapshot(unknown, "2026-10-29").decisions.some((d) =>
      d.rule.startsWith("medical_"),
    ),
  );
  const unsaved = structuredClone(snapshot);
  unsaved.settings = null;
  assert.throws(
    () => planFromSnapshot(unsaved, "2026-10-29"),
    /Сначала сохраните/,
  );
  const input = Object.fromEntries(
    [
      "legacy_reconciled",
      "missing_fine_state",
      "expiry_fine_state",
      "hired_on",
      "birthday",
      "gender",
      "gift_role",
      "medical_required",
      "medical_state",
      "examined_on",
      "valid_until",
      "reimbursement_state",
    ].map((k) => [k, person[k]]),
  );
  input.new_medical_case = false;
  assert.ok(automationPersonSchema.safeParse(input).success);
  assert.ok(
    !automationPersonSchema.safeParse({ ...input, examined_on: "2026-02-30" })
      .success,
  );
  assert.ok(
    !automationPersonSchema.safeParse({ ...input, valid_until: "2025-01-01" })
      .success,
  );
  console.log(
    "PASS: medical reconciliation holds, recorded corrections, unknown-source hold, saved settings, strict calendar dates",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
