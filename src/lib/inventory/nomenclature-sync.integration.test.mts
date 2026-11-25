// Сверка номенклатуры целиком на подменённой базе и подменённом Quick Resto.
// Запуск: node --test --experimental-strip-types --experimental-vm-modules <файл>
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import ts from "typescript";

type Row = Record<string, unknown>;

/** Postgres хранит jsonb со своим порядком ключей — имитируем обратным порядком. */
function reorderKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorderKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Row).reverse().map(([k, v]) => [k, reorderKeys(v)]));
  }
  return value;
}

function fakeDb() {
  const tables: Record<string, Row[]> = { ingredient_groups: [], ingredients: [] };
  const writes: Array<{ table: string; op: "upsert" | "update"; rows: number }> = [];
  let nextId = 1;

  function from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let op: "select" | "upsert" | "update" = "select";
    let payload: unknown;
    let conflict: string[] = [];
    let range: [number, number] | null = null;
    const run = () => {
      const rows = tables[table];
      assert.ok(rows, `Неожиданная таблица: ${table}`);
      if (op === "upsert") {
        const out: Row[] = [];
        for (const input of payload as Row[]) {
          const stored = { ...input, raw_payload: reorderKeys(input.raw_payload) };
          const existing = rows.find((row) => conflict.every((key) => row[key] === input[key]));
          if (existing) Object.assign(existing, stored);
          else rows.push({ id: `id-${nextId++}`, archived_at: null, parent_group_id: null, ...stored });
          out.push(existing ?? rows[rows.length - 1]);
        }
        writes.push({ table, op, rows: out.length });
        return { data: out, error: null };
      }
      const matched = rows.filter((row) => filters.every((f) => f(row)));
      if (op === "update") {
        for (const row of matched) Object.assign(row, payload as Row);
        writes.push({ table, op, rows: matched.length });
        return { data: matched, error: null };
      }
      const sorted = [...matched].sort((a, b) => String(a.id).localeCompare(String(b.id)));
      return { data: range ? sorted.slice(range[0], range[1] + 1) : sorted, error: null };
    };
    const query: Record<string, unknown> = {
      select: () => query,
      eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), query),
      neq: (column: string, value: unknown) => (filters.push((row) => row[column] !== value), query),
      in: (column: string, values: unknown[]) => (filters.push((row) => values.includes(row[column])), query),
      order: () => query,
      range: (a: number, b: number) => ((range = [a, b]), query),
      upsert: (rows: Row[], options: { onConflict: string }) => {
        op = "upsert";
        payload = rows;
        conflict = options.onConflict.split(",");
        return query;
      },
      update: (values: Row) => ((op = "update"), (payload = values), query),
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve().then(run).then(resolve, reject),
    };
    return query;
  }
  return { db: { from }, tables, writes };
}

