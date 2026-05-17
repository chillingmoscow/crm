import Link from "next/link";

import { cn } from "@/lib/utils";
import type { KbAuditCountKey } from "@/lib/knowledge/audit-kinds";

const CHIPS: { key: KbAuditCountKey; label: string }[] = [
  { key: "all", label: "Все события" },
  { key: "created", label: "Создание" },
  { key: "deleted", label: "Удаление" },
  { key: "moved", label: "Перемещение" },
];

/** Чипы-фильтры журнала по типу события (`?kind=`). Ссылочная
 *  навигация — server-component перечитывает searchParam. Смена
 *  фильтра сбрасывает keyset-пагинацию (новый `?kind` без курсора).
 *  Дизайн — sheerly.pen `gd7E2` filterRow. */
export function KbAuditFilterChips({
  current,
  counts,
}: {
  current: KbAuditCountKey;
  counts: Record<KbAuditCountKey, number>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {CHIPS.map((chip) => {
        const isActive = chip.key === current;
        const href =
          chip.key === "all"
            ? "/knowledge/audit"
            : `/knowledge/audit?kind=${chip.key}`;
        return (
          <Link
            key={chip.key}
            href={href}
            scroll={false}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              isActive
                ? "bg-brand text-white"
                : "bg-secondary text-foreground hover:bg-accent",
            )}
          >
            {chip.label}
            <span
              className={cn(
                "tabular-nums",
                isActive ? "text-white/70" : "text-muted-foreground",
              )}
            >
              {counts[chip.key]}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
