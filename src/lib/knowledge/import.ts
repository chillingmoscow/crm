"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { extractBacklinks } from "@/lib/knowledge/backlinks";
import type { KbBlock } from "@/types/knowledge";

/** Один файл, готовый к импорту: уже распарсенный из Markdown в
 *  BlockNote-блоки на клиенте (см. kb-import-dialog.tsx —
 *  BlockNote'овский `markdownToBlocks` требует ProseMirror Schema /
 *  DOM, server-side не работает). Сервер только гейтит permission и
 *  создаёт строки. */
export interface KbImportFileInput {
  /** Имя файла (без расширения превратится в title — если `title` не задан). */
  name: string;
  /** Готовый title — если клиент уже почистил (Notion-импорт срезает
   *  трейлящий `<32-hex>` UUID). Когда задан — используется как есть,
   *  `name` идёт только в логи. */
  title?: string;
  /** Распарсенные BlockNote-блоки. */
  blocks: KbBlock[];
  /** plain-text projection (FTS-индекс). */
  plainText: string;
}

export interface KbImportResultItem {
  id: string;
  slug: string;
  title: string;
}

/** Импорт ОДНОГО markdown-файла как страницы под `parent_id` (NULL = root).
 *
 *  Вызывается клиентом в цикле для каждого выбранного файла —
 *  Next.js Server Actions имеют дефолтный лимит 1MB на body, и пачка
 *  средних .md файлов в одном вызове его быстро пробивает (codex #43 P1).
 *  Per-file pattern: типичный .md << 1MB; результат каждого вызова
 *  агрегируется на клиенте.
 *
 *  Гейтинг — двойной:
 *    - `kb.import_pages` (миграция 069) — отдельное право на импорт
 *      как таковой; рядовые сотрудники (hostess/waiter) не могут
 *      заливать сторонний контент в общую KB.
 *    - `kb.create_pages` — стандартное право создавать страницы
 *      (RLS на kb_pages всё равно его проверит, но мы валидируем
 *      раньше для понятной ошибки).
 *
 *  Position под `parent_id` вычисляется как `max(position) + 1` по
 *  живым siblings — гонка между параллельными вызовами безопасна
 *  (collisions безвредны, sort by position+created_at в дереве).
 */
export async function importKbPageFromMarkdown(input: {
  parent_id: string | null;
  file: KbImportFileInput;
}): Promise<{
  imported: KbImportResultItem | null;
  error: string | null;
}> {
  if (!input.file || !Array.isArray(input.file.blocks)) {
    return { imported: null, error: "Пустой файл" };
  }

  const supabase = await createClient();

  const [{ data: canImport }, { data: canCreate }] = await Promise.all([
    supabase.rpc("has_permission", { permission_code: "kb.import_pages" }),
    supabase.rpc("has_permission", { permission_code: "kb.create_pages" }),
  ]);
  if (!canImport) {
    return { imported: null, error: "Нет права импортировать страницы" };
  }
  if (!canCreate) {
    return { imported: null, error: "Нет права создавать страницы" };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { imported: null, error: "Не авторизован" };

  const { data: accountId, error: accErr } = await supabase.rpc(
    "get_active_account_id",
  );
  if (accErr || !accountId) {
    return { imported: null, error: "Не удалось определить активный аккаунт" };
  }

  const title = input.file.title?.trim() || filenameToTitle(input.file.name);

  // Position = max(siblings под этим parent) + 1.
  const { data: maxRow } = await supabase
    .from("kb_pages")
    .select("position")
    .eq("account_id", accountId as unknown as string)
    .is("deleted_at", null)
    .filter("parent_id", input.parent_id ? "eq" : "is", input.parent_id ?? null)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPosition = (maxRow?.position ?? -1) + 1;

  // Step 1: создаём страницу с базовыми полями (slug retry на 23505).
  let pageId: string | null = null;
  let pageSlug: string | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = generateSlug();
    const { data, error } = await supabase
      .from("kb_pages")
      .insert({
        account_id: accountId as unknown as string,
        parent_id: input.parent_id,
        position: nextPosition,
        title,
        slug,
        content: [],
        plain_text: "",
        created_by: user.id,
      })
      .select("id, slug")
      .single();
    if (!error && data) {
      pageId = data.id;
      pageSlug = data.slug;
      break;
    }
    if (error && error.code !== "23505") {
      return { imported: null, error: error.message };
    }
  }
  if (!pageId || !pageSlug) {
    return { imported: null, error: "Не удалось сгенерировать уникальный slug" };
  }

  // Defensive: гарантируем что свежесозданная страница НЕ заблокирована.
  // Прецедент с импортом Notion-zip'а: импортированные страницы массово
  // получали locked_at != null (root cause не локализован — возможно
  // legacy trigger в чьей-то prod-БД), и kb_save_page (086 strict lock)
  // отвергал любые правки. INSERT по умолчанию должен оставлять
  // locked_at=null, но прямой UPDATE гарантирует это инвариант на любом
  // окружении.
  await supabase
    .from("kb_pages")
    .update({ locked_at: null, locked_by: null })
    .eq("id", pageId);

  // Step 2: заливаем контент через kb_save_page RPC. Тот же путь
  // что у обычного save'а — версионирование, links extraction.
  const { pageIds: linkTargets } = extractBacklinks(input.file.blocks);
  const { error: saveErr } = await supabase.rpc("kb_save_page", {
    p_id: pageId,
    p_title: title,
    p_icon: null,
    p_icon_color: null,
    p_content: input.file.blocks as unknown as never,
    p_plain_text: input.file.plainText,
    p_link_targets: linkTargets,
  } as never);
  if (saveErr) {
    // Страница уже создана как пустая — оставляем, сообщаем что
    // контент не залился. Юзер сможет либо дописать вручную, либо удалить.
    return {
      imported: { id: pageId, slug: pageSlug, title },
      error: `создана, но контент не сохранён — ${saveErr.message}`,
    };
  }

  revalidatePath("/knowledge");
  return { imported: { id: pageId, slug: pageSlug, title }, error: null };
}

/** «my-doc.md» → «my-doc»; «My File (1).markdown» → «My File (1)». */
function filenameToTitle(name: string): string {
  const trimmed = name.trim();
  return trimmed.replace(/\.(md|markdown)$/i, "") || "Без названия";
}

/** Тот же 8-символьный alphabet, что и в lib/knowledge/slug.ts (мы не
 *  импортируем оттуда, чтобы не тащить browser-only deps в server-action).
 */
function generateSlug(): string {
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}
