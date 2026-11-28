import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Подмена `react-icons/<набор>` в next.config.ts действует на любой пакет,
 * не только на BlockNote. Поэтому проверяем всех, кто зависит от
 * react-icons: в хранилище pnpm у такого пакета рядом лежит
 * `node_modules/react-icons`. Значок, которого нет в прослойке, в сборке
 * превратился бы в undefined и уронил бы меню только при открытии.
 */
const PACKS = ["ri", "md", "tb", "ai"] as const;

function findPnpmStore(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const store = join(dir, "node_modules", ".pnpm");
    if (existsSync(store)) return store;
    const parent = dirname(dir);
    if (parent === dir) throw new Error("node_modules/.pnpm не найден");
    dir = parent;
  }
}

/** Каталог «X@версия_…» в хранилище pnpm → имя пакета X. */
function packageName(entry: string): string {
  const at = entry.indexOf("@", entry.startsWith("@") ? 1 : 0);
  return (at === -1 ? entry : entry.slice(0, at)).replace("+", "/");
}

/** Пакеты, которые сами импортируют react-icons (кроме самого react-icons). */
function reactIconsConsumers(): string[] {
  const store = findPnpmStore();
  const roots: string[] = [];
  for (const entry of readdirSync(store)) {
    const modules = join(store, entry, "node_modules");
    if (!existsSync(join(modules, "react-icons"))) continue;
    const name = packageName(entry);
    if (name === "react-icons") continue;
    const root = join(modules, name);
    if (existsSync(root)) roots.push(root);
  }
  return roots;
}

function* esmFiles(dir: string): Generator<string> {
  for (const item of readdirSync(dir)) {
    if (item === "node_modules") continue;
    const path = join(dir, item);
    if (statSync(path).isDirectory()) yield* esmFiles(path);
    else if (item.endsWith(".js") || item.endsWith(".mjs")) yield path;
  }
}

const consumers = reactIconsConsumers();

/** Имена значков, которые пакеты импортируют из react-icons/<pack>. */
function importedNames(pack: string, roots: string[] = consumers): Set<string> {
  const names = new Set<string>();
  const re = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*["']react-icons/${pack}["']`, "g");
  for (const root of roots) {
    for (const file of esmFiles(root)) {
      const src = readFileSync(file, "utf8");
      if (!src.includes(`react-icons/${pack}`)) continue;
      for (const m of src.matchAll(re)) {
        for (const part of m[1].split(",")) {
          const name = part.trim().split(/\s+as\s+/)[0];
          if (name) names.add(name);
        }
      }
    }
  }
  return names;
}

test("bn-icons: среди пользователей react-icons есть BlockNote", () => {
  assert.ok(
    consumers.some((root) => root.endsWith(join("@blocknote", "react"))),
    "BlockNote больше не зависит от react-icons — проверьте, нужна ли подмена",
  );
});

for (const pack of PACKS) {
  test(`bn-icons/${pack}: есть замена каждому значку, который импортирует любой пакет`, async () => {
    const mod = (await import(`./${pack}.ts`)) as Record<string, unknown>;
    const missing = [...importedNames(pack)].filter((n) => typeof mod[n] !== "function");
    assert.deepEqual(missing, []);
  });
}

test("bn-icons: BlockNote по-прежнему берёт значки из react-icons/ri", () => {
  const blocknote = consumers.filter((root) => root.endsWith(join("@blocknote", "react")));
  assert.ok(
    importedNames("ri", blocknote).size >= 50,
    "набор значков BlockNote изменился — проверьте подмену",
  );
});
