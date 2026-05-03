"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { extractBacklinks } from "@/lib/knowledge/backlinks";
import { extractMentionedUserIds } from "@/lib/knowledge/mention-extract";
import { blocksToMarkdown, escapeMdTitle } from "@/lib/knowledge/blocks-to-markdown";
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

/** Конвертирует страницу (по id) в Markdown-текст.
 *
 *  Гейтинг: помимо стандартного `kb.view_pages` (фильтруется RLS на
 *  чтении row'а), требует **отдельный permission `kb.export_pages`**
 *  — рядовые сотрудники (hostess/waiter) не должны иметь возможность
 *  выгружать интеллектуальную собственность компании наружу. UI уже
 *  скрывает кнопку, но клиент может вызвать server-action напрямую,
 *  поэтому проверяем здесь же. См. миграцию 068. */
export async function exportKbPageAsMarkdown(id: string): Promise<{
  markdown: string | null;
  filename: string | null;
  error: string | null;
}> {
  const supabase = await createClient();
  const { data: canExport } = await supabase.rpc("has_permission", {
    permission_code: "kb.export_pages",
  });
  if (!canExport) {
    return {
      markdown: null,
      filename: null,
      error: "Нет права экспортировать страницы",
    };
  }

  const { row, error } = await getKbPageById(id);
  if (error) return { markdown: null, filename: null, error };
  if (!row) return { markdown: null, filename: null, error: "Страница не найдена" };

  const blocks = (row.content as unknown as import("@/types/knowledge").KbBlock[]) ?? [];
  const title = row.title || "Без названия";
  const body = blocksToMarkdown(blocks);
  // Заголовок страницы сверху как H1. escapeMdTitle экранирует
  // markdown-метасимволы и схлопывает переводы строк — без этого
  // title с `#`, `[`, `]` или `\n` ломал бы heading и структуру файла.
  const md = `# ${escapeMdTitle(title)}\n\n${body}`;

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

  // Fire-and-forget @-mention notifications (Sprint D Phase 4b). RPC
  // `kb_emit_page_mentions` идемпотентна по (page_id, user_id) через
  // PK kb_page_user_mentions — повторные save с тем же mention'ом не
  // спамят. Если упомянутых нет — RPC silent-no-op'ает на пустой
  // массив, не делаем pre-check на клиенте.
  const mentionedUserIds = extractMentionedUserIds(parsed.data.content);
  if (mentionedUserIds.length > 0) {
    void supabase.rpc("kb_emit_page_mentions", {
      p_page_id: parsed.data.id,
      p_user_ids: mentionedUserIds,
    });
  }

  // Fire-and-forget reembedding для RAG. Не блокирует caller'а
  // (auto-save в редакторе должен возвращаться мгновенно). Если
  // SiliconFlow упадёт / API_KEY отсутствует — пропускаем тихо;
  // следующий save попробует ещё раз. Лог в console.error для
  // debug'а, но без toast'а — embedding background-операция, юзер
  // не должен про неё знать. См. src/lib/knowledge/embeddings.ts.
  void (async () => {
    try {
      const { reembedKbPage } = await import("@/lib/knowledge/embeddings");
      const result = await reembedKbPage(parsed.data.id);
      if (result.error) {
        console.warn("[kb] reembed skipped", {
          pageId: parsed.data.id,
          error: result.error,
        });
      }
    } catch (err) {
      console.warn("[kb] reembed crashed", {
        pageId: parsed.data.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();

  // Намеренно НЕ вызываем revalidatePath: server-action call из
  // клиента триггерит RSC-refresh текущего route'а, что в свою очередь
  // меняет row.updated_at → key={id-updated_at} в slug-page → BlockNote
  // remount → закрывается slash-меню прямо во время выбора. Локальный
  // state редактора уже актуальный; дерево/landing подхватят новый
  // title на следующей навигации (приемлемый trade-off для авто-save).
  return { version_number: (data as number | null) ?? null, error: null };
}

/** Атомарно перерасставляет position 0..N-1 для всех siblings в
 *  заданном порядке (drag-drop в дереве). Без этой функции
 *  одиночный moveKbPage оставлял остальных siblings с их старыми
 *  position'ами → tree.ts (sort by (position, title)) при reload
 *  резолвил tie алфавитно, теряя drag-order. См. миграцию 067. */
export async function reorderKbSiblings(
  parentId: string | null,
  orderedIds: string[],
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("kb_reorder_siblings", {
    p_parent_id: parentId,
    p_ordered_ids: orderedIds,
  });
  if (error) return { error: error.message };
  revalidatePath("/knowledge");
  return { error: null };
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

/** Атомарный move-with-reorder через RPC `kb_move_page` (миграция 073).
 *  Используется UI drag-n-drop — за один RPC меняет parent_id +
 *  пересчитывает position всех siblings под новым родителем.
 *
 *  Преимущество над двумя последовательными RPC (moveKbPage + reorder):
 *    1. Atomicity — либо вся операция применилась, либо ни одна
 *       (PG-функция implicit-transaction). Без этого drag со сбоем
 *       мог оставить страницу с новым parent_id, но старыми
 *       position'ами → визуальный скачок после reload.
 *    2. Cycle check на server-side — нельзя сделать ancestor собственным
 *       потомком. UI-проверка может быть обойдена через crafted
 *       request, server гарантирует.
 *
 *  newSiblingOrder: список ВСЕХ siblings под newParentId, ВКЛЮЧАЯ
 *  сам id на новой позиции. Caller (UI) вычисляет это локально из
 *  optimistic-tree-state. */
export async function moveKbPageInTree(input: {
  id: string;
  newParentId: string | null;
  newSiblingOrder: string[];
}): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: status, error } = await supabase.rpc("kb_move_page", {
    p_id: input.id,
    p_new_parent_id: input.newParentId,
    p_new_sibling_order: input.newSiblingOrder,
  });
  if (error) return { error: error.message };

  const result = (status as unknown as string) ?? "unknown";
  if (result !== "ok") {
    const messages: Record<string, string> = {
      cycle: "Нельзя поместить страницу внутрь её же потомка",
      no_page: "Страница не найдена",
      no_parent: "Родительская страница не найдена",
      wrong_account: "Конфликт данных — обновите страницу",
      forbidden: "Нет права перемещать страницы",
    };
    return { error: messages[result] ?? `Move failed: ${result}` };
  }

  revalidatePath("/knowledge");
  return { error: null };
}

/** Cascade duplicate: создаёт копию страницы + всего поддерева
 *  живых потомков. Title корня получает суффикс « (копия)»,
 *  attachments копируются как pivot-references на те же
 *  account_files. Версии и backlinks НЕ копируются. См. миграцию 064. */
export async function duplicateKbPage(
  id: string,
): Promise<{ slug: string | null; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("kb_duplicate_cascade", { p_id: id });
  if (error) return { slug: null, error: error.message };

  // RPC возвращает table → массив строк. Берём первую (одна по контракту).
  const row = (data as Array<{ new_id: string; new_slug: string }> | null)?.[0];
  if (!row) return { slug: null, error: "Не удалось получить slug копии" };

  revalidatePath("/knowledge");
  return { slug: row.new_slug, error: null };
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

/** Admin toggle «заблокировать страницу для редактирования» (Notion-
 *  стиль защиты от случайных правок). Sprint D Phase 3.
 *
 *  Backed by RPC `kb_set_page_lock` (миграция 078, security definer).
 *  Прямой `update kb_pages` не работает: RLS-policy `kb_pages_update`
 *  (миграция 055) требует `kb.edit_any_page` / `kb.edit_own_pages` /
 *  `kb.delete_pages`. Manager получает только `kb.lock_pages`, но НЕ
 *  edit-permission'ы — без RPC он видел бы toggle, а UPDATE реджектился
 *  бы RLS. См. Codex #59 P1.
 *
 *  При locked=true → RPC пишет locked_at=now() + locked_by=auth.uid().
 *  При locked=false → обнуляет оба. Audit-event `kb_page.locked` /
 *  `kb_page.unlocked` пишется триггером (миграция 082).
 *
 *  RPC kb_save_page (с миграции 078) отвергает save на locked-странице
 *  если caller не имеет kb.lock_pages — это backend-enforcement поверх
 *  UI-readonly режима. */
export async function setKbPageLock(input: {
  pageId: string;
  locked: boolean;
}): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("kb_set_page_lock", {
    p_page_id: input.pageId,
    p_locked: input.locked,
  });
  if (error) return { error: error.message };

  revalidatePath(`/knowledge`);
  return { error: null };
}
