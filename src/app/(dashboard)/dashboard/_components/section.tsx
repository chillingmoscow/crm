import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { RetryButton } from "@/app/(dashboard)/finance/_components/retry-button";

/**
 * Блок главной — та же карточка, что у секций финансового дашборда:
 * рамка, `bg-card`, заголовок 16/600 и справа переход к полному списку.
 * Содержимое после скелетона мягко всплывает (`motion-rise`, docs/motion.md).
 */
export function HomeSection({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("motion-rise min-w-0 rounded-lg border bg-card p-5", className)} aria-label={title}>
      <div className="mb-4 flex min-h-8 items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-normal">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Переход к полному списку. На телефоне — «Все», чтобы заголовок не переносился. */
export function SectionLink({ href, label, short = "Все" }: { href: string; label: string; short?: string }) {
  return (
    <Button asChild variant="outline" size="sm" className="shrink-0">
      <Link href={href} aria-label={label}>
        <span className="sm:hidden">{short}</span>
        <span className="hidden sm:inline">{label}</span>
        <ArrowRight className="size-4" />
      </Link>
    </Button>
  );
}

/** Скелетон блока по его форме: заголовок виден сразу, строки — серые полосы. */
export function HomeSectionSkeleton({
  title,
  rows = 3,
  avatar = true,
}: {
  title: string;
  rows?: number;
  avatar?: boolean;
}) {
  return (
    <section className="min-w-0 rounded-lg border bg-card p-5" aria-label={title} aria-busy="true">
      <div className="mb-4 flex min-h-8 items-center">
        <h2 className="text-base font-semibold tracking-normal">{title}</h2>
      </div>
      <div className="space-y-4">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            {avatar ? <Skeleton className="size-9 shrink-0 rounded-full" /> : null}
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3.5 w-3/5" />
              <Skeleton className="h-3 w-2/5" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Скелетон полосы показателей: N ячеек с подписью, числом и строкой под ним. */
export function MetricStripSkeleton({ count, label }: { count: number; label: string }) {
  return (
    <section aria-label={label} aria-busy="true">
      <div
        className={cn(
          "grid overflow-hidden rounded-xl border bg-card",
          count === 1 ? "grid-cols-1" : count === 2 ? "grid-cols-2" : "grid-cols-2 md:grid-cols-3",
        )}
      >
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            className={cn(
              "space-y-3 border-r p-4 last:border-r-0 sm:px-6 sm:py-5",
              count === 3 && i === 2 && "col-span-2 md:col-span-1",
            )}
          >
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-32 sm:h-7" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    </section>
  );
}

/** Блок не загрузился: предупреждение и «Повторить» (перечитывает страницу). */
export function BlockError({ what }: { what: string }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
    >
      Не удалось загрузить {what}
      <RetryButton />
    </div>
  );
}

/** Пустое содержимое блока — одна спокойная строка. */
export function BlockEmpty({ children }: { children: ReactNode }) {
  return <p className="py-4 text-center text-sm text-muted-foreground">{children}</p>;
}
