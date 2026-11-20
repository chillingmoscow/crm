import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";
import { ArchivedVenuesClient, type ArchivedVenueRow } from "./_components/archived-venues-client";

export const metadata: Metadata = { title: "Архив заведений" };

export default async function VenuesArchivePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Только владелец активного аккаунта — archived venue видны через
  // venues_select_archived_owner (миграция 198). Codex P2 #372: не
  // использовать `accounts.eq(owner_id, user.id).maybeSingle()` — упадёт
  // если юзер владеет несколькими аккаунтами. Через get_active_account_id
  // + is_account_owner.
  const { data: activeAccountId } = await supabase.rpc("get_active_account_id");
  if (!activeAccountId) redirect("/org/venues");
  const { data: isOwner } = await supabase.rpc("is_account_owner", {
    p_account_id: activeAccountId,
  });
  if (!isOwner) redirect("/org/venues");

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
    .eq("account_id", activeAccountId)
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
      const display = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
      if (display) profileNameMap.set(p.id, display);
    });
  }

  const list: ArchivedVenueRow[] = archived.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    address: r.address,
    archived_at: r.archived_at,
    archived_by_name: r.archived_by ? profileNameMap.get(r.archived_by) ?? null : null,
  }));

  return <ArchivedVenuesClient rows={list} />;
}
