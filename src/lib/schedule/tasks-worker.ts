import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { processTaskMessage } from "./tasks-messages";
export async function processScheduleTasks() {
  const db = asLooseDb(createAdminClient());
  const r = await db.rpc("schedule_process_tasks");
  if (r.error) throw new Error(r.error.message);
  const message = await processTaskMessage();
  return { ...(r.data as { created: number; settled: number }), message };
}
