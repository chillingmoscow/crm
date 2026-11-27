"use server";

import { createClient, getCachedPermissions } from "@/lib/supabase/server";
import { asLooseDb } from "@/lib/supabase/loose";

/** Статусы акта «в работе»: назначен, считается, ждёт проверки или пересчёта. */
const IN_WORK = ["assigned", "in_progress", "ready_for_review", "recount_pending"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Сколько актов инвентаризации активного заведения сейчас в работе — бейдж
 * пункта «Акты инвентаризации» в меню. Строки режет RLS (`documents_select`):
 * сотрудник, которому акт только назначен, видит лишь свои акты, поэтому
 * число у него — его акты, у управляющего — все акты заведения.
 *
 * Заведение передаёт вызывающий (layout и меню его уже знают): отдельный
 * `get_active_venue_id` на каждый показ меню не нужен. Чужое заведение
 * ничего не откроет — строки всё равно режет RLS.
 */
export async function countActsInWork(venueId: string | null): Promise<number> {
  if (typeof venueId !== "string" || !UUID.test(venueId)) return 0;
  const perms = await getCachedPermissions();
  if (
    !perms.includes("inventory.view_documents") &&
    !perms.includes("inventory.manage_documents") &&
    !perms.includes("inventory.fill_assigned_documents")
  )
    return 0;
  const supabase = await createClient();
  const db = asLooseDb(supabase);
  const { count, error } = await db
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("document_kind", "inventory")
    .eq("venue_id", venueId)
    .is("archived_at", null)
    .in("status", IN_WORK);
  if (error) {
    console.error(`[inventory] countActsInWork: ${error.message}`);
    return 0;
  }
  return count ?? 0;
}
