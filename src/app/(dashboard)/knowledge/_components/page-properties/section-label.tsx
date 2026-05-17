import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Notion-style секционный eyebrow над блоками верха KB-страницы
 * («СВОЙСТВА», «КОММЕНТАРИИ»). Дизайн: sheerly.pen → qoPct.
 * Caption-шкала DS (12px/500) в uppercase + tracking, muted.
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
