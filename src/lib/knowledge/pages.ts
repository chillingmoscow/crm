"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { extractBacklinks } from "@/lib/knowledge/backlinks";
import {
  kbPageCreateSchema,
  kbPageMoveSchema,
  kbPageSaveSchema,
} from "@/lib/knowledge/schemas";
import { generateKbSlug } from "@/lib/knowledge/slug";
import type {
  KbPageCreateInput,
  KbPageMoveInput,
  KbPageRow,
  KbPageSaveInput,
} from "@/types/knowledge";

// ─── Reads ───────────────────────────────────────────────────────────────────

/** All non-deleted pages of the active account, ordered for tree assembly. */
export async function listKbPages(): Promise<{
  rows: KbPageRow[];
  error: string | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kb_pages")
    .select("*")
    .is("deleted_at", null)
    .order("parent_id", { ascending: true, nullsFirst: true })
    .order("position", { ascending: true });
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as KbPageRow[], error: null };
}

/** Soft-deleted pages, for the trash view. RLS hides these from users
 * without `kb.delete_pages` (see migration 050 §3). */
export async function listDeletedKbPages(): Promise<{
  rows: KbPageRow[];
  error: string | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kb_pages")
    .select("*")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as KbPageRow[], error: null };
}

export async function getKbPageBySlug(slug: string): Promise<{
  row: KbPageRow | null;
  error: string | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kb_pages")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: (data as KbPageRow | null) ?? null, error: null };
}

export async function getKbPageById(id: string): Promise<{
  row: KbPageRow | null;
  error: string | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kb_pages")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: (data as KbPageRow | null) ?? null, error: null };
}

/** Recently edited pages, for the landing screen. */
export async function listRecentKbPages(limit = 10): Promise<{
  rows: KbPageRow[];
  error: string | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kb_pages")
    .select("*")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as KbPageRow[], error: null };
}

/** Backlinks: pages that link TO the given page id. */
export async function listBacklinksTo(pageId: string): Promise<{
  rows: Array<Pick<KbPageRow, "id" | "slug" | "title" | "icon">>;
  error: string | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kb_page_links")
    .select("from_page:kb_pages!kb_page_links_from_page_id_fkey(id, slug, title, icon)")
    .eq("to_page_id", pageId);
  if (error) return { rows: [], error: error.message };

  // PostgREST returns the embedded `from_page` as an object for single FKs.
  type Embedded = { from_page: Pick<KbPageRow, "id" | "slug" | "title" | "icon"> | null };
  const rows = ((data ?? []) as unknown as Embedded[])
    .map((r) => r.from_page)
    .filter((p): p is Pick<KbPageRow, "id" | "slug" | "title" | "icon"> => p != null);
  return { rows, error: null };
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export async function createKbPage(input: KbPageCreateInput): Promise<{
  id: string | null;
  slug: string | null;
  error: string | null;
}> {
  const parsed = kbPageCreateSchema.safeParse(input);
  if (!parsed.success) return { id: null, slug: null, error: parsed.error.message };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { id: null, slug: null, error: "Не авторизован" };

  const { data: accountId, error: accErr } = await supabase.rpc("get_active_account_id");
  if (accErr || !accountId) {
    return { id: null, slug: null, error: "Не удалось определить активный аккаунт" };
  }

  // Position = max(siblings) + 1 (per parent). Race-tolerant enough for a
  // KB — collisions only mean two new pages share a position number,
  // which is harmless (sort by position, then created_at as tiebreaker
  // in tree assembly).
  const { data: maxRow } = await supabase
    .from("kb_pages")
    .select("position")
    .eq("account_id", accountId as unknown as string)
    .is("deleted_at", null)
    .filter("parent_id", parsed.data.parent_id ? "eq" : "is", parsed.data.parent_id ?? null)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPosition = (maxRow?.position ?? -1) + 1;

  // Try a few slug candidates if we hit the unique constraint.
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = generateKbSlug();
    const { data, error } = await supabase
      .from("kb_pages")
      .insert({
        account_id: accountId as unknown as string,
        parent_id: parsed.data.parent_id ?? null,
        position: nextPosition,
        title: parsed.data.title?.trim() || "Без названия",
        icon: parsed.data.icon ?? null,
        slug,
        content: [],
        plain_text: "",
        created_by: user.id,
      })
      .select("id, slug")
      .single();

    if (!error && data) {
      revalidatePath("/knowledge");
      return { id: data.id, slug: data.slug, error: null };
    }
    // 23505 = unique_violation; retry only on slug collision.
    if (error && error.code !== "23505") {
      return { id: null, slug: null, error: error.message };
    }
  }
  return { id: null, slug: null, error: "Не удалось сгенерировать уникальный slug" };
}

