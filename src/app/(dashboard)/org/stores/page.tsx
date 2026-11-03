import { redirect } from "next/navigation";
import { Warehouse } from "lucide-react";

import {
  createClient,
  getCachedActiveAccountId,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { StoresClient } from "./_components/stores-client";
import { InventorySyncButton } from "@/app/(dashboard)/inventory/_components/inventory-sync-button";

type StoreRow = {
  id: string;
  external_id: string;
  title: string;
  store_code: string | null;
  description: string | null;
  local_venue_id: string | null;
  department_id: string | null;
  department_scope: "unset" | "shared" | "department";
};

type DepartmentRow = {
  id: string;
  name: string;
  venue_id: string;
  archived_at: string | null;
};

type VenueRow = {
  id: string;
  name: string;
  archived_at: string | null;
};

export default async function InventoryStoresPage() {
  const supabase = await createClient();
  const db = asLooseDb(supabase);

  const [can, accountId] = await Promise.all([
    getCachedPermissionChecker(),
    getCachedActiveAccountId(),
  ]);
  const canView = can("inventory.view_stores");
  const canManage = can("inventory.manage_stores");
  const canSync = can("inventory.sync_quickresto");
  if (!canView) redirect("/dashboard");
  if (!accountId) redirect("/dashboard");

  const { data: lastSynced } = await db
    .from<Array<{ synced_at: string | null }>>("stores")
    .select("synced_at")
    .eq("account_id", accountId)
    .order("synced_at", { ascending: false })
    .range(0, 0);
  const lastSyncedAt = lastSynced?.[0]?.synced_at ?? null;

  const [{ data: stores }, { data: venues }] = await Promise.all([
    db
      .from<StoreRow[]>("stores")
      .select("id, external_id, title, store_code, description, local_venue_id, department_id, department_scope")
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
  ]);

  // Подразделения читаем service-role'ом: политика departments требует
  // people.view_roles, а управляющий складами этого права может не иметь — тогда
  // привязанное подразделение пропало бы из списка и склад выглядел бы «общим».
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
    <div className="w-full px-4 py-4 md:px-8 md:py-6">
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
            <Warehouse className="h-5 w-5" />
          </div>
          <h1 className="text-2xl font-semibold">Склады</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Склады Quick Resto хранятся отдельно от заведений; привязка нужна только для локального контекста.
          </p>
        </div>
        <InventorySyncButton canSync={Boolean(canSync)} lastSyncedAt={lastSyncedAt} />
      </div>

      <StoresClient
        stores={stores ?? []}
        venues={(venues ?? []) as VenueRow[]}
        departments={departments ?? []}
        canManage={Boolean(canManage)}
      />
    </div>
  );
}
