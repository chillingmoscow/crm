import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { Button } from "@/components/ui/button";
import { ArchivedVenuesClient, type ArchivedVenueRow } from "./_components/archived-venues-client";

export default async function VenuesArchivePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Только владелец аккаунта — archived venue видны через
  // venues_select_archived_owner (миграция 198).
  const { data: account } = await supabase
    .from("accounts")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!account) redirect("/org/venues");

  // Venues аккаунта — RLS пустит и live (is_account_owner), и archived
  // (venues_select_archived_owner). Архивные фильтруем в JS (LooseQuery
  // не имеет .not, а таблица venues маленькая — десятки строк на аккаунт).
  const db = asLooseDb(supabase);
  const { data: rows } = await db
    .from<Array<{
      id: string;
      name: string;
      type: string;
      archived_at: string | null;
      archived_by: string | null;
      address: string | null;
    }>>("venues")
    .select("id, name, type, archived_at, archived_by, address")
    .eq("account_id", account.id)
    .order("archived_at", { ascending: false });

  const archived = (rows ?? []).filter(
    (r): r is typeof r & { archived_at: string } => r.archived_at !== null,
  );

  // Имена авторов архивации
  const archivedByIds = Array.from(
    new Set(archived.map((r) => r.archived_by).filter((v): v is string => Boolean(v))),
  );
  const profileNameMap = new Map<string, string>();
  if (archivedByIds.length > 0) {
    const { data: profiles } = await db
      .from<Array<{ id: string; first_name: string | null; last_name: string | null }>>("profiles")
      .select("id, first_name, last_name")
      .in("id", archivedByIds);
    (profiles ?? []).forEach((p) => {
      const display = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "—";
      profileNameMap.set(p.id, display);
    });
  }

  const list: ArchivedVenueRow[] = archived.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    address: r.address,
    archived_at: r.archived_at,
    archived_by_name: r.archived_by ? profileNameMap.get(r.archived_by) ?? "—" : "—",
  }));

  return (
    <div className="p-6 md:p-8 w-full max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <Button asChild variant="ghost" size="sm" className="-ml-2 gap-1.5 text-muted-foreground hover:text-foreground">
          <Link href="/org/venues">
            <ArrowLeft className="w-4 h-4" />
            Заведения
          </Link>
        </Button>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Архив заведений</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Архивированные заведения скрыты из всех списков и переключателей.
          Связанные данные (документы, транзакции, склады) сохранены.
          Восстановите, чтобы вернуть в работу; «Удалить навсегда» уничтожит
          заведение и каскадом отделы / роли / залы / приглашения.
        </p>
      </div>

      <ArchivedVenuesClient rows={list} />
    </div>
  );
}
