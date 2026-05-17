import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Notion-style секционный eyebrow над блоками верха KB-страницы
 * («СВОЙСТВА», «КОММЕНТАРИИ»). Дизайн: sheerly.pen → qoPct.
 *
 * `text-[12px]` и `tracking-[0.06em]` взяты напрямую из ноды `qoPct` в sheerly.pen
 * и намеренно расходятся с Caption-строкой дизайн-системы (docs/design-system.md).
 * Тот же стиль eyebrow применён в kb-tree-nav.tsx и kb-trash-client.tsx.
 * Не «исправлять» на токены DS — это отдельный стиль eyebrow, а не Caption.
 */
export function KbSectionLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "px-2 -ml-2 text-[12px] font-medium uppercase tracking-[0.06em] text-muted-foreground/70 leading-none",
        className,
      )}
    >
      {children}
    </div>
  );
}
