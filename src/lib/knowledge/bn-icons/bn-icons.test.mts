import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const dist = dirname(require.resolve("@blocknote/react"));

/** Имена значков, которые BlockNote импортирует из react-icons/<pack>. */
function importedNames(pack: string): Set<string> {
  const names = new Set<string>();
  const re = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*"react-icons/${pack}"`, "g");
  for (const file of readdirSync(dist)) {
    if (!file.endsWith(".js")) continue;
    const src = readFileSync(join(dist, file), "utf8");
    for (const m of src.matchAll(re)) {
      for (const part of m[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/)[0];
        if (name) names.add(name);
      }
    }
  }
  return names;
}

for (const pack of ["ri", "md", "tb", "ai"]) {
  test(`bn-icons/${pack}: есть замена каждому значку, который импортирует BlockNote`, async () => {
    const mod = (await import(`./${pack}.ts`)) as Record<string, unknown>;
    const missing = [...importedNames(pack)].filter((n) => typeof mod[n] !== "function");
    assert.deepEqual(missing, []);
  });
}

test("bn-icons: BlockNote по-прежнему берёт значки из react-icons/ri", () => {
  assert.ok(importedNames("ri").size >= 50, "набор значков BlockNote изменился — проверьте подмену");
});
