import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import {
  ArchivedLegalEntitiesClient,
  type ArchivedLegalEntityRow,
} from "./_components/archived-legal-entities-client";

export const metadata: Metadata = { title: "Архив юрлиц" };

export default async function LegalEntitiesArchivePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Только владелец активного аккаунта (docs/CONVENTIONS.md «Owner-check
  // для архив-страниц» — через get_active_account_id + is_account_owner).
  const { data: activeAccountId } = await supabase.rpc("get_active_account_id");
  if (!activeAccountId) redirect("/org/legal-entities");
  const { data: isOwner } = await supabase.rpc("is_account_owner", {
    p_account_id: activeAccountId,
  });
  if (!isOwner) redirect("/org/legal-entities");

  // RLS legal_entities_select_archived_owner пустит archived owner'у.
  // Фильтр archived в JS — миграция 200 свежая, asLooseDb для типов.
  const db = asLooseDb(supabase);
  const { data: rows } = await db
    .from<Array<{
      id: string;
      name: string;
      short_name: string | null;
      legal_form: string;
      inn: string | null;
      archived_at: string | null;
      archived_by: string | null;
    }>>("legal_entities")
    .select("id, name, short_name, legal_form, inn, archived_at, archived_by")
    .eq("account_id", activeAccountId as string)
    .order("archived_at", { ascending: false });

  const archived = (rows ?? []).filter(
    (r): r is typeof r & { archived_at: string } => r.archived_at !== null,
  );

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
      const display = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
      if (!display) return;
      profileNameMap.set(p.id, display);
    });
  }

  const list: ArchivedLegalEntityRow[] = archived.map((r) => ({
    id: r.id,
    name: r.name,
    short_name: r.short_name,
    legal_form: r.legal_form,
    inn: r.inn,
    archived_at: r.archived_at,
    archived_by_name: r.archived_by ? profileNameMap.get(r.archived_by) ?? null : null,
  }));

  return <ArchivedLegalEntitiesClient rows={list} />;
}
