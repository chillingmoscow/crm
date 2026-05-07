"use client";

import { cn } from "@/lib/utils";
import { createReactBlockSpec } from "@blocknote/react";

/**
 * Кастомный блок цитаты для KB. По render-DOM МАКСИМАЛЬНО близок к
 * встроенному BN `quote`: пустой `<blockquote ref={contentRef}>` без
 * наших классов и обёрток, чтобы дефолтная BN-стилизация
 * `[data-content-type=quote] blockquote { border-left, color,
 * padding-left }` (см. @blocknote/shadcn/style.css) применялась
 * автоматически и рисовала вертикальную палочку.
 *
 * Единственная функциональная добавка — prop `size: "default" | "large"`.
 * Для large добавляем класс `kb-quote-large`, который только увеличивает
 * font-size + line-height; больше ничего не трогает (border / colour
 * остаются от BN-default'а).
 *
 * Старые блоки с лишним полем `variant` в jsonb props (PR #178)
 * игнорируются BN'ом на парсинге schema — backward-compat.
 */

export type KbQuoteSize = "default" | "large";

export const kbQuoteBlock = createReactBlockSpec(
  {
    type: "quote",
    propSchema: {
      // Сохраняем backgroundColor / textColor — BN-default'ный color-
      // picker на любом блоке имеющем эти props.
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
      // ContentRef прямо на blockquote — никаких обёрток. BN-default
      // CSS получает `<blockquote>` ровно той же формы что у built-in
      // quote, и border-left + color наследуются.
      return (
        <blockquote
          ref={contentRef as unknown as React.Ref<HTMLQuoteElement>}
          className={cn(size === "large" && "kb-quote-large")}
        />
      );
    },
  },
);
