import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { listBankAccounts } from "@/lib/finance/bank-accounts";
import {
  ArchivedBankAccountsClient,
  type ArchivedBankAccountRow,
} from "./_components/archived-bank-accounts-client";

export default async function BankAccountsArchivePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Owner-only (через get_active_account_id + is_account_owner, см.
  // docs/CONVENTIONS.md «Owner-check для архив-страниц»).
  const { data: activeAccountId } = await supabase.rpc("get_active_account_id");
  if (!activeAccountId) redirect("/finance/accounts");
  const { data: isOwner } = await supabase.rpc("is_account_owner", {
    p_account_id: activeAccountId,
  });
  if (!isOwner) redirect("/finance/accounts");

  const { rows } = await listBankAccounts({ include_deleted: true });
  const archived = rows.filter((r) => r.deleted_at !== null);

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

  const list: ArchivedBankAccountRow[] = archived.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    bank_name: r.bank_name,
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
        <Link href="/finance/accounts">
          <ArrowLeft className="w-4 h-4" />
          Счета
        </Link>
      </Button>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Архив счетов</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Архивированные счета скрыты из всех выборов. История транзакций
          сохраняется. Восстановите, чтобы вернуть в работу. «Удалить
          навсегда» возможно только если по счёту нет транзакций.
        </p>
      </div>

      <ArchivedBankAccountsClient rows={list} />
    </div>
  );
}
