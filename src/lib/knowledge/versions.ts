"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  kbPropertiesSchema,
  kbVersionRestoreSchema,
} from "@/lib/knowledge/schemas";
import { saveKbPage } from "@/lib/knowledge/pages";
import { saveKbPageProperties } from "@/lib/knowledge/properties";
import { blocksToPlainText } from "@/lib/knowledge/plain-text";
import type { KbBlock, KbPageVersionRow, KbProperty } from "@/types/knowledge";

/** Author info embedded into version rows so the UI can show who saved
 * the snapshot. Mirrors the `profiles` columns we read in get-name. */
type KbPageVersionSummaryRow = Pick<
  KbPageVersionRow,
  | "id"
  | "page_id"
  | "version_number"
  | "title"
  | "plain_text"
  | "text_length"
  | "created_at"
  | "updated_at"
  | "created_by"
  | "change_kinds"
>;

export type KbPageVersionWithAuthor = KbPageVersionSummaryRow & {
  author: {
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
  } | null;
};

export type KbVersionDiffData = {
  version_number: number;
  plain_text: string;
  previous_version_number: number | null;
  previous_plain_text: string;
};

/** All snapshots for a page, newest first. Each row carries an embedded
 * `author` derived from `profiles` via the kb_page_versions_created_by_fkey
 * relationship. */
export async function listKbPageVersions(pageId: string): Promise<{
  rows: KbPageVersionWithAuthor[];
  error: string | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kb_page_versions")
    .select(
      "id, page_id, version_number, title, plain_text, text_length, created_at, updated_at, created_by, change_kinds, author:profiles!kb_page_versions_created_by_fkey(first_name, last_name, avatar_url)",
    )
    .eq("page_id", pageId)
    .order("version_number", { ascending: false });
  if (error) return { rows: [], error: error.message };

  // PostgREST embeds single-FK relationships as objects (not arrays).
  type Embedded = KbPageVersionSummaryRow & {
    author: {
      first_name: string | null;
      last_name: string | null;
      avatar_url: string | null;
    } | null;
  };
  return { rows: (data ?? []) as unknown as Embedded[], error: null };
}

export async function getKbPageVersion(
  pageId: string,
  versionNumber: number
): Promise<{ row: KbPageVersionRow | null; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kb_page_versions")
    .select("*")
    .eq("page_id", pageId)
    .eq("version_number", versionNumber)
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: (data as KbPageVersionRow | null) ?? null, error: null };
}

export async function getKbPageVersionDiffData(
  pageId: string,
  versionNumber: number,
): Promise<{ row: KbVersionDiffData | null; error: string | null }> {
  const supabase = await createClient();
  const [currentRes, previousRes] = await Promise.all([
    supabase
      .from("kb_page_versions")
      .select("version_number, plain_text, content")
      .eq("page_id", pageId)
      .eq("version_number", versionNumber)
      .maybeSingle(),
    supabase
      .from("kb_page_versions")
      .select("version_number, plain_text, content")
      .eq("page_id", pageId)
      .lt("version_number", versionNumber)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (currentRes.error) return { row: null, error: currentRes.error.message };
  if (previousRes.error) return { row: null, error: previousRes.error.message };
  if (!currentRes.data) return { row: null, error: "Версия не найдена" };

  const current = currentRes.data as {
    version_number: number;
    plain_text?: string | null;
    content: unknown;
  };
  const previous = previousRes.data as
    | { version_number: number; plain_text?: string | null; content: unknown }
    | null;

  return {
    row: {
      version_number: current.version_number,
      plain_text: versionPlainText(current),
      previous_version_number: previous?.version_number ?? null,
      previous_plain_text: previous ? versionPlainText(previous) : "",
    },
    error: null,
  };
}

/**
 * Restore a previous version. Implemented as a regular saveKbPage call
 * with the old content — that creates a NEW version snapshot at the
 * top of history (instead of mutating the past). Same approach as
 * Google Docs/Notion.
 *
 * Note: plain_text is taken from the historical version row. If the
 * historical row was created before plain_text became reliable, search
 * may briefly miss the restored content until the next live edit.
 */
export async function restoreKbPageVersion(
  input: { page_id: string; version_number: number }
): Promise<{ error: string | null; new_version_number: number | null }> {
  const parsed = kbVersionRestoreSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.message, new_version_number: null };

  const supabase = await createClient();
  const { data: version, error: vErr } = await supabase
    .from("kb_page_versions")
    .select("title, content, plain_text, icon, icon_color, properties")
    .eq("page_id", parsed.data.page_id)
    .eq("version_number", parsed.data.version_number)
    .maybeSingle();
  if (vErr) return { error: vErr.message, new_version_number: null };
  if (!version) return { error: "Версия не найдена", new_version_number: null };

  const content = (version as { content: unknown }).content as KbBlock[];
  const storedPlainText = (version as { plain_text?: string | null }).plain_text;
  const plainText =
    typeof storedPlainText === "string" && storedPlainText.length > 0
      ? storedPlainText
      : blocksToPlainText(content);

  // Reuse saveKbPage so the snapshot/backlinks logic runs uniformly.
  const result = await saveKbPage({
    id: parsed.data.page_id,
    title: (version as { title: string }).title,
    icon: (version as { icon?: string | null }).icon ?? null,
    icon_color: (version as { icon_color?: string | null }).icon_color ?? null,
    content,
    plain_text: plainText,
    force_new_version: true,
  });
  if (result.error) return { error: result.error, new_version_number: null };

  const versionProperties = (version as { properties?: unknown }).properties;
  if (versionProperties !== null && versionProperties !== undefined) {
    const parsedProperties = kbPropertiesSchema.safeParse(versionProperties);
    if (!parsedProperties.success) {
      return {
        error: "Свойства версии повреждены, восстановление остановлено",
        new_version_number: null,
      };
    }
    const propResult = await saveKbPageProperties({
      pageId: parsed.data.page_id,
      properties: parsedProperties.data as KbProperty[],
    });
    if (propResult.error) {
      return { error: propResult.error, new_version_number: null };
    }
  }

  revalidatePath(`/knowledge/${parsed.data.page_id}`);
  return { error: null, new_version_number: result.version_number };
}

function versionPlainText(row: {
  plain_text?: string | null;
  content: unknown;
}): string {
  if (typeof row.plain_text === "string" && row.plain_text.length > 0) {
    return row.plain_text;
  }
  return blocksToPlainText((row.content as KbBlock[]) ?? []);
}
