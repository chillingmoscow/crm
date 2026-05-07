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

      // Один контейнер с data-* атрибутами: всю стилизацию делаем в
      // globals.css по селекторам [data-quote-variant] / [data-quote-size].
      // Так Tailwind покрывает базовый layout, а сложные псевдоэлементы
      // с большими кавычками-«ёлочками» — чистый CSS (в JSX псевдо-
      // элементы не вписать без лишних DOM-узлов).
      return (
        <blockquote
          data-quote-variant={variant}
          data-quote-size={size}
          className={cn(
            "kb-quote w-full m-0",
            // Базовые классы — рантайм, без зависимостей от data-*.
            // Конкретные visual-decorations (палочка / кавычки) живут
            // в globals.css.
            variant === "line" && "kb-quote--line",
            variant === "quotes" && "kb-quote--quotes",
            size === "large" && "kb-quote--large",
          )}
        >
          <div
            ref={contentRef}
            className="kb-quote__content flex-1 min-w-0 [&>p]:m-0"
          />
        </blockquote>
      );
    },
  },
);
