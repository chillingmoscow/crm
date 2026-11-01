// Complete-read, source consistency and birthday boundaries. No external writes.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
const dir = await mkdtemp(join(tmpdir(), "guest-reader-"));
try {
  let code = ts
    .transpileModule(await readFile("src/lib/guests/source.ts", "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
      },
    })
    .outputText.replace(
      /from ["']zod["']/g,
      `from ${JSON.stringify(import.meta.resolve("zod"))}`,
    );
  const canonicalCode = ts.transpileModule(
    await readFile("src/lib/source/canonical.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  await writeFile(join(dir, "canonical.mjs"), canonicalCode);
  code = code.replaceAll("@/lib/source/canonical", "./canonical.mjs");
  await writeFile(join(dir, "source.mjs"), code);
  const {
    advanceGuestReader: advance,
    normalizeGuest,
    normalizeGuestGroups,
  } = await import(pathToFileURL(join(dir, "source.mjs")));
  const groups = [
      {
        id: 4,
        name: "Silver",
        discountValue: 4,
        promotable: true,
        minTotalAmount: 50000,
        deleted: false,
      },
    ],
    normalized = normalizeGuestGroups(groups);
  const row = (id) => ({
    object: {
      customer: { id, title: `Гость ${id}` },
      customerGroup: { id: 4, title: "Wrong legacy title" },
      allContactValues: null,
      dayOfBirth: 29,
      monthOfBirth: "month_02",
      yearOfBirth: 2000,
    },
  });
  assert.equal(normalizeGuest(row(1), normalized).discountPercent, 4);
  assert.equal(normalizeGuest(row(1), normalized).groupTitle, "Silver");
  assert.deepEqual(
    normalizeGuest({ ...row(1).object, yearOfBirth: 1999 }, normalized).issues,
    ["Проверьте дату рождения в Quick Resto"],
  );
  assert.equal(
    normalizeGuest(
      {
        ...row(1).object,
        dayOfBirth: null,
        monthOfBirth: null,
        yearOfBirth: 2000,
      },
      normalized,
    ).day,
    null,
  );
  assert.throws(() => normalizeGuest(row(1), []), /отсутствует/);
  assert.throws(
    () => normalizeGuestGroups([...groups, ...groups]),
    /Повторные/,
  );
  let job = { phase: "first", cursor: 0, payload: { first: [], second: [] } },
    seen = [],
    groupCalls = 0;
  const source = {
    groups: async () => {
      groupCalls++;
      return groups;
    },
    guests: async (start) => {
      seen.push(start);
      return {
        ds: Array.from(
          { length: Math.min(500, Math.max(0, 501 - start)) },
          (_, i) => row(start + i + 1),
        ),
      };
    },
  };
  for (let i = 0; i < 8; i++) {
    const r = await advance(job, source);
    if ("publish" in r) {
      assert.equal(r.publish.length, 501);
      assert.deepEqual(r.groups, r.verifiedGroups);
      break;
    }
    job = r;
  }
  assert.deepEqual(seen, [0, 500, 501, 0, 500, 501]);
  assert.equal(groupCalls, 2);
  const empty = {
    groups: async () => groups,
    guests: async () => ({ ds: [] }),
  };
  const a = await advance(
    { phase: "first", cursor: 0, payload: { first: [], second: [] } },
    empty,
  );
  const b = await advance(a, empty);
  assert.deepEqual(b.publish, []);
  assert.deepEqual(b.groups, b.verifiedGroups);
  await assert.rejects(
    () =>
      advance(
        {
          phase: "first",
          cursor: 1,
          payload: {
            first: [normalizeGuest(row(1), normalized)],
            second: [],
            groups: normalized,
          },
        },
        { groups: async () => groups, guests: async () => ({ ds: [row(1)] }) },
      ),
    /повторил/,
  );
  await assert.rejects(
    () =>
      advance(
        {
          phase: "verify",
          cursor: 0,
          payload: { first: [], second: [], groups: normalized },
        },
        {
          groups: async () => [{ ...groups[0], discountValue: 5 }],
          guests: async () => ({ ds: [] }),
        },
      ),
    /изменились/,
  );
  await assert.rejects(
    () =>
      advance(
        {
          phase: "verify",
          cursor: 0,
          payload: {
            first: [normalizeGuest(row(1), normalized)],
            second: [],
            groups: normalized,
          },
        },
        empty,
      ),
    /изменилась/,
  );
  await assert.rejects(
    () =>
      advance(
        { phase: "first", cursor: 0, payload: { first: [], second: [] } },
        { groups: async () => groups, guests: async () => ({ data: [] }) },
      ),
    /страницу/,
  );
  console.log(
    "PASS: complete two-pass pagination, empty base, duplicate pages, changing groups, changed source, authoritative QR discounts, birthday boundaries",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
