"use server";

import { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";

type KbPageUpdateRpcRow =
  Database["public"]["Functions"]["kb_list_page_updates"]["Returns"][number];

export type KbPageUpdate = {
  id: string;
  source: string;
  action_code: string;
  created_at: string;
  details: Record<string, unknown>;
  actor: {
    id: string;
    name: string;
    avatar_url: string | null;
  } | null;
};

export async function listKbPageUpdates(
  pageId: string,
): Promise<{ rows: KbPageUpdate[]; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kb_list_page_updates", {
    p_page_id: pageId,
    p_limit: 80,
  });
  if (error) return { rows: [], error: error.message };

  return {
    rows: ((data ?? []) as KbPageUpdateRpcRow[]).map((row) => ({
      id: row.id,
      source: row.source,
      action_code: row.action_code,
      created_at: row.created_at,
      details: normalizeDetails(row.details),
      actor: row.actor_id
        ? {
            id: row.actor_id,
            name: actorName(row.actor_first_name, row.actor_last_name),
            avatar_url: row.actor_avatar_url,
          }
        : null,
    })),
    error: null,
  };
}

function actorName(firstName: string | null, lastName: string | null): string {
  return [firstName, lastName].filter(Boolean).join(" ").trim() || "Неизвестный автор";
}

function normalizeDetails(value: Json): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
