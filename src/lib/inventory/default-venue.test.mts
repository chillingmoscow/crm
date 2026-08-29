import assert from "node:assert/strict";
import test from "node:test";

import { resolveDefaultVenueId } from "./default-venue.ts";

type Row = Record<string, unknown>;
type Call = { table: string; filters: string[] };

/**
 * Мини-заглушка supabase-клиента: собирает цепочку .select().eq().in().is()
 * и отдаёт ответ, выбранный по таблице и набору фильтров. Не пытается быть
 * настоящим PostgREST — достаточно различать четыре запроса резолвера.
 */
function fakeDb(reply: (call: Call) => Row[] | Row | null) {
  const from = (table: string) => {
    const filters: string[] = [];
    const answer = () => {
      const data = reply({ table, filters });
      return { data };
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string) => (filters.push(`eq:${column}`), builder),
      in: (column: string) => (filters.push(`in:${column}`), builder),
      is: (column: string) => (filters.push(`is:${column}`), builder),
      maybeSingle: () => Promise.resolve(answer()),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(answer()).then(resolve),
    };
    return builder;
  };
  return { from } as never;
}

function db(input: {
  links?: Array<{ local_id: string | null }>;
  liveLinked?: Array<{ id: string }>;
  activeVenue?: { id: string } | null;
  liveVenues?: Array<{ id: string }>;
}) {
  return fakeDb(({ table, filters }) => {
    if (table === "external_entity_links") return input.links ?? [];
    if (filters.includes("in:id")) return input.liveLinked ?? [];
    if (filters.includes("eq:id")) return input.activeVenue ?? null;
    return input.liveVenues ?? [];
  });
}

const ARGS = { accountId: "acc-1", activeVenueId: null };

test("одна живая QR-ссылка — по ней и привязываем", async () => {
  const venueId = await resolveDefaultVenueId({
    admin: db({ links: [{ local_id: "venue-qr" }], liveLinked: [{ id: "venue-qr" }] }),
    ...ARGS,
  });
  assert.equal(venueId, "venue-qr");
});

test("две живые QR-ссылки — шаг пропускаем, не гадаем", async () => {
  // Ключевая регрессия. unique-констрейнт стоит на external_id, поэтому
  // ссылок столько же, сколько импортировано заведений, а порядок в запросе
  // не задан. Взять первую — значит на повторном прогоне увести склад в
  // другую точку и утащить за собой видимость актов.
  const venueId = await resolveDefaultVenueId({
    admin: db({
      links: [{ local_id: "venue-a" }, { local_id: "venue-b" }],
      liveLinked: [{ id: "venue-a" }, { id: "venue-b" }],
      activeVenue: { id: "venue-active" },
      liveVenues: [{ id: "venue-a" }, { id: "venue-b" }],
    }),
    accountId: "acc-1",
    activeVenueId: "venue-active",
  });
  assert.equal(venueId, "venue-active", "должны уйти на активное заведение, а не выбрать наугад");
});

test("две ссылки, но живая одна — выбор однозначен", async () => {
  const venueId = await resolveDefaultVenueId({
    admin: db({
      links: [{ local_id: "venue-live" }, { local_id: "venue-archived" }],
      liveLinked: [{ id: "venue-live" }],
    }),
    ...ARGS,
  });
  assert.equal(venueId, "venue-live");
});

test("ссылка-сирота (заведение удалено) — идём на запасные шаги", async () => {
  const venueId = await resolveDefaultVenueId({
    admin: db({ links: [{ local_id: "gone" }], liveLinked: [], liveVenues: [{ id: "venue-only" }] }),
    ...ARGS,
  });
  assert.equal(venueId, "venue-only");
});

test("без ссылок и без активного — единственное живое заведение", async () => {
  const venueId = await resolveDefaultVenueId({
    admin: db({ liveVenues: [{ id: "venue-only" }] }),
    ...ARGS,
  });
  assert.equal(venueId, "venue-only");
});

test("два живых заведения и ничего однозначного — null, а не догадка", async () => {
  const venueId = await resolveDefaultVenueId({
    admin: db({ liveVenues: [{ id: "venue-a" }, { id: "venue-b" }] }),
    ...ARGS,
  });
  assert.equal(venueId, null);
});

test("аккаунт без заведений вовсе — null", async () => {
  // Режим QuickResto в визарде создаёт аккаунт через createAccountOnly, то
  // есть без единого заведения. Пока цикл импорта venue не отработал,
  // привязывать склад не к чему.
  const venueId = await resolveDefaultVenueId({ admin: db({}), ...ARGS });
  assert.equal(venueId, null);
});
