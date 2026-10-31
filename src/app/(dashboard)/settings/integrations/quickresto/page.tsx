import { redirect } from "next/navigation";
import { integrationPageScope, integrationVenues } from "@/lib/integrations/settings";
import { QuickRestoSettings } from "./_components/quickresto-settings";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createClient,
  getCachedActiveAccountId,
  getCachedPermissionChecker,
} from "@/lib/supabase/server";
import { QuickRestoIntegrationFlow } from "./_components/quickresto-integration-flow";
import { NomenclatureProbeButton } from "./_components/nomenclature-probe-button";
import { InventorySyncButton } from "@/app/(dashboard)/inventory/_components/inventory-sync-button";

type IntegrationConnection = {
  id: string;
  login: string;
  backoffice_login: string | null;
  quickresto_bot_role_external_id: string | null;
  quickresto_bot_employee_external_id: string | null;
  status: string | null;
  last_tested_at: string | null;
};

export default async function QuickRestoIntegrationPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [scope, venueOptions, params] = await Promise.all([integrationPageScope(), integrationVenues(), searchParams]);
  const supabase = await createClient();
  type LooseQueryBuilder = {
    select: (columns: string) => LooseQueryBuilder;
    eq: (column: string, value: unknown) => LooseQueryBuilder;
    maybeSingle: () => Promise<{ data: unknown }>;
  };
  const db = supabase as unknown as { from: (table: string) => LooseQueryBuilder };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [accountId, can] = await Promise.all([
    getCachedActiveAccountId(),
    getCachedPermissionChecker(),
  ]);
  const allowed = can("settings.manage_integrations");

  if (!accountId || !allowed) redirect("/dashboard");

  const admin = createAdminClient();
  const { data: account } = await admin
    .from("accounts")
    .select("id, name")
    .eq("id", accountId)
    .maybeSingle();

  if (!account) {
    return (
      <div className="p-6 md:p-8 w-full">
        <h1 className="text-2xl font-semibold">Quick Resto</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Аккаунт не найден
        </p>
      </div>
    );
  }

  const connectionResult = (await db
    .from("integration_connections")
    .select("id, login, backoffice_login, quickresto_bot_role_external_id, quickresto_bot_employee_external_id,status,last_tested_at")
    .eq("account_id", account.id)
    .eq("provider", "quickresto")
    .maybeSingle()) as unknown as { data: IntegrationConnection | null };

  const connection = connectionResult.data;
  const lastSync = await scope.db.from<{ synced_at: string | null }[]>("ingredients").select("synced_at").eq("account_id", account.id).order("synced_at", { ascending: false }).range(0, 0);
  const botRoleExternalId = connection?.quickresto_bot_role_external_id
    ? Number(connection.quickresto_bot_role_external_id)
    : null;
  const botEmployeeExternalId = connection?.quickresto_bot_employee_external_id
    ? Number(connection.quickresto_bot_employee_external_id)
    : null;

  return (
    <QuickRestoSettings key={scope.accountId} {...venueOptions} editable={scope.owner} initialTab={params.tab === "employees" ? "employees" : "connection"} connection={<>
      {connection?.status === "active" && connection.last_tested_at && can("inventory.sync_quickresto") ? <InventorySyncButton canSync lastSyncedAt={lastSync.data?.[0]?.synced_at ?? null} /> : null}
      <QuickRestoIntegrationFlow
        accountId={account.id}
        initialLogin={connection?.login ?? ""}
        initialConnectionId={connection?.id ?? null}
        initialBackOfficeLogin={connection?.backoffice_login ?? ""}
        initialBotRoleExternalId={Number.isFinite(botRoleExternalId) ? botRoleExternalId : null}
        initialBotEmployeeExternalId={Number.isFinite(botEmployeeExternalId) ? botEmployeeExternalId : null}
      />

      {connection ? <NomenclatureProbeButton /> : null}
    </>} />
  );
}
