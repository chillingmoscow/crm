import type { LooseQuery, LooseResult } from "@/lib/supabase/loose";
import type { TaskOccurrence } from "@/lib/schedule/tasks";

/** Calendar rows and old unsettled reports share a result set. Never let an
 * accumulated backlog consume PostgREST's row cap and hide newer assignments. */
export async function readTaskOccurrences(
  query: () => LooseQuery<TaskOccurrence[]>,
): Promise<LooseResult<TaskOccurrence[]>> {
  const rows: TaskOccurrence[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const result = await query()
      .order("business_date")
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (result.error) return { data: null, error: result.error };
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < pageSize) break;
  }
  return { data: rows, error: null };
}
