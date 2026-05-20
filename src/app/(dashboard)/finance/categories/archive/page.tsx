import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { listFinanceCategories } from "@/lib/finance/categories";
import {
  ArchivedCategoriesClient,
  type ArchivedCategoryRow,
} from "./_components/archived-categories-client";

export default async function FinanceCategoriesArchivePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: activeAccountId } = await supabase.rpc("get_active_account_id");
  if (!activeAccountId) redirect("/finance/categories");
  const { data: isOwner } = await supabase.rpc("is_account_owner", {
    p_account_id: activeAccountId,
  });
  if (!isOwner) redirect("/finance/categories");

  const { rows } = await listFinanceCategories({ include_archived: true });
  const archived = rows.filter((r) => r.archived_at !== null);

  const archivedByIds = Array.from(
    new Set(archived.map((r) => r.archived_by).filter((v): v is string => Boolean(v))),
  );
  const profileNameMap = new Map<string, string>();
  if (archivedByIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", archivedByIds);
    (profiles ?? []).forEach((p) => {
      const display = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "—";
      profileNameMap.set(p.id, display);
    });
  }

  const list: ArchivedCategoryRow[] = archived.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    archived_at: r.archived_at!,
    archived_by_name: r.archived_by ? profileNameMap.get(r.archived_by) ?? "—" : "—",
  }));

  return (
    <div className="p-6 md:p-8 w-full max-w-5xl">
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="-ml-2 mb-4 gap-1.5 text-muted-foreground hover:text-foreground"
      >
        <Link href="/finance/categories">
          <ArrowLeft className="w-4 h-4" />
          Статьи
        </Link>
      </Button>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Архив статей</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Архивированные статьи скрыты из всех выборов. История транзакций
          сохраняется (ссылка на статью продолжает работать). Восстановите
          или удалите навсегда — при удалении транзакции потеряют ссылку
          (станут «без статьи»).
        </p>
      </div>

      <ArchivedCategoriesClient rows={list} />
    </div>
  );
}
