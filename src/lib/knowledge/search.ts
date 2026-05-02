"use server";

import { createClient } from "@/lib/supabase/server";
import { kbSearchSchema } from "@/lib/knowledge/schemas";
import type { KbSearchHit } from "@/types/knowledge";

/**
 * Full-text search across the active account's KB.
 *
 * Backed by the `kb_search` RPC (migration 052), which wraps:
 *   - websearch_to_tsquery('russian', $query)
 *   - ts_rank
 *   - ts_headline for the snippet
 *
 * RLS on kb_pages still applies inside the RPC body — users without
 * `kb.view_pages` get an empty result, which the UI surfaces as
 * "ничего не найдено".
 */
export async function searchKbPages(
  query: string,
  limit = 20
): Promise<{ hits: KbSearchHit[]; error: string | null }> {
  const parsed = kbSearchSchema.safeParse({ query, limit });
  if (!parsed.success) return { hits: [], error: parsed.error.message };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kb_search", {
    p_query: parsed.data.query,
    p_limit: parsed.data.limit ?? 20,
  });
  if (error) return { hits: [], error: error.message };

  return { hits: (data ?? []) as KbSearchHit[], error: null };
}
