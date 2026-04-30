import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { listCounterpartyGroups } from "@/lib/finance/counterparties";
import { isDadataConfigured } from "@/lib/dadata/client";
import { CounterpartyForm } from "../_components/counterparty-form";

export default async function NewCounterpartyPage() {
  const supabase = await createClient();
  const { data: canManage } = await supabase.rpc("has_permission", {
    permission_code: "finance.manage_counterparties",
  });
  if (!canManage) redirect("/finance/counterparties");

  const { rows: groups } = await listCounterpartyGroups();
  const dadataEnabled = isDadataConfigured();

  return (
    <div className="p-6 md:p-8 w-full max-w-4xl">
      <Link
        href="/finance/counterparties"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        К списку контрагентов
      </Link>

      <h1 className="text-2xl font-semibold mb-1">Новый контрагент</h1>
      <p className="text-muted-foreground text-sm mb-6">
        {dadataEnabled
          ? "Введите ИНН и нажмите «Из DaData» — поля заполнятся автоматически."
          : "DaData не настроена — заполните поля вручную."}
      </p>

      <CounterpartyForm mode="create" groups={groups} dadataEnabled={dadataEnabled} />
    </div>
  );
}
