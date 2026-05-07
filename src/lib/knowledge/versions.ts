"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { kbVersionRestoreSchema } from "@/lib/knowledge/schemas";
import { saveKbPage } from "@/lib/knowledge/pages";
import { blocksToPlainText } from "@/lib/knowledge/plain-text";
import type { KbBlock, KbPageVersionRow } from "@/types/knowledge";

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
  | "created_by"
>;

export type KbPageVersionWithAuthor = KbPageVersionSummaryRow & {
  author: { first_name: string | null; last_name: string | null } | null;
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
      "id, page_id, version_number, title, plain_text, text_length, created_at, created_by, author:profiles!kb_page_versions_created_by_fkey(first_name, last_name)",
    )
    .eq("page_id", pageId)
    .order("version_number", { ascending: false });
  if (error) return { rows: [], error: error.message };

  // PostgREST embeds single-FK relationships as objects (not arrays).
  type Embedded = KbPageVersionSummaryRow & {
    author: { first_name: string | null; last_name: string | null } | null;
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
    .select("title, content, plain_text")
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
    content,
    plain_text: plainText,
  });
  if (result.error) return { error: result.error, new_version_number: null };

  revalidatePath(`/knowledge/${parsed.data.page_id}`);
  return { error: null, new_version_number: result.version_number };
}
