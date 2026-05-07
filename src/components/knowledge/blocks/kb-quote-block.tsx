"use client";

import { cn } from "@/lib/utils";
import { createReactBlockSpec } from "@blocknote/react";

/**
 * Кастомный блок цитаты для KB. Заменяет встроенный `quote` BlockNote
 * (который умеет только textColor/backgroundColor) — добавляет один
 * prop `size: "default" | "large"`.
 *
 * Оформление всегда классическое Notion-style — серая вертикальная
 * палочка слева + regular text. Раньше был ещё «typographic quotes»
 * variant с большими „ " на псевдоэлементах, но мы отказались (PR #178
 * фидбек): курсив + ёлочки выглядели чужеродно в общепитовском KB.
 *
 * Хранение пропов: `size` (default/large) + унаследованные от built-in
 * `quote` `backgroundColor` / `textColor`. Старые документы со полем
 * `variant` в jsonb просто игнорируют его (BN отбрасывает неизвестные
 * props на парсинге schema).
 */

export type KbQuoteSize = "default" | "large";

export const kbQuoteBlock = createReactBlockSpec(
  {
    type: "quote",
    propSchema: {
      // Сохраняем backgroundColor / textColor — у Notion-стиля цитата
      // тоже может быть тинтованной, и BN-default'ный color-picker
      // в side-menu / formatting-toolbar умеет с этим работать на любом
      // блоке имеющем эти props.
      backgroundColor: { default: "default" as const },
      textColor: { default: "default" as const },
      size: {
        default: "default" as const,
        values: ["default", "large"] as const,
      },
    },
    content: "inline",
  },
  {
    render: ({ block, contentRef }) => {
      const size = (block.props.size as KbQuoteSize) ?? "default";
      return (
        <blockquote
          data-quote-size={size}
          className={cn(
            "kb-quote kb-quote--line w-full m-0",
            size === "large" && "kb-quote--large",
          )}
        >
          <span ref={contentRef} className="kb-quote__content" />
        </blockquote>
      );
    },
  },
);
