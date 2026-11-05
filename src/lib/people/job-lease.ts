import type { LooseDb } from "../supabase/loose.ts";

/** The job was cancelled or claimed again after this worker's lease ran out: stop without writing. */
export class LeaseLostError extends Error {
  constructor() { super("Задание отменено или перехвачено другим обработчиком. Шаги остановлены"); }
}

/**
 * Updates a leased job row only while it is still this worker's attempt
 * (state 'working' and the attempts value returned by the claim). A claim
 * increments attempts, so a re-claim after a lease overrun is detected too.
 */
export async function leasedUpdate(db: LooseDb, table: string, job: { id: string; attempts: number }, values: Record<string, unknown>) {
  const r = await db.from<{ id: string }[]>(table).update(values)
    .eq("id", job.id).eq("state", "working").eq("attempts", job.attempts).select("id");
  if (r.error) throw new Error(r.error.message);
  if (!r.data?.length) throw new LeaseLostError();
}
