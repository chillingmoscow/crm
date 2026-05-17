import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { QuickRestoIntegrationFlow } from "./_components/quickresto-integration-flow";

type IntegrationConnection = {
  id: string;
  login: string;
  backoffice_login: string | null;
  quickresto_bot_role_external_id: string | null;
  quickresto_bot_employee_external_id: string | null;
};

export default async function QuickRestoIntegrationPage() {
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

  const [{ data: accountId }, { data: allowed }] = await Promise.all([
    supabase.rpc("get_active_account_id"),
    supabase.rpc("has_permission", { permission_code: "settings.manage_integrations" }),
  ]);

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
    .select("id, login, backoffice_login, quickresto_bot_role_external_id, quickresto_bot_employee_external_id")
    .eq("account_id", account.id)
    .eq("provider", "quickresto")
    .maybeSingle()) as unknown as { data: IntegrationConnection | null };

  const connection = connectionResult.data;
  const botRoleExternalId = connection?.quickresto_bot_role_external_id
    ? Number(connection.quickresto_bot_role_external_id)
    : null;
  const botEmployeeExternalId = connection?.quickresto_bot_employee_external_id
    ? Number(connection.quickresto_bot_employee_external_id)
    : null;

  return (
    <div className="p-6 md:p-8 w-full">
      <div className="mb-6">
        <Link
          href="/settings/integrations"
          className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2"
        >
          К списку интеграций
        </Link>
        <h1 className="text-2xl font-semibold mt-2">Quick Resto</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Подключите API, сервисного back-office пользователя и выберите, какие данные импортировать.
        </p>
      </div>

      <QuickRestoIntegrationFlow
        accountId={account.id}
        initialLogin={connection?.login ?? ""}
        initialConnectionId={connection?.id ?? null}
        initialBackOfficeLogin={connection?.backoffice_login ?? ""}
        initialBotRoleExternalId={Number.isFinite(botRoleExternalId) ? botRoleExternalId : null}
        initialBotEmployeeExternalId={Number.isFinite(botEmployeeExternalId) ? botEmployeeExternalId : null}
      />
    </div>
  );
}