/**
 * Save a page edit. Atomic via the kb_save_page RPC (migration 052):
 *   1. UPDATE kb_pages with new title/icon/content/plain_text.
 *   2. If content or title changed → insert a kb_page_versions snapshot.
 *   3. Replace kb_page_links rows for from_page_id = id.
 * RPC validates auth/permissions via the same has_permission() helpers
 * the RLS policies use.
 */
export async function saveKbPage(input: KbPageSaveInput): Promise<{
  version_number: number | null;
  error: string | null;
}> {
  const parsed = kbPageSaveSchema.safeParse(input);
  if (!parsed.success) return { version_number: null, error: parsed.error.message };

  // Extract page→page references from the new content. Slugs collected
  // here can't be resolved to IDs without a DB lookup; we resolve them
  // on the server inside the RPC if needed. For MVP we pass only direct
  // pageId references — slug-based links become live backlinks the next
  // time the target page is opened (acceptable trade-off).
  const { pageIds } = extractBacklinks(parsed.data.content);

  const supabase = await createClient();
  // Args cast: supabase-cli's generated signature marks p_icon as
  // non-nullable string and p_content as Json (recursive). Both are
  // actually nullable jsonb in PG; we pass `null` / a plain blocks
  // array and the cast keeps the call ergonomic.
  const { data, error } = await supabase.rpc("kb_save_page", {
    p_id: parsed.data.id,
    p_title: parsed.data.title,
    p_icon: parsed.data.icon ?? null,
    p_content: parsed.data.content as unknown as never,
    p_plain_text: parsed.data.plain_text,
    p_link_targets: pageIds,
  } as never);
  if (error) return { version_number: null, error: error.message };

  revalidatePath("/knowledge");
  revalidatePath(`/knowledge/${parsed.data.id}`);
  return { version_number: (data as number | null) ?? null, error: null };
}

export async function moveKbPage(input: KbPageMoveInput): Promise<{ error: string | null }> {
  const parsed = kbPageMoveSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.message };

  const supabase = await createClient();
  // Cycle prevention is in the DB trigger (migration 048). RLS gates
  // the write. We also defer sibling re-numbering to the client/UI —
  // moving a single page just sets parent_id + position; siblings can
  // share positions without breaking sort order.
  const { error } = await supabase
    .from("kb_pages")
    .update({
      parent_id: parsed.data.parent_id,
      position: parsed.data.position,
    })
    .eq("id", parsed.data.id);
  if (error) return { error: error.message };

  revalidatePath("/knowledge");
  return { error: null };
}

/** Soft delete: cascades to descendants via parent_id ON DELETE CASCADE
 * is for hard delete only. We mark only the targeted page; UI shows
 * children as orphaned subtrees. If the user wants cascade-soft-delete,
 * that's a separate iteration. */
export async function softDeleteKbPage(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Не авторизован" };

  const { error } = await supabase
    .from("kb_pages")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: user.id,
    })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/knowledge");
  return { error: null };
}

export async function restoreKbPage(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("kb_pages")
    .update({ deleted_at: null, deleted_by: null })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/knowledge");
  return { error: null };
}
