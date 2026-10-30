import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { planFromSnapshot, type AutomationSnapshot } from "./state";

/** Only native salary journal entries can be written; no external provider is called. */
export async function runPayrollAutomation(
  venueId: string,
  date: string,
  mode: "comparison" | "native",
  actorId: string,
  previewId?: string,
) {
  const db = asLooseDb(createAdminClient());
  const source = await db.rpc("payroll_automation_snapshot", {
    p_venue: venueId,
  });
  if (source.error) throw new Error(source.error.message);
  if (!source.data) throw new Error("Заведение недоступно");
  const snapshot = source.data as AutomationSnapshot;
  const plan = planFromSnapshot(snapshot, date);
  const result = await db.rpc("payroll_commit_automation_run", {
    p_venue: venueId,
    p_date: date,
    p_snapshot: snapshot,
    p_plan: plan,
    p_mode: mode,
    p_actor: actorId,
    p_preview: previewId ?? null,
  });
  if (result.error) throw new Error(result.error.message);
  return { id: String(result.data), ...plan };
}
