import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { planFromSnapshot, type AutomationSnapshot } from "./state";

/** Scheduled runs compare only; external and salary writers are deliberately absent. */
export async function processAutomationComparison() {
  const db = asLooseDb(createAdminClient());
  const claimed = await db.rpc("payroll_claim_automation_comparison");
  if (claimed.error) throw new Error(claimed.error.message);
  const job = claimed.data as {
    id: string;
    venue_id: string;
    business_date: string;
    lease_token: string;
  } | null;
  if (!job) return { idle: true };
  try {
    const source = await db.rpc("payroll_automation_snapshot", {
      p_venue: job.venue_id,
    });
    if (source.error || !source.data) throw new Error("Источники недоступны");
    const snapshot = source.data as AutomationSnapshot;
    const plan = planFromSnapshot(snapshot, job.business_date);
    const completed = await db.rpc("payroll_commit_scheduled_automation", {
      p_job: job.id,
      p_lease: job.lease_token,
      p_snapshot: snapshot,
      p_plan: plan,
    });
    if (completed.error) throw new Error(completed.error.message);
    return { idle: false, superseded: !completed.data };
  } catch {
    // A lost response may follow a successful commit. The DB changes only a still-running lease.
    const failed = await db.rpc("payroll_fail_automation_comparison", {
      p_job: job.id,
      p_lease: job.lease_token,
    });
    if (failed.error) throw new Error("Не удалось сохранить состояние сверки");
    return { idle: false, error: true };
  }
}
export async function scheduleAutomationComparisons() {
  const result = await asLooseDb(createAdminClient()).rpc(
    "payroll_schedule_automation_comparisons",
  );
  if (result.error) throw new Error(result.error.message);
}
