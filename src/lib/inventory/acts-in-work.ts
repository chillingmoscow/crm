"use server";

import { createClient, getCachedPermissions } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";

/** Статусы акта «в работе»: назначен, считается, ждёт проверки или пересчёта. */
const IN_WORK = ["assigned", "in_progress", "ready_for_review", "recount_pending"];

/**
 * Сколько актов инвентаризации активного заведения сейчас в работе — бейдж
 * пункта «Акты инвентаризации» в меню. Строки режет RLS (`documents_select`):
 * сотрудник, которому акт только назначен, видит лишь свои акты, поэтому
 * число у него — его акты, у управляющего — все акты заведения.
 */
export async function countActsInWork(): Promise<number> {
  const perms = await getCachedPermissions();
  if (
    !perms.includes("inventory.view_documents") &&
    !perms.includes("inventory.manage_documents") &&
    !perms.includes("inventory.fill_assigned_documents")
  )
    return 0;
  const supabase = await createClient();
  const db = asLooseDb(supabase);
  const venue = await db.rpc("get_active_venue_id");
  if (venue.error || !venue.data) return 0;
  const { count, error } = await db
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("document_kind", "inventory")
    .eq("venue_id", String(venue.data))
    .is("archived_at", null)
    .in("status", IN_WORK);
  if (error) {
    console.error(`[inventory] countActsInWork: ${error.message}`);
    return 0;
  }
  return count ?? 0;
}
