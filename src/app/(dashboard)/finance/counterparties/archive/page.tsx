import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { listCounterparties } from "@/lib/finance/counterparties";
import {
  ArchivedCounterpartiesClient,
  type ArchivedCounterpartyRow,
} from "./_components/archived-counterparties-client";

export default async function CounterpartiesArchivePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Только владелец аккаунта может видеть архив и удалять навсегда.
  // RLS counterparties_select допускает deleted_at для manage_counterparties,
  // но страница архива по конвенции — owner-only (как venues).
  const { data: account } = await supabase
    .from("accounts")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!account) redirect("/finance/counterparties");

  const { rows } = await listCounterparties({ include_deleted: true });
  const archived = rows.filter((cp) => cp.deleted_at !== null);

  // Имена авторов архивации (deleted_by)
  const deletedByIds = Array.from(
    new Set(archived.map((r) => r.deleted_by).filter((v): v is string => Boolean(v))),
  );
  const profileNameMap = new Map<string, string>();
  if (deletedByIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", deletedByIds);
    (profiles ?? []).forEach((p) => {
      const display = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "—";
      profileNameMap.set(p.id, display);
    });
  }

  const list: ArchivedCounterpartyRow[] = archived.map((r) => ({
    id: r.id,
    name: r.name,
    inn: r.inn,
    deleted_at: r.deleted_at!,
    deleted_by_name: r.deleted_by ? profileNameMap.get(r.deleted_by) ?? "—" : "—",
  }));

  return (
    <div className="p-6 md:p-8 w-full max-w-5xl">
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="-ml-2 mb-4 gap-1.5 text-muted-foreground hover:text-foreground"
      >
        <Link href="/finance/counterparties">
          <ArrowLeft className="w-4 h-4" />
          Контрагенты
        </Link>
      </Button>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Архив контрагентов</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Архивированные контрагенты скрыты из всех выборов и списков. История
          по существующим транзакциям сохраняется. Восстановите, чтобы вернуть
          в работу; «Удалить навсегда» уничтожит контрагента и каскадом
          документы / связи с ингредиентами.
        </p>
      </div>

      <ArchivedCounterpartiesClient rows={list} />
    </div>
  );
}
