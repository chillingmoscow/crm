import type { KbBlock } from "@/types/knowledge";

/** URL'ы, которые BlockNote рендерит без обращения в наше storage.
 *  Всё остальное (`./foo.jpg`, `bar.png`, `file:///…`, и т.п.) — broken,
 *  заменяем на текстовый placeholder. */
const VALID_MEDIA_URL_RE = /^(https?:\/\/|data:|blob:|kbfile:\/\/)/i;

/** Заменяет media-блоки (image/file/video/audio) с не-валидными URL'ами
 *  на текстовый paragraph-placeholder. Используется в двух местах:
 *
 *  1. Markdown-import: external .md часто содержит `![alt](./images/foo.jpg)`
 *     или `![alt](foo.jpg)` — без сопроводительной загрузки файлов в
 *     storage эти ссылки рендерятся как broken-image иконка.
 *
 *  2. Cmd+V из Notion / Confluence / Word: пастится HTML с
 *     `<img src="filename.jpg">` — те же broken-image-иконки.
 *
 *  Что считаем валидным (НЕ заменяем):
 *    • `https?://…` — обычные external URLs
 *    • `kbfile://…` — наши uploaded в storage attachments
 *    • `data:…` — inline base64 (Notion / Obsidian экспортируют
 *      screenshots так; всё нужное уже в URL'е, ничего fetch'ить не надо).
 *      См. Codex #50 P2.
 *    • `blob:…` — object-URL'ы (на случай интеграций с file-pickers)
 *
 *  Альтернатива (zip-import с media-приложениями ИЛИ удалённый fetch
 *  оригинала по relative path) — отдельная фича. Здесь — defensive
 *  placeholder, чтобы UX не выглядел как ломаная страница.
 *
 *  Рекурсивно обходим children (nested-блоки типа toggle/table). */
export function rewriteBrokenMediaBlocks(
  blocks: KbBlock[],
  /** Префикс для placeholder-текста — "из импорта" или "из вставки",
   *  чтобы юзер понимал, какой workflow создал заглушку. */
  labelPrefix = "Изображение из импорта",
): KbBlock[] {
  return blocks.map((block) => {
    const b = block as unknown as {
      type?: string;
      props?: { url?: string; name?: string; caption?: string };
      children?: unknown[];
    };
    const isMedia =
      b.type === "image" ||
      b.type === "file" ||
      b.type === "video" ||
      b.type === "audio";
    if (isMedia) {
      const url = (b.props?.url ?? "").trim();
      if (!VALID_MEDIA_URL_RE.test(url)) {
        const label =
          b.props?.name?.trim() ||
          b.props?.caption?.trim() ||
          (url ? url.split("/").pop() : null) ||
          "вложение";
        return {
          type: "paragraph",
          props: {},
          content: [
            {
              type: "text",
              text: `[${labelPrefix}: ${label}]`,
              styles: { italic: true },
            },
          ],
          children: [],
        } as unknown as KbBlock;
      }
    }
    if (Array.isArray(b.children) && b.children.length > 0) {
      return {
        ...block,
        children: rewriteBrokenMediaBlocks(
          b.children as KbBlock[],
          labelPrefix,
        ),
      } as KbBlock;
    }
    return block;
  });
}

/** Достаёт все relative-URL'ы из media-блоков (image/file/video/audio).
 *  Используется markdown-импортером: после парсинга .md сразу видно,
 *  какие файлы упоминаются — это даёт возможность сматчить их с
 *  отдельно загруженными image-файлами и подменить URL на kbfile://
 *  до того, как блоки уйдут в kb_save_page. См. kb-import-dialog.tsx. */
export function collectRelativeMediaRefs(blocks: KbBlock[]): string[] {
  const out: string[] = [];
  const visit = (bs: KbBlock[]) => {
    for (const block of bs) {
      const b = block as unknown as {
        type?: string;
        props?: { url?: string };
        children?: unknown[];
      };
      const isMedia =
        b.type === "image" ||
        b.type === "file" ||
        b.type === "video" ||
        b.type === "audio";
      if (isMedia) {
        const url = (b.props?.url ?? "").trim();
        if (url && !VALID_MEDIA_URL_RE.test(url)) out.push(url);
      }
      if (Array.isArray(b.children) && b.children.length > 0) {
        visit(b.children as KbBlock[]);
      }
    }
  };
  visit(blocks);
  return out;
}