async function harness() {
  const { db, tables, writes } = fakeDb();
  const snapshots: number[] = [];
  const links: number[] = [];
  const audits: Row[] = [];
  const catalog: Record<string, Row[] | Error> = {
    ingredient: [
      { id: 10, className: "ru.edgex.quickresto.modules.warehouse.nomenclature.singleproduct.SingleCategory", name: "Фрукты" },
      ...Array.from({ length: 12 }, (_, i) => ({
        id: 100 + i,
        className: "ru.edgex.quickresto.modules.warehouse.nomenclature.singleproduct.SingleProduct",
        name: `Позиция ${i}`,
        parentId: 10,
        version: 1,
        measureUnit: { id: 1, className: "x" },
        storeItemTags: [],
        currentPrimeCost: 12.5,
      })),
    ],
    dish: [],
    semi: [],
    modifier: [],
  };
  const tree = (key: string) => async () => {
    const items = catalog[key];
    if (items instanceof Error) throw items;
    return structuredClone(items);
  };

  const normalizeCode = ts.transpileModule(
    await readFile(new URL("../integrations/quickresto/normalize.ts", import.meta.url), "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
  ).outputText;
  const context = vm.createContext({ Error, Map, Set, Promise, console, Date, JSON, Number, Array, Object, String });
  const normalize = new vm.SourceTextModule(normalizeCode, { context });
  await normalize.link(async () => {
    throw new Error("normalize.ts не должен ничего импортировать");
  });
  await normalize.evaluate();
  const n = normalize.namespace as Record<string, unknown>;

  const chunks = <T,>(rows: T[], size = 200) =>
    Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));
  const modules: Record<string, Record<string, unknown>> = {
    "server-only": {},
    "@/lib/audit/write": { writeAuditEvent: async (event: Row) => void audits.push(event) },
    "@/lib/supabase/admin": { createAdminClient: () => db },
    "@/lib/supabase/loose": { asLooseDb: (value: unknown) => value },
    "@/lib/integrations/quickresto/client": {
      listIngredientTreeItems: tree("ingredient"),
      listDishTreeItems: tree("dish"),
      listSemiProductTreeItems: tree("semi"),
      listModifierTreeItems: tree("modifier"),
    },
    "@/app/(dashboard)/inventory/actions-shared": {
      catalogChunks: chunks,
      catalogKey: n.catalogKey,
      connectionPassword: () => "qa-only",
      getConnection: async () => null,
      groupName: n.groupName,
      isQuickRestoClass: n.isQuickRestoClass,
      num: n.num,
      productName: n.productName,
      quickRestoParentExternalId: n.quickRestoParentExternalId,
      text: n.text,
      saveSnapshots: async ({ rows }: { rows: unknown[] }) => void snapshots.push(rows.length),
      upsertExternalLinks: async ({ rows }: { rows: unknown[] }) => void links.push(rows.length),
    },
  };
  const real: Record<string, string> = {
    "@/lib/supabase/fetch-all": "../supabase/fetch-all.ts",
    "@/lib/inventory/nomenclature-diff": "./nomenclature-diff.ts",
  };
  async function load(file: string): Promise<vm.SourceTextModule> {
    const code = ts.transpileModule(await readFile(new URL(file, import.meta.url), "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    const sourceModule = new vm.SourceTextModule(code, { context });
    await sourceModule.link(async (spec) => {
      if (spec in real) return load(real[spec]);
      assert.ok(spec in modules, `Запрещённая зависимость: ${spec}`);
      const exports = modules[spec];
      return new vm.SyntheticModule(
        Object.keys(exports),
        function () {
          for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
        },
        { context },
      );
    });
    return sourceModule;
  }
  const sourceModule = await load("./nomenclature-sync.ts");
  await sourceModule.evaluate();
  const sync = sourceModule.namespace.syncQuickRestoNomenclature as (input: Row) => Promise<{
    totals: Record<string, number>;
    warnings: string[];
  }>;
  const run = () =>
    sync({
      admin: db,
      accountId: "account-qa",
      connection: { id: "connection-qa", login: "qa" },
      trigger: "schedule",
      userId: null,
    });
  const resetLog = () => {
    writes.length = 0;
    snapshots.length = 0;
    links.length = 0;
    audits.length = 0;
  };
  // Состояние подключения пишется в integration_connections — заводим таблицу.
  tables.integration_connections = [{ id: "connection-qa" }];
  return { run, catalog, tables, writes, snapshots, links, audits, resetLog };
}

const catalogWrites = (h: Awaited<ReturnType<typeof harness>>) =>
  h.writes.filter((w) => w.table !== "integration_connections" && w.rows > 0);

test("первый прогон заводит позиции и пишет журнал", async () => {
  const h = await harness();
  const outcome = await h.run();
  assert.equal(outcome.totals.added, 12);
  assert.equal(h.tables.ingredients.length, 12);
  assert.equal(h.audits.length, 1);
  assert.equal(h.audits[0].actionCode, "inventory.nomenclature.synced");
  assert.equal(h.audits[0].userId, null);
  const state = h.tables.integration_connections[0];
  assert.equal((state.nomenclature_sync_result as Row).ok, true);
  assert.ok(state.nomenclature_synced_at);
});

test("повторный прогон без изменений ничего не переписывает", async () => {
  const h = await harness();
  await h.run();
  h.resetLog();
  const outcome = await h.run();
  assert.deepEqual(catalogWrites(h), []);
  assert.deepEqual(h.snapshots.filter(Boolean), []);
  assert.deepEqual(h.links, []);
  assert.equal(h.audits.length, 0, "без изменений журнал не пишется");
  assert.equal(outcome.totals.added + outcome.totals.updated + outcome.totals.archived, 0);
});

test("изменилась одна позиция — переписывается только она", async () => {
  const h = await harness();
  await h.run();
  h.resetLog();
  ((h.catalog.ingredient as Row[])[3] as Row).currentPrimeCost = 99;
  const outcome = await h.run();
  assert.equal(outcome.totals.updated, 1);
  assert.deepEqual(catalogWrites(h), [{ table: "ingredients", op: "upsert", rows: 1 }]);
  assert.deepEqual(h.snapshots.filter(Boolean), [1]);
  assert.equal(h.audits.length, 0, "правка цены — не повод для журнала");
});

test("пустой ответ Quick Resto не отправляет каталог в архив", async () => {
  const h = await harness();
  await h.run();
  h.resetLog();
  h.catalog.ingredient = (h.catalog.ingredient as Row[]).slice(0, 1); // только категория
  const outcome = await h.run();
  assert.equal(outcome.totals.archived, 0);
  assert.ok(h.tables.ingredients.every((row) => row.archived_at === null));
  assert.equal(outcome.warnings.length, 1);
  assert.match(outcome.warnings[0], /пустой список: ингредиенты/);
  assert.deepEqual(
    ((h.tables.integration_connections[0].nomenclature_sync_result as Row).warnings as string[]).length,
    1,
  );
});

test("пропажа большей части позиций не архивирует, обычная чистка — архивирует", async () => {
  const h = await harness();
  await h.run();
  const full = h.catalog.ingredient as Row[];
  h.catalog.ingredient = full.slice(0, 4); // категория + 3 позиции из 12
  const guarded = await h.run();
  assert.equal(guarded.totals.archived, 0);
  assert.match(guarded.warnings[0], /больше половины/);

  h.catalog.ingredient = full.slice(0, 12); // категория + 11 позиций: пропала одна
  h.resetLog();
  const normal = await h.run();
  assert.equal(normal.totals.archived, 1);
  assert.equal(normal.warnings.length, 0);
  assert.equal(h.tables.ingredients.filter((row) => row.archived_at).length, 1);
  assert.equal(h.audits.length, 1);
  assert.equal((h.audits[0].details as Row).archived, 1);
});

test("сбой выгрузки записывается в состояние и пробрасывается", async () => {
  const h = await harness();
  h.catalog.ingredient = new Error("Quick Resto request timed out after 20s");
  await assert.rejects(h.run(), /timed out/);
  const result = h.tables.integration_connections[0].nomenclature_sync_result as Row;
  assert.equal(result.ok, false);
  assert.match(String(result.error), /timed out/);
  assert.equal(h.tables.integration_connections[0].nomenclature_synced_at, undefined);
});
