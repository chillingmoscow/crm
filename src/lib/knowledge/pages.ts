"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { extractBacklinks } from "@/lib/knowledge/backlinks";
import { blocksToMarkdown } from "@/lib/knowledge/blocks-to-markdown";
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

/** Trash list row — slim проекция KbPageRow (без content/plain_text/
 *  search_tsv), чтобы не вытаскивать тяжёлый jsonb для каждой
 *  каскадно-удалённой страницы (см. Codex #32 P2). */
export type KbDeletedPageRow = Pick<
  KbPageRow,
  | "id"
  | "account_id"
  | "parent_id"
  | "position"
  | "title"
  | "icon"
  | "icon_color"
  | "slug"
  | "deleted_at"
  | "deleted_by"
  | "deleted_root_id"
  | "created_by"
  | "created_at"
  | "updated_at"
  | "updated_by"
> & { descendants_count: number };

/** Direct-delete roots в корзине. Каскадно-удалённые потомки
 * (deleted_root_id != id) не показываются — они вернутся вместе
 * с родителем при restore. RLS hides эти строки от пользователей
 * без `kb.delete_pages` (см. миграцию 050 §3).
 *
 * Перформанс: тянем только метаданные (без content jsonb / plain_text /
 * search_tsv), а cascade-дочерние строки фетчим отдельным узким
 * запросом — только колонку deleted_root_id для подсчёта counts.
 * После большого subtree-delete страница /knowledge/trash раньше
 * десериализовала весь content каждого hidden descendant'а только
 * чтобы посчитать одну цифру. */
export async function listDeletedKbPages(): Promise<{
  rows: KbDeletedPageRow[];
  error: string | null;
}> {
  const supabase = await createClient();
  const slim =
    "id, account_id, parent_id, position, title, icon, icon_color, slug, deleted_at, deleted_by, deleted_root_id, created_by, created_at, updated_at, updated_by";

  // Узкий запрос за всеми soft-deleted мета-строками (без heavy jsonb).
  // Roots vs cascade-children разруливаем в JS (PostgREST нативно не
  // умеет «col_a = col_b» в фильтре).
  const { data, error } = await supabase
    .from("kb_pages")
    .select(slim)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (error) return { rows: [], error: error.message };

  const all = (data ?? []) as KbDeletedPageRow[];
  const cascadeByRoot = new Map<string, number>();
  for (const r of all) {
    if (r.deleted_root_id && r.deleted_root_id !== r.id) {
      cascadeByRoot.set(
        r.deleted_root_id,
        (cascadeByRoot.get(r.deleted_root_id) ?? 0) + 1,
      );
    }
  }
  const roots = all
    .filter((r) => !r.deleted_root_id || r.deleted_root_id === r.id)
    .map((r) => ({ ...r, descendants_count: cascadeByRoot.get(r.id) ?? 0 }));
  return { rows: roots, error: null };
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

/** Конвертирует страницу (по id) в Markdown-текст. RLS уже фильтрует
 *  доступ к row'у — экспорт даёт ровно столько, сколько юзер может
 *  прочитать через `kb.view_pages`. */
export async function exportKbPageAsMarkdown(id: string): Promise<{
  markdown: string | null;
  filename: string | null;
  error: string | null;
}> {
  const { row, error } = await getKbPageById(id);
  if (error) return { markdown: null, filename: null, error };
  if (!row) return { markdown: null, filename: null, error: "Страница не найдена" };

  const blocks = (row.content as unknown as import("@/types/knowledge").KbBlock[]) ?? [];
  const title = row.title || "Без названия";
  const body = blocksToMarkdown(blocks);
  // Заголовок страницы сверху как H1, потом тело.
  const md = `# ${title}\n\n${body}`;

  // Файлнейм: slug + .md. Slug URL-safe by design (см. lib/knowledge/slug.ts).
  return { markdown: md, filename: `${row.slug}.md`, error: null };
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
  rows: Array<Pick<KbPageRow, "id" | "slug" | "title" | "icon" | "icon_color">>;
  error: string | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kb_page_links")
    .select("from_page:kb_pages!kb_page_links_from_page_id_fkey(id, slug, title, icon, icon_color)")
    .eq("to_page_id", pageId);
  if (error) return { rows: [], error: error.message };

  // PostgREST returns the embedded `from_page` as an object for single FKs.
  type Embedded = { from_page: Pick<KbPageRow, "id" | "slug" | "title" | "icon" | "icon_color"> | null };
  const rows = ((data ?? []) as unknown as Embedded[])
    .map((r) => r.from_page)
    .filter((p): p is Pick<KbPageRow, "id" | "slug" | "title" | "icon" | "icon_color"> => p != null);
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
    p_icon_color: parsed.data.icon_color ?? null,
    p_content: parsed.data.content as unknown as never,
    p_plain_text: parsed.data.plain_text,
    p_link_targets: pageIds,
  } as never);
  if (error) return { version_number: null, error: error.message };

  // Намеренно НЕ вызываем revalidatePath: server-action call из
  // клиента триггерит RSC-refresh текущего route'а, что в свою очередь
  // меняет row.updated_at → key={id-updated_at} в slug-page → BlockNote
  // remount → закрывается slash-меню прямо во время выбора. Локальный
  // state редактора уже актуальный; дерево/landing подхватят новый
  // title на следующей навигации (приемлемый trade-off для авто-save).
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

/** Cascade soft-delete: помечает страницу + всех её живых потомков.
 *  Все они получают одинаковые deleted_at/by + deleted_root_id = id.
 *  Иерархия parent_id потомков не меняется → restore возвращает дерево
 *  ровно в той же форме. См. миграцию 063. */
export async function softDeleteKbPage(
  id: string,
): Promise<{ deleted: number; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kb_soft_delete_cascade", { p_id: id });
  if (error) return { deleted: 0, error: error.message };

  revalidatePath("/knowledge");
  return { deleted: (data as number | null) ?? 0, error: null };
}

/** Cascade restore: возвращает страницу + все строки, удалённые с ней
 *  каскадом (deleted_root_id = id). Иерархия восстанавливается ровно
 *  как была. */
export async function restoreKbPage(
  id: string,
): Promise<{ restored: number; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kb_restore_cascade", { p_id: id });
  if (error) return { restored: 0, error: error.message };

  revalidatePath("/knowledge");
  return { restored: (data as number | null) ?? 0, error: null };
}
