import assert from "node:assert/strict";
import test from "node:test";

import { storeVenueBindingPatch } from "./store-venue-binding.ts";

test("новый склад получает привязку, посчитанную резолвером", () => {
  const patch = storeVenueBindingPatch({ storeExists: false, defaultVenueId: "venue-1" });
  assert.deepEqual(patch, { local_venue_id: "venue-1" });
});

test("новый склад без однозначного заведения — пишем null, дальше решает триггер", () => {
  const patch = storeVenueBindingPatch({ storeExists: false, defaultVenueId: null });
  assert.deepEqual(patch, { local_venue_id: null });
  assert.ok("local_venue_id" in patch, "ключ должен присутствовать, чтобы сработал триггер 215");
});

test("у существующего склада колонки в payload нет вовсе", () => {
  // Ключевая регрессия. Не `{ local_venue_id: null }` и не значение из базы:
  // ключа быть не должно, иначе PostgREST включит колонку в DO UPDATE SET.
  const patch = storeVenueBindingPatch({ storeExists: true, defaultVenueId: "venue-1" });
  assert.deepEqual(patch, {});
  assert.equal("local_venue_id" in patch, false, "колонка не должна попасть в DO UPDATE SET");
});

test("ручное «Не привязан» переживает синхронизацию", () => {
  // Человек снял привязку в /org/stores, резолвер при этом уверенно
  // возвращает заведение. Синк не должен возвращать привязку обратно.
  const patch = storeVenueBindingPatch({ storeExists: true, defaultVenueId: "venue-1" });
  const payload = { account_id: "acc", external_id: "42", title: "Основной", ...patch };
  assert.equal("local_venue_id" in payload, false);
});

test("спред пустого патча не ломает остальной payload", () => {
  const patch = storeVenueBindingPatch({ storeExists: true, defaultVenueId: null });
  const payload = { external_id: "42", ...patch, synced_at: "2026-08-29T00:00:00Z" };
  assert.deepEqual(payload, { external_id: "42", synced_at: "2026-08-29T00:00:00Z" });
});
