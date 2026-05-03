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
  /** Имя файла (без расширения превратится в title). */
  name: string;
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

/** Импорт N markdown-файлов в KB. Каждый становится отдельной
 *  страницей под `parent_id` (NULL = root).
 *
 *  Гейтинг — двойной:
 *    - `kb.import_pages` (миграция 069) — отдельное право на импорт
 *      как таковой; рядовые сотрудники (hostess/waiter) не могут
 *      заливать сторонний контент в общую KB.
 *    - `kb.create_pages` — стандартное право создавать страницы
 *      (RLS на kb_pages всё равно его проверит, но мы валидируем
 *      раньше для понятной ошибки).
 *
 *  Транзакционности по всей пачке нет (Supabase-JS не даёт BEGIN/COMMIT
 *  через REST), но каждая страница создаётся атомарной парой INSERT
 *  + (если есть link_targets) `kb_save_page` RPC. Если на N-ном файле
 *  что-то падает — возвращаем массив уже-созданных + error-message;
 *  пользователь видит, какие страницы прошли, какие надо повторить. */
export async function importKbPagesFromMarkdown(input: {
  parent_id: string | null;
  files: KbImportFileInput[];
}): Promise<{
  imported: KbImportResultItem[];
  error: string | null;
}> {
  if (!Array.isArray(input.files) || input.files.length === 0) {
    return { imported: [], error: "Не выбрано ни одного файла" };
  }

  const supabase = await createClient();

  const [{ data: canImport }, { data: canCreate }] = await Promise.all([
    supabase.rpc("has_permission", { permission_code: "kb.import_pages" }),
    supabase.rpc("has_permission", { permission_code: "kb.create_pages" }),
  ]);
  if (!canImport) {
    return { imported: [], error: "Нет права импортировать страницы" };
  }
  if (!canCreate) {
    return { imported: [], error: "Нет права создавать страницы" };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { imported: [], error: "Не авторизован" };

  const { data: accountId, error: accErr } = await supabase.rpc(
    "get_active_account_id",
  );
  if (accErr || !accountId) {
    return { imported: [], error: "Не удалось определить активный аккаунт" };
  }

  // Position = max(siblings под этим parent) + 1, +n для последующих
  // файлов в той же пачке. Один SELECT на всю пачку, не на каждый файл.
  const { data: maxRow } = await supabase
    .from("kb_pages")
    .select("position")
    .eq("account_id", accountId as unknown as string)
    .is("deleted_at", null)
    .filter("parent_id", input.parent_id ? "eq" : "is", input.parent_id ?? null)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextPosition = (maxRow?.position ?? -1) + 1;

  const imported: KbImportResultItem[] = [];

  for (const file of input.files) {
    const title = filenameToTitle(file.name);

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
        return {
          imported,
          error: `«${title}»: ${error.message}`,
        };
      }
    }
    if (!pageId || !pageSlug) {
      return { imported, error: `«${title}»: не удалось сгенерировать slug` };
    }

    // Step 2: заливаем контент через kb_save_page RPC. Тот же путь
    // что у обычного save'а — версионирование, links extraction.
    const { pageIds: linkTargets } = extractBacklinks(file.blocks);
    const { error: saveErr } = await supabase.rpc("kb_save_page", {
      p_id: pageId,
      p_title: title,
      p_icon: null,
      p_icon_color: null,
      p_content: file.blocks as unknown as never,
      p_plain_text: file.plainText,
      p_link_targets: linkTargets,
    } as never);
    if (saveErr) {
      // Страница уже создана как пустая — оставляем её и сообщаем,
      // что content не залился. Юзер сможет либо дописать вручную,
      // либо удалить.
      return {
        imported: [...imported, { id: pageId, slug: pageSlug, title }],
        error: `«${title}»: создана, но контент не сохранён — ${saveErr.message}`,
      };
    }

    imported.push({ id: pageId, slug: pageSlug, title });
    nextPosition += 1;
  }

  revalidatePath("/knowledge");
  return { imported, error: null };
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
