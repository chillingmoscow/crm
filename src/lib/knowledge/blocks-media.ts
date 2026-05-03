import type { KbBlock } from "@/types/knowledge";

/** Заменяет media-блоки (image/file/video/audio) с не-http URL'ами на
 *  текстовый paragraph-placeholder. Используется в двух местах:
 *
 *  1. Markdown-import: external .md часто содержит `![alt](./images/foo.jpg)`
 *     или `![alt](foo.jpg)` — без сопроводительной загрузки файлов в
 *     storage эти ссылки рендерятся как broken-image иконка.
 *
 *  2. Cmd+V из Notion / Confluence / Word: пастится HTML с
 *     `<img src="filename.jpg">` — те же broken-image-иконки.
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
      const isHttp = /^https?:\/\//i.test(url);
      const isKbFile = url.startsWith("kbfile://");
      if (!isHttp && !isKbFile) {
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
