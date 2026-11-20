import { checked, integrationPageScope, integrationVenues } from "@/lib/integrations/settings";
import { getCachedPermissionChecker } from "@/lib/supabase/server";
import { InventorySyncButton } from "@/app/(dashboard)/inventory/_components/inventory-sync-button";
import { QuickRestoSettings, type QuickRestoConnection } from "./_components/quickresto-settings";

export default async function QuickRestoIntegrationPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [scope, venueOptions, params, can] = await Promise.all([integrationPageScope(), integrationVenues(), searchParams, getCachedPermissionChecker()]);
  const [connectionResult, lastSync] = await Promise.all([
    scope.db.from<QuickRestoConnection & { quickresto_bot_role_external_id: string | null; quickresto_bot_employee_external_id: string | null }>("integration_connections")
      .select("id,login,backoffice_login,quickresto_bot_role_external_id,quickresto_bot_employee_external_id,status,last_tested_at,backoffice_last_tested_at")
      .eq("account_id", scope.accountId).eq("provider", "quickresto").maybeSingle(),
    scope.db.from<{ synced_at: string | null }[]>("ingredients").select("synced_at").eq("account_id", scope.accountId).order("synced_at", { ascending: false }).range(0, 0),
  ]);
  const connection = checked(connectionResult);
  const asId = (v: string | null | undefined) => { const n = v ? Number(v) : NaN; return Number.isFinite(n) ? n : null; };
  const working = connection?.status === "active" && !!connection.last_tested_at;
  return <QuickRestoSettings key={scope.accountId} {...venueOptions} accountId={scope.accountId} editable={scope.owner}
    initialTab={params.tab === "employees" ? "employees" : "connection"}
    connection={connection ? { id: connection.id, login: connection.login, backoffice_login: connection.backoffice_login, status: connection.status,
      last_tested_at: connection.last_tested_at, backoffice_last_tested_at: connection.backoffice_last_tested_at } : null}
    bot={{ role: asId(connection?.quickresto_bot_role_external_id), employee: asId(connection?.quickresto_bot_employee_external_id) }}
    sync={working && can("inventory.sync_quickresto") ? <InventorySyncButton canSync lastSyncedAt={lastSync.data?.[0]?.synced_at ?? null} /> : null} />;
}
