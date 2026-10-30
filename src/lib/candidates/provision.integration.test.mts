import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createHash, randomInt, webcrypto } from 'node:crypto';
import ts from 'typescript';

// Execute the actual orchestrator with closed dependency boundaries. No live
// environment, credentials, database client or HTTP transport enter this VM.
async function harness({ master = false, reuse = false, failAfter = '' } = {}) {
  const writes: string[] = [];
  const employees: Record<string, unknown>[] = [];
  const guests: Record<string, unknown>[] = reuse ? [{ id: 201, firstName: 'QA', lastName: 'Test', tokens: [{ key: '+79990000000' }], customerGroup: { id: 5 } }] : [];
  const contacts: Record<string, unknown>[] = reuse ? [{ id: 501, type: 'phoneNumber', value: '+79990000000' }] : [];
  const stores = new Map<number, Record<string, unknown>[]>();
  const bonuses: Record<string, unknown>[] = reuse ? [{ id: 301, accountType: { id: 1 } }] : [];
  let door = false, user = false, claimed = false, fail = failAfter, finishes = 0;
  const hire = {
    id: 'hire-qa', account_id: 'account-qa', candidate_id: 'candidate-qa', target_user_id: 'user-qa', existing_user: false, actor_id: 'actor-qa', state: 'reserved',
    input: { venue_id: 'venue-qa', role_id: 'role-qa', first_name: 'QA', last_name: 'Test', employment_date: '2026-10-30', attendance_source: 'quickresto' },
    provisioning: {} as Record<string, {state: string; id?: number; pin?: string}>,
  };
  function interrupt(key: string) { if (fail === key) { fail = ''; throw new Error('Connection lost after remote commit'); } }
  function query(table: string) {
    let update: Record<string, unknown> | undefined;
    const result = () => {
      if (update) {
        assert.equal(table, 'candidate_hires');
        if (update.provisioning) hire.provisioning = structuredClone(update.provisioning) as typeof hire.provisioning;
        if (update.lease_until === null) claimed = false;
        return { data: null, error: null };
      }
      const data: Record<string, unknown> = {
        candidate_hires: hire,
        candidate_employment_settings: { store_ids: [1], master_store_ids: [16], staff_group_id: 8, bonus_account_type_id: 1, office_pool_initialized: true, tips_uri: "https://tips.example.invalid/qa" },
        payroll_models: { quickresto_role_id: 9 }, external_entity_links: null,
        candidates: { phone: '+7 (999) 000-00-00' }, roles: { name: master ? 'Кальянный мастер' : 'Бармен' },
        staff_door_codes: door ? { id: 'door-qa' } : null,
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
      if (fn === 'candidate_claim_hire') {
        if (hire.state === 'complete' || claimed) return { data: null, error: null };
        claimed = true; return { data: structuredClone(hire), error: null };
      }
      if (fn === 'candidate_reserve_door') { if (!door) writes.push('door'); door = true; return { data: 'door-qa', error: null }; }
      assert.equal(fn, 'candidate_finish_hire');
      for (const key of ['employee', 'guest', 'bonus']) assert.equal(hire.provisioning[key]?.state, 'done');
      assert.ok(door && user);
      assert.equal(hire.provisioning.employee.pin, employees[0].pin);
      finishes++; hire.state = 'complete'; return { data: 'user-qa', error: null };
    },
    auth: { admin: {
      getUserById: async () => ({ data: { user: user ? { id: 'user-qa' } : null } }),
      createUser: async (input: { id: string }) => { writes.push('auth'); user = true; return { data: { user: { id: input.id } }, error: null }; },
    } },
  };
  const page = (items: unknown[]) => ({ ds: items.map(object => ({ object })), utilityData: { totalCount: items.length } });
  const client = {
    buildQuickRestoBackOfficeOrigin: () => 'https://qa.invalid',
    quickRestoFetch: async (url: string, init: RequestInit, options?: {retryNetwork: boolean}) => {
      const u = new URL(url);
      if (init.method === 'GET') {
        assert.equal((init.headers as Record<string,string>)['Content-Type'], 'application/json', 'Public QR read requires JSON content type');
        return Response.json({...guests.find(g => g.id === Number(u.searchParams.get('objectId'))), contactMethods: contacts});
      }
      assert.equal(options?.retryNetwork, false, 'Create must never replay a network failure');
      const body = JSON.parse(String(init.body));
      const key = u.searchParams.get('moduleName') === 'personnel.employee' ? 'employee' : 'guest';
      assert.equal(hire.provisioning[key]?.state, 'started', 'Persist intent before HTTP');
      writes.push(key);
      if (key === 'employee') {
        assert.equal(body.role.id, 9);
        assert.equal(body.tipsUri, "https://tips.example.invalid/qa");
        assert.match(body.pin, /^\d{4}$/);
        assert.equal(body.pin, hire.provisioning.employee.pin);
        employees.push({ ...body, id: 101 });
      } else {
        guests.push({ ...body, id: 201 });
      }
      interrupt(key);
      return Response.json({ data: key === 'employee' ? employees[0] : guests[0] });
    },
    callQuickRestoBackOfficeData: async ({path, body, query: q = {}}: {path: string; body?: Record<string, unknown>; query?: Record<string, number>}) => {
      if (path === 'personnel.employee/select') return page(employees);
      if (path === 'crm.customer/select') return page(guests);
      if (path === 'crm.customer.contacts/select') return page(contacts);
      if (path === 'crm.customer.contacts/create') { writes.push('guest_phone'); assert.equal(body?.type, 'phoneNumber'); assert.equal(body?.value, '+79990000000'); const row={...body,id:501}; contacts.push(row); interrupt('guest_phone'); return row; }
      if (path === 'warehouse.store.employee/select') return page(stores.get(q.ownerContextId) ?? []);
      if (path === 'crm.accounting.account/select') return page(bonuses);
      if (path === 'warehouse.store.employee/create') {
        const key = `store_${q.ownerContextId}`;
        writes.push(key); const row = { ...body, id: 400 + q.ownerContextId };
        stores.set(q.ownerContextId, [row]); interrupt(key); return row;
      }
      if (path === 'crm.customer/update') { writes.push('guest_group'); guests[0] = body!; return body; }
      assert.equal(path, 'crm.accounting.account/create');
      writes.push('bonus'); const row = { ...body, id: 301 }; bonuses.push(row); interrupt('bonus'); return row;
    },
  };
  const context = vm.createContext({ Buffer, URL, AbortSignal, Error, crypto: webcrypto });
  const modules: Record<string, Record<string, unknown>> = {
    'server-only': {}, 'node:crypto': { createHash, randomInt },
    '@/lib/supabase/admin': { createAdminClient: () => db }, '@/lib/supabase/loose': { asLooseDb: (value: unknown) => value },
    '@/lib/integrations/crypto': { encryptSecret: () => ({ encrypted: 'qa-only', iv: 'qa-only', tag: 'qa-only' }), decryptSecret: () => 'qa-only' },
    '@/app/(dashboard)/inventory/actions-shared': { getConnection: async () => ({ login: 'qa', password_encrypted: 'qa' }), withBackOfficeSession: async ({run}: {run: (value: string) => unknown}) => run('qa-only') },
    '@/lib/integrations/quickresto/client': client,
    './schema': { normalizePhone: (value: string) => value.replace(/\D/g, '') },
  };
  async function load(file: string): Promise<vm.SourceTextModule> {
    const code = ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    const sourceModule = new vm.SourceTextModule(code, { context });
    await sourceModule.link(async spec => {
      if (spec === './provision-state') return load('./provision-state.ts');
      assert.ok(spec in modules, `Forbidden dependency: ${spec}`);
      const exports = modules[spec];
      return new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
    });
    return sourceModule;
  }
  const sourceModule = await load('./provision.ts'); await sourceModule.evaluate();
  const run = () => sourceModule.namespace.provisionCandidateHire('hire-qa') as Promise<void>;
  return { run, writes, hire, get finishes() { return finishes; } };
}

test('new bartender: QR employee, warehouse, guest, bonus, door, auth, finish exactly once', async () => {
  const h = await harness(); await h.run(); await h.run();
  assert.deepEqual(h.writes, ['employee', 'store_1', 'guest', 'guest_phone', 'bonus', 'door', 'auth']);
  assert.equal(h.finishes, 1);
});
test('master receives both configured warehouses', async () => {
  const h = await harness({ master: true }); await h.run();
  assert.deepEqual(h.writes.filter(key => key.startsWith('store')), ['store_1', 'store_16']);
});
test('existing guest/bonus are reused and Staff group is repaired', async () => {
  const h = await harness({ reuse: true }); await h.run();
  assert.ok(!h.writes.includes('guest') && !h.writes.includes('bonus'));
  assert.ok(h.writes.includes('guest_group'));
});
for (const failAfter of ['employee', 'store_1', 'guest_phone', 'bonus']) {
  test(`resume after ambiguous ${failAfter} commit without duplicate creation`, async () => {
    const h = await harness({ failAfter });
    await assert.rejects(h.run(), /Connection lost/);
    assert.equal(h.finishes, 0);
    await h.run(); await h.run();
    for (const key of ['employee', 'store_1', 'guest', 'guest_phone', 'bonus', 'door', 'auth']) assert.equal(h.writes.filter(item => item === key).length, 1, key);
    assert.equal(h.finishes, 1);
  });
}

test('ambiguous guest creation without a confirmed phone stops instead of matching only by name', async () => {
 const h=await harness({failAfter:'guest'}); await assert.rejects(h.run(),/Connection lost/);
 await assert.rejects(h.run(),/не подтверждён/);
 assert.equal(h.writes.filter(key=>key==='guest').length,1);assert.equal(h.finishes,0);
});
