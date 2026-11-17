import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { randomInt, webcrypto } from "node:crypto";
import ts from "typescript";

// Runs the real casual-worker provisioning with closed dependency boundaries:
// no live database, credentials or HTTP transport enter the VM.
async function harness({ master = false, failAfter = "", provisioning = { first_name: "Кристина", last_name: "Мелконян" } as Record<string, unknown> } = {}) {
  const writes: string[] = [];
  const employees: Record<string, unknown>[] = [{ id: 1, pin: "1234", firstName: "Александр", lastName: "Павлов" }];
  const stores = new Map<number, Record<string, unknown>[]>();
  let fail = failAfter, leased = false;
  const row = {
    id: "casual-qa", account_id: "account-qa", venue_id: "venue-qa", role_id: "role-qa", model_id: "model-qa",
    quickresto_id: null as number | null, quickresto_pin: null as string | null,
    provisioning: structuredClone(provisioning) as Record<string, unknown>,
  };
  const interrupt = (key: string) => { if (fail === key) { fail = ""; throw new Error("Connection lost after remote commit"); } };
  function query(table: string) {
    let update: Record<string, unknown> | undefined;
    const result = () => {
      if (update) {
        assert.equal(table, "payroll_employees");
        if (update.quickresto_provisioning) row.provisioning = structuredClone(update.quickresto_provisioning) as Record<string, unknown>;
        if ("quickresto_id" in update) row.quickresto_id = update.quickresto_id as number;
        if ("quickresto_pin" in update) row.quickresto_pin = update.quickresto_pin as string;
        if (update.quickresto_lease_until === null) leased = false;
        return { data: null, error: null };
      }
      const data: Record<string, unknown> = {
        candidate_employment_settings: { store_ids: [1], master_store_ids: [16], tips_uri: null },
        payroll_models: { quickresto_role_id: 9 }, external_entity_links: null,
        roles: { name: master ? "Кальянный мастер" : "Хостес" },
      };
      assert.ok(table in data, `Unexpected table: ${table}`);
      return { data: structuredClone(data[table]), error: null };
    };
    const builder = {
      select: () => builder, eq: () => builder,
      update: (value: Record<string, unknown>) => { update = value; return builder; },
      single: async () => result(), maybeSingle: async () => result(),
      then: (resolve: (value: unknown) => void) => Promise.resolve(result()).then(resolve),
    };
    return builder;
  }
  const db = {
    from: query,
    rpc: async (fn: string) => {
      assert.equal(fn, "payroll_casual_claim_quickresto");
      if (leased) return { data: null, error: null };
      leased = true;
      return { data: structuredClone(row), error: null };
    },
  };
  const page = (items: unknown[]) => ({ ds: items.map((object) => ({ object })), utilityData: { totalCount: items.length } });
  const client = {
    buildQuickRestoBackOfficeOrigin: () => "https://qa.invalid",
    quickRestoFetch: async (url: string, init: RequestInit, options?: { retryNetwork: boolean }) => {
      const u = new URL(url);
      assert.equal(u.searchParams.get("moduleName"), "personnel.employee", "Only an employee is created");
      assert.equal(options?.retryNetwork, false, "Create must never replay a network failure");
      const steps = row.provisioning.steps as Record<string, { state: string; pin?: string }>;
      assert.equal(steps.employee?.state, "started", "Persist intent before HTTP");
      const body = JSON.parse(String(init.body));
      assert.equal(body.role.id, 9);
      assert.equal(body.firstName, "Кристина");
      assert.equal(body.lastName, "Мелконян");
      assert.match(body.pin, /^\d{4}$/);
      assert.notEqual(body.pin, "1234", "PIN must be free");
      writes.push("employee");
      const created = { ...body, id: 101 };
      employees.push(created);
      interrupt("employee");
      return Response.json({ data: created });
    },
    callQuickRestoBackOfficeData: async ({ path, body, query: q = {} }: { path: string; body?: Record<string, unknown>; query?: Record<string, number> }) => {
      if (path === "personnel.employee/select") return page(employees);
      if (path === "warehouse.store.employee/select") return page(stores.get(q.ownerContextId) ?? []);
      assert.equal(path, "warehouse.store.employee/create", `Forbidden Quick Resto call: ${path}`);
      const key = `store_${q.ownerContextId}`;
      writes.push(key);
      const link = { ...body, id: 400 + q.ownerContextId };
      stores.set(q.ownerContextId, [link]);
      interrupt(key);
      return link;
    },
  };
  const context = vm.createContext({ Buffer, URL, AbortSignal, Error, Response, crypto: webcrypto });
  const modules: Record<string, Record<string, unknown>> = {
    "server-only": {}, "node:crypto": { randomInt },
    "@/lib/supabase/admin": { createAdminClient: () => db }, "@/lib/supabase/loose": { asLooseDb: (value: unknown) => value },
    "@/lib/integrations/crypto": { decryptSecret: () => "qa-only" },
    "@/app/(dashboard)/inventory/actions-shared": { getConnection: async () => ({ login: "qa", password_encrypted: "qa" }), withBackOfficeSession: async ({ run }: { run: (value: string) => unknown }) => run("qa-only") },
    "@/lib/integrations/quickresto/client": client,
  };
  async function load(file: string): Promise<vm.SourceTextModule> {
    const code = ts.transpileModule(await readFile(new URL(file, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    const sourceModule = new vm.SourceTextModule(code, { context });
    await sourceModule.link(async (spec) => {
      if (spec === "../candidates/provision-state") return load("../candidates/provision-state.ts");
      assert.ok(spec in modules, `Forbidden dependency: ${spec}`);
      const exports = modules[spec];
      return new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
    });
    return sourceModule;
  }
  const sourceModule = await load("./casual-quickresto.ts");
  await sourceModule.evaluate();
  const run = () => sourceModule.namespace.provisionCasualQuickResto("casual-qa") as Promise<{ pin: string }>;
  return { run, writes, row, employees };
}

test("casual worker: one Quick Resto employee with a free PIN and the venue warehouse, nothing else", async () => {
  const h = await harness();
  const first = await h.run();
  const second = await h.run();
  assert.deepEqual(h.writes, ["employee", "store_1"]);
  assert.equal(first.pin, second.pin);
  assert.equal(h.row.quickresto_id, 101);
  assert.equal(h.row.quickresto_pin, first.pin);
  assert.equal(h.employees.at(-1)?.pin, first.pin);
});

test("a master also gets the master warehouse", async () => {
  const h = await harness({ master: true });
  await h.run();
  assert.deepEqual(h.writes, ["employee", "store_1", "store_16"]);
});

for (const failAfter of ["employee", "store_1"]) {
  test(`resume after an ambiguous ${failAfter} commit without a duplicate`, async () => {
    const h = await harness({ failAfter });
    await assert.rejects(h.run(), /Connection lost/);
    const { pin } = await h.run();
    await h.run();
    assert.deepEqual(h.writes, ["employee", "store_1"]);
    assert.equal(h.row.quickresto_pin, pin);
  });
}

test("no name: nothing is written to Quick Resto", async () => {
  const h = await harness({ provisioning: {} });
  await assert.rejects(h.run(), /имя и фамилию/);
  assert.deepEqual(h.writes, []);
});
