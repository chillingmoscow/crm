"use server";

import { createClient } from "@/lib/supabase/server";
import { createKbPage } from "@/lib/knowledge/pages";
import {
  collectionSchemaToProperties,
  parseCollectionSchemaJson,
} from "@/lib/knowledge/collection";
import { kbPropertiesSchema } from "@/lib/knowledge/schemas";
import type { KbProperty } from "@/types/knowledge";

export type KbCollectionItem = {
  id: string;
  slug: string;
  title: string;
  icon: string | null;
  icon_color: string | null;
  cover_url: string | null;
  plain_text: string;
  properties: KbProperty[];
  position: number;
  updated_at: string | null;
};

export async function listKbCollectionItems(parentPageId: string): Promise<{
  rows: KbCollectionItem[];
  error: string | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kb_pages")
    .select(
      "id, slug, title, icon, icon_color, cover_url, plain_text, properties, position, updated_at",
    )
    .eq("parent_id", parentPageId)
    .is("deleted_at", null)
    .order("position", { ascending: true })
    .order("title", { ascending: true });

  if (error) return { rows: [], error: error.message };

  const rows = (data ?? []).map((row) => {
    const parsed = kbPropertiesSchema.safeParse(
      (row as { properties?: unknown }).properties ?? [],
    );
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      icon: row.icon,
      icon_color: row.icon_color,
      cover_url: row.cover_url,
      plain_text: row.plain_text ?? "",
      position: row.position ?? 0,
      updated_at: row.updated_at,
      properties: parsed.success ? parsed.data : [],
    } satisfies KbCollectionItem;
  });

  return { rows, error: null };
}

export async function createKbCollectionRecord(input: {
  parentPageId: string;
  schemaJson: string;
}): Promise<{ id: string | null; slug: string | null; error: string | null }> {
  const schema = parseCollectionSchemaJson(input.schemaJson);
  return createKbPage({
    parent_id: input.parentPageId,
    properties: collectionSchemaToProperties(schema),
  });
}
