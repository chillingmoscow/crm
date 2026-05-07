"use client";

import { cn } from "@/lib/utils";
import { createReactBlockSpec } from "@blocknote/react";

/**
 * Кастомный блок цитаты для KB. Заменяет встроенный `quote` BlockNote
 * (который умеет только textColor/backgroundColor + всегда фиксированный
 * вертикальный border-left). Наш блок добавляет два независимых
 * измерения вариативности:
 *
 *   • size:    "default" | "large"  — крупность шрифта
 *   • variant: "line"    | "quotes" — оформление
 *
 * variant-line — классическая Notion-style цитата: серая вертикальная
 * палочка + текст обычным regular. variant-quotes — типографская:
 * текст курсивом, по краям крупные «ёлочки» „ "; у large размер у
 * кавычек тоже растёт.
 *
 * Хранение пропов идентично built-in `quote` плюс наши два — сохраняется
 * совместимость со старыми документами: rendered as variant=line size=
 * default по умолчанию, что эквивалентно прежнему виду цитаты.
 *
 * Side-menu items для смены props живут в kb-side-menu.tsx
 * (KbQuoteOptionsItems) — стандартная BN-механика отдельной от render'а.
 */

export type KbQuoteSize = "default" | "large";
export type KbQuoteVariant = "line" | "quotes";

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
      variant: {
        default: "line" as const,
        values: ["line", "quotes"] as const,
      },
    },
    content: "inline",
  },
  {
    render: ({ block, contentRef }) => {
      const size = (block.props.size as KbQuoteSize) ?? "default";
      const variant = (block.props.variant as KbQuoteVariant) ?? "line";

      // contentRef — `<span>`, а не `<div>`. Для variant=quotes нужно,
      // чтобы псевдоэлементы `::before` / `::after` blockquote'а
      // обтекали inline-content (большие „ " по краям одной строки
      // текста), а не вставали на отдельных строках вокруг block-level
      // обёртки. inline-content BN рендерится в любой узел —
      // span работает идентично div'у.
      return (
        <blockquote
          data-quote-variant={variant}
          data-quote-size={size}
          className={cn(
            "kb-quote w-full m-0",
            variant === "line" && "kb-quote--line",
            variant === "quotes" && "kb-quote--quotes",
            size === "large" && "kb-quote--large",
          )}
        >
          <span ref={contentRef} className="kb-quote__content" />
        </blockquote>
      );
    },
  },
);
