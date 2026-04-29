import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { getLegalEntity } from "@/lib/org/legal-entities";
import { LegalEntityDetailClient } from "./_components/legal-entity-detail";

export default async function LegalEntityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: canView } = await supabase.rpc("has_permission", {
    permission_code: "org.view_legal_entities",
  });
  if (!canView) redirect("/dashboard");

  const { row, error } = await getLegalEntity(id);
  if (error || !row) redirect("/org/legal-entities");

  // Manage / delete permissions are checked separately so the form
  // can show read-only state for users who can view but not edit.
  const [{ data: canManage }, { data: canDelete }] = await Promise.all([
    supabase.rpc("has_permission", {
      permission_code: "org.manage_legal_entities",
    }),
    supabase.rpc("has_permission", {
      permission_code: "org.delete_legal_entity",
    }),
  ]);

  return (
    <div className="p-6 md:p-8 w-full max-w-4xl">
      <Link
        href="/org/legal-entities"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        К списку юрлиц
      </Link>

      <h1 className="text-2xl font-semibold mb-1">{row.name}</h1>
      <p className="text-muted-foreground text-sm mb-6">
        {row.inn ? `ИНН ${row.inn}` : "ИНН не указан"}
        {row.kpp ? ` • КПП ${row.kpp}` : ""}
      </p>

      <LegalEntityDetailClient
        row={row}
        canManage={!!canManage}
        canDelete={!!canDelete}
      />
    </div>
  );
}
