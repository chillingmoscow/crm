import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Палитра статусов (design-system § «Статусные бейджи»): один рецепт на обе
 * темы, `bg-{c}-500/10` + `text-{c}-700 dark:text-{c}-400`, без рамки.
 */
export const statusTones = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-brand/10 text-brand",
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  danger: "bg-destructive/10 text-destructive",
  accent: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
} as const;

export type StatusTone = keyof typeof statusTones;

/**
 * Статус — pill 12px / 500. Единственный способ показать статус: самодельные
 * `span`, `Badge variant` и свои палитры для статусов не используются.
 */
export function StatusBadge({
  tone = "neutral",
  icon,
  children,
  className,
}: {
  tone?: StatusTone;
  /** Иконка 12px перед текстом, если без неё статус путается с соседним. */
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium [&_svg]:size-3 [&_svg]:shrink-0",
        statusTones[tone],
        className,
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}
