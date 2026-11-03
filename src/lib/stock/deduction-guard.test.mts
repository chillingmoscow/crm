import { test } from "node:test";
import assert from "node:assert/strict";
import { assertVenueInAccount, venueBelongsToAccount, VENUE_OUTSIDE_ACCOUNT } from "./deduction-guard.ts";
import type { LooseDb } from "../supabase/loose.ts";

const MINE = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER = "bbbbbbbb-0000-4000-8000-000000000002";
const V_MINE = "dddddddd-0000-4000-8000-000000000001";
const V_FOREIGN = "dddddddd-0000-4000-8000-000000000002";

/** Заведения: V_MINE принадлежит MINE, V_FOREIGN - OTHER. Серверный клиент фильтры уважает, RLS нет. */
function fakeDb(opts: { ignoreAccountFilter?: boolean; error?: boolean } = {}): LooseDb {
  const rows = [
    { id: V_MINE, account_id: MINE },
    { id: V_FOREIGN, account_id: OTHER },
  ];
  return {
    from: () => {
      const f: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => {
          f[c] = v;
          return q;
        },
        maybeSingle: async () => {
          if (opts.error) return { data: null, error: { message: "boom" } };
          const hit = rows.find(
            (r) => r.id === f.id && (opts.ignoreAccountFilter || r.account_id === f.account_id),
          );
          return { data: hit ?? null, error: null };
        },
      };
      return q;
    },
  } as unknown as LooseDb;
}

test("своё заведение проходит", async () => {
  assert.equal(await venueBelongsToAccount(fakeDb(), MINE, V_MINE), true);
  await assertVenueInAccount(fakeDb(), MINE, V_MINE);
});

test("заведение чужого аккаунта в паре со своим аккаунтом сессии - отказ с явным сообщением", async () => {
  assert.equal(await venueBelongsToAccount(fakeDb(), MINE, V_FOREIGN), false);
  await assert.rejects(assertVenueInAccount(fakeDb(), MINE, V_FOREIGN), new RegExp(VENUE_OUTSIDE_ACCOUNT));
});

test("несуществующее заведение - отказ", async () => {
  await assert.rejects(assertVenueInAccount(fakeDb(), MINE, "dddddddd-0000-4000-8000-0000000000ff"), /не относится/);
});

test("ошибка чтения - отказ, а не разрешение", async () => {
  assert.equal(await venueBelongsToAccount(fakeDb({ error: true }), MINE, V_MINE), false);
});

test("ответ сверяется сам, а не только фильтр запроса", async () => {
  // Если фильтр по аккаунту потерялся (клиент без RLS), чужая строка всё равно отклоняется.
  assert.equal(await venueBelongsToAccount(fakeDb({ ignoreAccountFilter: true }), MINE, V_FOREIGN), false);
});
