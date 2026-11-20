import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  createClient,
  getCachedActiveAccountId,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import {
  StoresClient,
  type DepartmentRow,
  type StoreActStats,
  type StoreRow,
  type VenueRow,
} from "./_components/stores-client";

export const metadata: Metadata = { title: "Склады" };

export default async function InventoryStoresPage() {
  const supabase = await createClient();
  const db = asLooseDb(supabase);

  const [can, accountId] = await Promise.all([
    getCachedPermissionChecker(),
    getCachedActiveAccountId(),
  ]);
  if (!can("inventory.view_stores")) redirect("/dashboard");
  if (!accountId) redirect("/dashboard");

  const [{ data: stores }, { data: venues }, statsResult] = await Promise.all([
    db
      .from<StoreRow[]>("stores")
      // archived_at — миграция 365, в сгенерированных типах её ещё нет.
      .select("id, title, store_code, description, local_venue_id, department_id, department_scope, synced_at, archived_at")
      .eq("account_id", accountId)
      .order("title"),
    supabase
      .from("venues")
      // archived_at нужен клиенту: архивные заведения не предлагаем к выбору,
      // но показываем то, к которому склад уже привязан, — иначе список
      // молча показал бы «Не привязан» там, где привязка есть.
      .select("id, name, archived_at")
      .eq("account_id", accountId)
      .order("name"),
    // Число актов и дата последнего по складу — столбец «Последний акт».
    db.rpc("store_act_stats"),
  ]);
  // Без статистики страница работает: столбец покажет прочерки.
  if (statsResult.error) console.error("[stores] act stats failed", statsResult.error);
  const actStats = (statsResult.data ?? []) as Array<{
    store_id: string;
    acts_count: number | string;
    last_act_at: string | null;
  }>;
  const statsByStore: Record<string, StoreActStats> = {};
  for (const row of actStats) {
    statsByStore[row.store_id] = { count: Number(row.acts_count), lastActAt: row.last_act_at };
  }
  // Последняя синхронизация — из того же списка, отдельный запрос не нужен:
  // полная синхронизация проставляет synced_at всем складам аккаунта.
  const lastSyncedAt =
    (stores ?? []).reduce<string | null>(
      (latest, store) => (store.synced_at && (!latest || store.synced_at > latest) ? store.synced_at : latest),
      null,
    );

  // Подразделения читаем service-role'ом НАМЕРЕННО, не «чините» на обычный клиент:
  // политика departments требует people.view_roles, а управляющий складами этого
  // права может не иметь — тогда привязанное подразделение пропало бы из списка и
  // склад выглядел бы «не задано»/«общим». Раскрываются названия подразделений
  // ВСЕХ заведений своего аккаунта каждому, кто прошёл проверку
  // inventory.view_stores выше (не только управляющим складами) — только имена и
  // id, ничего чувствительнее.
  // Тенантность — через заведения аккаунта (у departments нет account_id).
  const admin = asLooseDb(createAdminClient());
  const { data: accountVenues } = await admin
    .from<Array<{ id: string }>>("venues")
    .select("id")
    .eq("account_id", accountId);
  const venueIds = (accountVenues ?? []).map((venue) => venue.id);
  const { data: departments } = venueIds.length
    ? await admin
        .from<DepartmentRow[]>("departments")
        .select("id, name, venue_id, archived_at")
        .in("venue_id", venueIds)
        .order("name")
    : { data: [] as DepartmentRow[] };

  return (
    <StoresClient
      stores={stores ?? []}
      venues={(venues ?? []) as VenueRow[]}
      departments={departments ?? []}
      actStats={statsByStore}
      lastSyncedAt={lastSyncedAt}
      canManage={can("inventory.manage_stores")}
      canSync={can("inventory.sync_quickresto")}
      canViewDocuments={can("inventory.view_documents")}
      canViewHistory={can("inventory.view_results")}
    />
  );
}
