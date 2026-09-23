import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import {
  getCachedActiveAccountId,
  getCachedPermissionChecker,
  getCachedUser,
} from "@/lib/supabase/server";
import {
  QuickRestoConnectionCard,
  type QuickRestoConnectionView,
} from "./_components/quickresto-connection-card";

type ConnectionRow = {
  login: string | null;
  status: string | null;
  last_tested_at: string | null;
  backoffice_login: string | null;
  backoffice_cookie_fetched_at: string | null;
  backoffice_last_tested_at: string | null;
};

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ quickresto?: string }>;
}) {
  const params = await searchParams;
  const [user, accountId, can] = await Promise.all([
    getCachedUser(),
    getCachedActiveAccountId(),
    getCachedPermissionChecker(),
  ]);

  if (!user) redirect("/login");
  if (!accountId || !can("settings.manage_integrations")) redirect("/dashboard");

  const admin = asLooseDb(createAdminClient());

  // Подключение и время последней синхронизации читаем вместе: до этого
  // страница не знала о подключении вовсе и всегда предлагала «Запустить
  // интеграцию», даже когда синхронизация давно работала (#368).
  const [{ data: account }, { data: connection }, { data: lastSynced }] = await Promise.all([
    admin
      .from<{ id: string; name: string }>("accounts")
      .select("id, name")
      .eq("id", accountId)
      .maybeSingle(),
    admin
      .from<ConnectionRow>("integration_connections")
      .select(
        "login, status, last_tested_at, backoffice_login, backoffice_cookie_fetched_at, backoffice_last_tested_at",
      )
      .eq("account_id", accountId)
      .eq("provider", "quickresto")
      .maybeSingle(),
    admin
      .from<Array<{ synced_at: string | null }>>("ingredients")
      .select("synced_at")
      .eq("account_id", accountId)
      .order("synced_at", { ascending: false })
      .range(0, 0),
  ]);

  if (!account) {
    return (
      <div className="w-full p-6 md:p-8">
        <h1 className="text-2xl font-semibold">Интеграции</h1>
        <p className="mt-2 text-sm text-muted-foreground">Аккаунт не найден</p>
      </div>
    );
  }

  const connectionView: QuickRestoConnectionView | null = connection
    ? {
        login: connection.login,
        status: connection.status,
        lastTestedAt: connection.last_tested_at,
        backofficeLastTestedAt: connection.backoffice_last_tested_at,
        // «Настроен» — это логин плюс однажды полученная cookie-сессия:
        // без неё акт не провести, даже если пароль сохранён.
        backofficeConfigured: Boolean(
          connection.backoffice_login && connection.backoffice_cookie_fetched_at,
        ),
      }
    : null;

  return (
    <div className="w-full p-6 md:p-8">
      <h1 className="text-2xl font-semibold">Интеграции</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Подключайте внешние системы и повторяйте импорт данных
      </p>

      {params.quickresto === "done" ? (
        <div className="mt-4 max-w-xl rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-500/30 dark:bg-green-500/15 dark:text-green-300">
          Импорт Quick Resto завершён.
        </div>
      ) : null}

      <QuickRestoConnectionCard
        connection={connectionView}
        canSync={can("inventory.sync_quickresto")}
        lastSyncedAt={lastSynced?.[0]?.synced_at ?? null}
      />
    </div>
  );
}
