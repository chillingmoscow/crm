import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import {
  getLegalEntity,
  listAccountVenues,
  listLegalEntities,
} from "@/lib/org/legal-entities";
import { isDadataConfigured } from "@/lib/dadata/client";
import { LegalEntityDetailClient } from "./_components/legal-entity-detail";
import { LegalEntityVenues } from "./_components/legal-entity-venues";

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
  //
  // canManageVenues is checked too because the venues section attaches
  // and detaches by writing to venues.default_legal_entity_id, and that
  // mutation is gated by the venues_update RLS policy on
  // org.manage_venues (migration 034 §7.2). A user with manage_legal_
  // entities but without manage_venues (e.g. accountant per matrix)
  // would see actionable buttons and then hit RLS errors on click —
  // hide them instead.
  const [
    { data: canManage },
    { data: canDelete },
    { data: canManageVenues },
    { rows: venues },
    { rows: legalEntities },
  ] = await Promise.all([
    supabase.rpc("has_permission", {
      permission_code: "org.manage_legal_entities",
    }),
    supabase.rpc("has_permission", {
      permission_code: "org.delete_legal_entity",
    }),
    supabase.rpc("has_permission", {
      permission_code: "org.manage_venues",
    }),
    listAccountVenues(),
    listLegalEntities(),
  ]);

  // id → display name lookup so the venues section can show "currently
  // attached to <other LE>" rows informatively.
  const legalEntityNames: Record<string, string> = {};
  for (const le of legalEntities) {
    legalEntityNames[le.id] = le.short_name ?? le.name;
  }

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
        dadataEnabled={isDadataConfigured()}
      />

      <div className="mt-6">
        <LegalEntityVenues
          legalEntityId={row.id}
          venues={venues}
          legalEntityNames={legalEntityNames}
          readOnly={!canManageVenues}
        />
      </div>
    </div>
  );
}