/** Подменяет URL'ы media-блоков по mapping (basename → kbfile://...).
 *  Применяется ПЕРЕД rewriteBrokenMediaBlocks: сначала рулим matched-
 *  refs в живые URL'ы, потом placeholder'им то, что не сматчилось. */
export function applyMediaUrlMap(
  blocks: KbBlock[],
  urlMap: Map<string, string>,
): KbBlock[] {
  return blocks.map((block) => {
    const b = block as unknown as {
      type?: string;
      props?: { url?: string };
      children?: unknown[];
    };
    const isMedia =
      b.type === "image" ||
      b.type === "file" ||
      b.type === "video" ||
      b.type === "audio";
    if (isMedia) {
      const url = (b.props?.url ?? "").trim();
      if (url && !VALID_MEDIA_URL_RE.test(url)) {
        // Decode percent-encoding в basename, чтобы матчиться с
        // нормализованными ключами `urlMap` (см. kb-import-dialog).
        // Без этого `My%20Image.png` не сматчится с ключом
        // `my image.png`. Codex #66 P2.
        const rawBasename = url.split(/[/\\]/).pop() ?? "";
        let decoded: string;
        try {
          decoded = decodeURIComponent(rawBasename);
        } catch {
          decoded = rawBasename;
        }
        const basename = decoded.toLowerCase();
        const replacement = basename ? urlMap.get(basename) : undefined;
        if (replacement) {
          return {
            ...block,
            props: { ...(b.props ?? {}), url: replacement },
          } as KbBlock;
        }
      }
    }
    if (Array.isArray(b.children) && b.children.length > 0) {
      return {
        ...block,
        children: applyMediaUrlMap(b.children as KbBlock[], urlMap),
      } as KbBlock;
    }
    return block;
  });
}

/** HTML-уровневая чистка пастящегося контента (Cmd+V из Notion / Word /
 *  Confluence). Заменяет `<img>` с не-валидным `src` на курсивный
 *  paragraph-placeholder ПРЯМО в HTML-строке.
 *
 *  Зачем строкой, а не через parse → blocks → rewrite: при пасте важно
 *  сохранить **точку вставки** (caret position и selection-replacement).
 *  BlockNote'овский `editor.pasteHTML(html)` делает это правильно — но
 *  только если мы скармливаем ему чистый HTML. Если разворачивать в
 *  blocks и звать `insertBlocks(…, "after")`, ломаем core-семантику пасты
 *  (regression flagged Codex'ом на PR #56).
 *
 *  `<video>` / `<audio>` в clipboard-HTML практически не встречаются
 *  (Notion / Word не экспортируют их в clipboard), поэтому обрабатываем
 *  только `<img>`. Для markdown-импорта остаётся блочный
 *  `rewriteBrokenMediaBlocks` выше. */
export function stripBrokenImgInHtml(
  html: string,
  labelPrefix = "Изображение из вставки",
): string {
  return html.replace(/<img\b[^>]*>/gi, (match) => {
    const srcMatch = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(match);
    const src = (srcMatch?.[1] ?? srcMatch?.[2] ?? "").trim();
    if (!src || VALID_MEDIA_URL_RE.test(src)) return match;
    const altMatch = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(match);
    const alt = (altMatch?.[1] ?? altMatch?.[2] ?? "").trim();
    const label = alt || src.split("/").pop() || "вложение";
    // Escape — чтобы alt-текст с символами `<`, `&`, `"` не сломал HTML.
    const safeLabel = label
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    return `<p><em>[${labelPrefix}: ${safeLabel}]</em></p>`;
  });
}

/** Detector — есть ли в HTML хотя бы один `<img>` с невалидным src.
 *  Cheap pre-filter в pasteHandler, чтобы не запускать строковый replace
 *  на каждый paste — только на потенциально проблемный. */
export function htmlHasBrokenImg(html: string): boolean {
  const imgMatches = html.match(/<img\b[^>]*>/gi);
  if (!imgMatches) return false;
  for (const tag of imgMatches) {
    const srcMatch = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const src = (srcMatch?.[1] ?? srcMatch?.[2] ?? "").trim();
    if (src && !VALID_MEDIA_URL_RE.test(src)) return true;
  }
  return false;
}
