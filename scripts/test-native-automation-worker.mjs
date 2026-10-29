// Integration check against a running LOCAL Supabase. Only comparison jobs/runs are created.
// node --env-file=.env.local scripts/test-native-automation-worker.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import ts from "typescript";

const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
  "Local Supabase is required",
);
assert.equal(url.protocol, "http:", "Local HTTP Supabase is required");
assert.ok(
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  "Local service role is required",
);
const db = createClient(url.href, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
async function financialHash() {
  const hash = createHash("sha256");
  for (const table of [
    "transactions",
    "payroll_accruals",
    "payroll_adjustments",
    "payroll_payments",
    "payroll_transfers",
  ]) {
    hash.update(table);
    for (let offset = 0; ; offset += 1000) {
      const result = await db
        .from(table)
        .select("*")
        .order("id")
        .range(offset, offset + 999);
      if (result.error) throw new Error(`Cannot read local ${table}`);
      hash.update(JSON.stringify(result.data));
      if (result.data.length < 1000) break;
    }
  }
  return hash.digest("hex");
}
const before = await financialHash();
const dir = await mkdtemp(join(tmpdir(), "automation-worker-"));
try {
  await symlink(resolve("node_modules"), join(dir, "node_modules"));
  const modules = {
    worker: "src/lib/automations/worker.ts",
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
      .replace('import "server-only";', "")
      .replaceAll("@/lib/supabase/admin", "./admin.mjs")
      .replaceAll("@/lib/supabase/loose", "./loose.mjs")
      .replaceAll("@/lib/sales/time", "./time.mjs")
      .replaceAll("@/lib/payroll/automation-settings", "./settings.mjs")
      .replaceAll('"./state"', '"./state.mjs"')
      .replaceAll('"./payroll-rules"', '"./payroll-rules.mjs"');
    source = source.replace(
      /import defaults from [^;]+;/,
      "const defaults = " +
        (await readFile("src/lib/payroll/automation-defaults.json", "utf8")) +
        ";",
    );
    await writeFile(join(dir, name + ".mjs"), source);
  }
  await writeFile(
    join(dir, "admin.mjs"),
    `import {createClient} from "@supabase/supabase-js";
export const createAdminClient=()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});`,
  );
  await writeFile(join(dir, "loose.mjs"), "export const asLooseDb=x=>x;");
  const worker = await import(pathToFileURL(join(dir, "worker.mjs")).href);
  const started = new Date().toISOString();
  await worker.scheduleAutomationComparisons();
  let processed = 0;
  for (; processed < 100; processed++) {
    const result = await worker.processAutomationComparison();
    assert.ok(!result.error, "Comparison worker returned an error");
    assert.ok(!result.superseded, "Unchanged HTTP snapshot was marked stale");
    if (result.idle) break;
  }
  assert.ok(processed < 100, "Local comparison queue did not finish");
  const runs = await db
    .from("payroll_automation_runs")
    .select("mode,applied_count")
    .gte("created_at", started);
  assert.ifError(runs.error);
  assert.ok(
    runs.data.every((r) => r.mode === "comparison" && r.applied_count === 0),
  );
  const done = await db
    .from("payroll_automation_jobs")
    .select("run_id", { count: "exact", head: true })
    .eq("state", "done");
  assert.ifError(done.error);
  assert.ok(
    done.count > 0,
    "No comparison job has completed; save local settings first",
  );
  await worker.scheduleAutomationComparisons();
  assert.equal(
    (await worker.processAutomationComparison()).idle,
    true,
    "Unchanged sources scheduled a duplicate",
  );
  assert.equal(
    await financialHash(),
    before,
    "Comparison changed financial history",
  );
  console.log(
    `PASS: real local worker, ${processed} jobs, ${runs.data.length} comparison runs, repeat deduplication, unchanged financial history`,
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
