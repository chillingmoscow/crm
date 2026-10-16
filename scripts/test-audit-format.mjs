// Regressions from PR 561: calendar dates, shared enums and identifiable diffs.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const dir = await mkdtemp(join(tmpdir(), "sheerly-audit-format-"));
const originalZone = process.env.TZ;
try {
  for (const [name, path] of [
    ["constants", "src/lib/constants.ts"],
    ["labels", "src/lib/audit/labels.ts"],
  ]) {
    const code = ts.transpileModule(await readFile(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    }).outputText.replace(/from ["']\.\.\/constants["']/g, 'from "./constants.mjs"');
    await writeFile(join(dir, `${name}.mjs`), code);
  }
  const { auditFieldValueLabel, auditFieldLabel, formatAuditDate } = await import(pathToFileURL(join(dir, "labels.mjs")).href);
  const { VENUE_TYPES } = await import(pathToFileURL(join(dir, "constants.mjs")).href);
  for (const zone of ["UTC", "America/Los_Angeles", "Pacific/Honolulu", "Europe/Moscow", "Pacific/Kiritimati"]) {
    process.env.TZ = zone;
    assert.equal(formatAuditDate("2026-10-01"), "01.10.2026", zone);
    assert.equal(formatAuditDate("2024-02-29"), "29.02.2024", zone);
    assert.equal(formatAuditDate("2026-01-01"), "01.01.2026", zone);
  }
  assert.equal(formatAuditDate(null), "—");
  assert.equal(formatAuditDate("invalid-date"), "invalid-date");
  for (const { value, label } of VENUE_TYPES) assert.equal(auditFieldValueLabel("type", value), label);
  assert.notEqual(auditFieldValueLabel("type", "restaurant"), auditFieldValueLabel("type", "bar"));
  // The renderer falls back to the original value/key rather than hiding new data.
  assert.equal(auditFieldValueLabel("type", "future_venue_type"), null);
  assert.equal(auditFieldValueLabel("medium", "future_medium"), null);
  assert.equal(auditFieldLabel("timezone"), "часовой пояс");
  assert.equal(auditFieldLabel("future_setting"), "future_setting");
  assert.equal(auditFieldValueLabel("medium", "bonus"), "Бонусы");
  assert.equal(auditFieldValueLabel("medium", "money"), "Деньги");
  assert.equal(auditFieldValueLabel("external_state", "review"), "Ожидает проверки");
  assert.equal(auditFieldValueLabel("external_state", "not_required"), "Не требуется");
  console.log("PASS: calendar dates across five timezones; venue labels; unknown values and field names preserved; Russian payroll labels");
} finally {
  if (originalZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalZone;
  await rm(dir, { recursive: true, force: true });
}
