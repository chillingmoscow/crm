import Link from "next/link";
import { ChevronRight, Home } from "lucide-react";

import { cn } from "@/lib/utils";

export interface KbBreadcrumbItem {
  /** Page id (used as React key only). */
  id: string;
  /** URL slug — `/knowledge/${slug}`. */
  slug: string;
  title: string;
  icon: string | null;
}

interface KbBreadcrumbsProps {
  /** Root → leaf, leaf included. The last item renders as the current page. */
  chain: KbBreadcrumbItem[];
  className?: string;
}

/**
 * Breadcrumbs following the Sheerly DS pattern (node E:Xm9Ew /
 * E:KUk4t / E:3s95S): Inter 14, line-height 1.43, foreground for
 * the current item, muted-foreground for ancestors, chevron-right
 * separator from `lucide-react` matching the DS icon shape.
 */
export function KbBreadcrumbs({ chain, className }: KbBreadcrumbsProps) {
  return (
    <nav
      aria-label="Хлебные крошки"
      className={cn(
        "flex items-center gap-2 text-sm leading-[1.4285]",
        className,
      )}
    >
      <Link
        href="/knowledge"
        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
      >
        <Home className="size-3.5" />
        База знаний
      </Link>
      {chain.map((item, idx) => {
        const isLast = idx === chain.length - 1;
        return (
          <span key={item.id} className="flex items-center gap-2 min-w-0">
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
            {isLast ? (
              <span className="truncate text-foreground" data-tip={item.title}>
                {item.icon ? <span className="mr-1">{item.icon}</span> : null}
                {item.title || "Без названия"}
              </span>
            ) : (
              <Link
                href={`/knowledge/${item.slug}`}
                className="truncate text-muted-foreground hover:text-foreground"
                data-tip={item.title}
              >
                {item.icon ? <span className="mr-1">{item.icon}</span> : null}
                {item.title || "Без названия"}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
