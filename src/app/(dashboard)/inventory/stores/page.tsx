import { redirect } from "next/navigation";
import { Warehouse } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { StoresClient } from "./_components/stores-client";
import { InventorySyncButton } from "../_components/inventory-sync-button";

type StoreRow = {
  id: string;
  external_id: string;
  title: string;
  store_code: string | null;
  description: string | null;
  local_venue_id: string | null;
};

type VenueRow = {
  id: string;
  name: string;
};

export default async function InventoryStoresPage() {
  const supabase = await createClient();
  const db = asLooseDb(supabase);

  const [{ data: canView }, { data: canManage }, { data: canSync }, { data: accountId }] = await Promise.all([
    supabase.rpc("has_permission", { permission_code: "inventory.view_stores" }),
    supabase.rpc("has_permission", { permission_code: "inventory.manage_stores" }),
    supabase.rpc("has_permission", { permission_code: "inventory.sync_quickresto" }),
    supabase.rpc("get_active_account_id"),
  ]);
  if (!canView) redirect("/dashboard");
  if (!accountId) redirect("/dashboard");

  const { data: lastSynced } = await db
    .from<Array<{ synced_at: string | null }>>("inventory_stores")
    .select("synced_at")
    .eq("account_id", accountId)
    .order("synced_at", { ascending: false })
    .range(0, 0);
  const lastSyncedAt = lastSynced?.[0]?.synced_at ?? null;

  const [{ data: stores }, { data: venues }] = await Promise.all([
    db
      .from<StoreRow[]>("inventory_stores")
      .select("id, external_id, title, store_code, description, local_venue_id")
      .eq("account_id", accountId)
      .order("title"),
    supabase
      .from("venues")
      .select("id, name")
      .eq("account_id", accountId)
      .order("name"),
  ]);

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
        canManage={Boolean(canManage)}
      />
    </div>
  );
}
