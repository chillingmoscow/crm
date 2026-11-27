"use client";

import { Info, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { createReactBlockSpec } from "@blocknote/react";

/**
 * Callout-блок для KB. Альтернатива multi-column колонкам — для
 * регламентов важнее «выделить предупреждение/совет» чем положить
 * две колонки рядом.
 *
 * 4 варианта (variant prop):
 *  - info     → синяя плашка, иконка Info
 *  - warning  → жёлтая, AlertTriangle
 *  - success  → зелёная, CheckCircle
 *  - error    → красная (destructive из DS), XCircle
 *
 * Цвета — рецепт статусной палитры DS (одинаково в обеих темах):
 * подложка `{c}-500/10` без рамки, значок тона (docs/design-system.md →
 * «Статусные бейджи», «База знаний»).
 *
 * content: "inline" → пользователь типит обычный текст внутри плашки.
 */

type CalloutVariant = "info" | "warning" | "success" | "error";

const VARIANT_STYLES: Record<
  CalloutVariant,
  { container: string; icon: string; Icon: typeof Info }
> = {
  info: {
    container: "bg-brand/10",
    icon: "text-brand",
    Icon: Info,
  },
  warning: {
    container: "bg-amber-500/10",
    icon: "text-amber-700 dark:text-amber-400",
    Icon: AlertTriangle,
  },
  success: {
    container: "bg-emerald-500/10",
    icon: "text-emerald-700 dark:text-emerald-400",
    Icon: CheckCircle2,
  },
  error: {
    container: "bg-destructive/10",
    icon: "text-destructive",
    Icon: XCircle,
  },
};

export const kbCalloutBlock = createReactBlockSpec(
  {
    type: "callout",
    propSchema: {
      variant: {
        default: "info" as const,
        values: ["info", "warning", "success", "error"] as const,
      },
    },
    content: "inline",
  },
  {
    render: ({ block, contentRef }) => {
      const variant = (block.props.variant as CalloutVariant) ?? "info";
      const styles = VARIANT_STYLES[variant];
      const Icon = styles.Icon;
      return (
        <div
          className={cn(
            "flex w-full items-start gap-3 rounded-lg px-3.5 py-3",
            styles.container,
          )}
        >
          <span
            className={cn(
              "shrink-0 inline-flex items-center justify-center mt-0.5",
              styles.icon,
            )}
          >
            <Icon className="size-4" />
          </span>
          {/* contentRef — куда BlockNote рендерит inline-content
              ProseMirror'а. Без него callout будет неэдитируемым. */}
          <div
            ref={contentRef}
            className="flex-1 min-w-0 leading-relaxed [&>p]:m-0"
          />
        </div>
      );
    },
  },
);
