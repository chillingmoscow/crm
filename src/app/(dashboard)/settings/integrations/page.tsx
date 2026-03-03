import Link from "next/link";
import { redirect } from "next/navigation";
import { PlugZap } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ quickresto?: string }>;
}) {
  const supabase = await createClient();
  const params = await searchParams;
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
        <h1 className="text-2xl font-semibold">Интеграции</h1>
        <p className="text-sm text-muted-foreground mt-2">Интеграции доступны владельцу аккаунта.</p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 w-full">
      <h1 className="text-2xl font-semibold">Интеграции</h1>
      <p className="text-sm text-muted-foreground mt-1">Подключайте внешние системы и повторяйте импорт данных.</p>

      {params.quickresto === "done" ? (
        <div className="mt-4 max-w-xl rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Импорт Quick Resto завершён.
        </div>
      ) : null}

      <div className="mt-6 rounded-xl border p-5 max-w-xl">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
            <PlugZap className="w-5 h-5 text-blue-600" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-medium">Quick Resto</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Перезапустите мастер интеграции и выберите, какие заведения, должности и сотрудники импортировать.
            </p>
            <Link
              href="/settings/integrations/quickresto"
              className="inline-flex mt-4 h-9 items-center rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"
            >
              Запустить интеграцию
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
