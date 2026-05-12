import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { isDadataConfigured } from "@/lib/dadata/client";
import { LegalEntityForm } from "../_components/legal-entity-form";

export default async function NewLegalEntityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: canManage } = await supabase.rpc("has_permission", {
    permission_code: "org.manage_legal_entities",
  });
  if (!canManage) redirect("/org/legal-entities");

  const dadataEnabled = isDadataConfigured();

  return (
    <div className="p-6 md:p-8 w-full max-w-4xl">
      <Link
        href="/org/legal-entities"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        К списку юрлиц
      </Link>

      <h1 className="text-2xl font-semibold mb-1">Новое юрлицо</h1>
      <p className="text-muted-foreground text-sm mb-6">
        {dadataEnabled
          ? "Введите ИНН и нажмите «Из DaData» — поля заполнятся автоматически. После этого можно скорректировать вручную"
          : "DaData не настроена — заполните поля вручную"}
      </p>

      <LegalEntityForm mode="create" dadataEnabled={dadataEnabled} />
    </div>
  );
}
