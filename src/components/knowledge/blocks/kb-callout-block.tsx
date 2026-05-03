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
 * Цвета фона — bg-{color}-50/20 (light tint), иконка — text-{color}-600.
 * info и error используют DS-токены (brand, destructive); warning и
 * success — стандартные Tailwind палитру (для них в DS нет semantic
 * tokens, добавим если попросят).
 *
 * content: "inline" → пользователь типит обычный текст внутри плашки.
 */

type CalloutVariant = "info" | "warning" | "success" | "error";

const VARIANT_STYLES: Record<
  CalloutVariant,
  { container: string; icon: string; Icon: typeof Info }
> = {
  info: {
    container: "bg-brand/10 border-brand/20",
    icon: "text-brand",
    Icon: Info,
  },
  warning: {
    container: "bg-yellow-100 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800",
    icon: "text-yellow-700 dark:text-yellow-400",
    Icon: AlertTriangle,
  },
  success: {
    container: "bg-emerald-100 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800",
    icon: "text-emerald-700 dark:text-emerald-400",
    Icon: CheckCircle2,
  },
  error: {
    container: "bg-destructive/10 border-destructive/20",
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
            "flex w-full items-start gap-3 rounded-lg border px-4 py-3",
            styles.container,
          )}
        >
          <span
            className={cn(
              "shrink-0 inline-flex items-center justify-center mt-0.5",
              styles.icon,
            )}
          >
            <Icon className="size-[18px]" />
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
