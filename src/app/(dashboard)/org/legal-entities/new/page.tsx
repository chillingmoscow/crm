import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
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
        Введите ИНН и нажмите «Из DaData» — поля заполнятся автоматически. После
        этого можно скорректировать вручную.
      </p>

      <LegalEntityForm mode="create" />
    </div>
  );
}
