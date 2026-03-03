import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { QuickRestoIntegrationFlow } from "./_components/quickresto-integration-flow";

type IntegrationConnection = {
  id: string;
  login: string;
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

  const { data: account } = await supabase
    .from("accounts")
    .select("id, name")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (!account) {
    return (
      <div className="p-6 md:p-8 w-full">
        <h1 className="text-2xl font-semibold">Quick Resto</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Интеграция доступна только владельцу аккаунта.
        </p>
      </div>
    );
  }

  const connectionResult = (await db
    .from("integration_connections")
    .select("id, login")
    .eq("account_id", account.id)
    .eq("provider", "quickresto")
    .maybeSingle()) as unknown as { data: IntegrationConnection | null };

  const connection = connectionResult.data;

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
          Подключите API и выберите, какие данные импортировать.
        </p>
      </div>

      <QuickRestoIntegrationFlow
        accountId={account.id}
        initialLogin={connection?.login ?? ""}
        initialConnectionId={connection?.id ?? null}
      />
    </div>
  );
}
