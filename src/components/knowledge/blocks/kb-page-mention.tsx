"use client";

import { createReactInlineContentSpec } from "@blocknote/react";

import { KbPageIcon } from "@/components/knowledge/kb-page-icon";

/**
 * Atomic @-mention KB-страницы. Notion-style: иконка страницы + жирный
 * заголовок без link-стилизации; backspace удаляет весь mention целиком,
 * частичная правка текста невозможна.
 *
 * `content: "none"` → ProseMirror trait'ит inline-content как leaf-node
 * (atom). `contentEditable={false}` на render'е — браузер не пускает
 * caret внутрь, текст не редактируется.
 *
 * Markdown-roundtrip через `toExternalHTML`: rendering HTML с
 * `<a href="/knowledge/...">title</a>`, и blocksToMarkdownLossy
 * конвертит это в `[title](/knowledge/slug)` через turndown. На
 * следующий import тот же markdown пока воспринимается как plain link
 * (не upgrade'ится автоматом — для этого нужен per-slug DB-lookup).
 *
 * Persisted props в jsonb: slug, title, icon (lucide-name или emoji),
 * iconColor. Все строки с дефолтом "" — без них render не падает.
 */
export const kbPageMentionInlineContent = createReactInlineContentSpec(
  {
    type: "kbPageMention",
    propSchema: {
      slug: { default: "" },
      title: { default: "" },
      icon: { default: "" },
      iconColor: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ inlineContent }) => {
      const props = inlineContent.props as {
        slug: string;
        title: string;
        icon: string;
        iconColor: string;
      };
      return (
        <a
          href={`/knowledge/${props.slug}`}
          contentEditable={false}
          className="inline-flex items-center gap-1 px-1 py-0.5 rounded text-foreground font-semibold no-underline hover:bg-accent transition-colors"
          // ProseMirror стандартно ставит draggable=true на leaf-node'ы;
          // нам это не нужно (drag-handle на блоке делает то же).
          draggable={false}
          data-kb-page-mention={props.slug}
        >
          <KbPageIcon
            icon={props.icon || null}
            color={props.iconColor || null}
            size={14}
          />
          <span>{props.title || "Без названия"}</span>
        </a>
      );
    },
    // toExternalHTML — что попадает в HTML-export (и далее в markdown
    // через turndown). Внутри редактора render() рендерит chip; в
    // экспорте — обычный link, чтобы получился чистый
    // `[title](/knowledge/slug)` в markdown'е.
    toExternalHTML: ({ inlineContent }) => {
      const props = inlineContent.props as {
        slug: string;
        title: string;
      };
      return (
        <a href={`/knowledge/${props.slug}`}>
          {props.title || "Без названия"}
        </a>
      );
    },
  },
);
