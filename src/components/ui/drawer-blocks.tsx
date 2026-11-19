/* eslint-disable @next/next/no-img-element */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { personInitials } from "@/lib/format/initials";

/**
 * Блоки содержимого боковой панели (EditDrawer). Правила — в
 * docs/design-system.md § «Боковая панель».
 *
 * - DrawerSection — плоский раздел: крупный заголовок и воздух сверху,
 *   без линий, рамок и фона.
 * - DrawerSummary / DrawerSummaryItem — единственная сводная плашка в
 *   панели просмотра: главное о сущности. DrawerSummaryTotal — крупная
 *   ключевая сумма первой строкой сводки.
 * - DrawerStatus — статус рядом с заголовком панели (titleAccessory).
 * - DrawerTimeline / DrawerTimelineItem — история изменений и события.
 */

export function DrawerSection({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        // Разделы разводим воздухом и крупным заголовком, без линий:
        // линии между каждым блоком шумят (решение 2026-11-17).
        "mt-4 space-y-4 first:mt-0",
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            {title && <h3 className="text-base font-semibold leading-snug">{title}</h3>}
            {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function DrawerSummary({
  children,
  label,
  className,
}: {
  children: ReactNode;
  /** Подпись для скринридера, например «Данные смены». */
  label?: string;
  className?: string;
}) {
  return (
    <section aria-label={label} className={cn("rounded-lg border bg-card p-4", className)}>
      <dl className="grid gap-3">{children}</dl>
    </section>
  );
}

/** Строка сводки: плитка-иконка (или аватар) 32px, подпись сверху, значение. */
export function DrawerSummaryItem({
  icon,
  avatar,
  label,
  children,
  action,
}: {
  icon: ReactNode;
  /** icon — это DrawerAvatar: без плитки под ним. */
  avatar?: boolean;
  label?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span
        aria-hidden="true"
        className={cn(
          "flex size-8 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4",
          // Аватар человека показываем как есть, без плитки.
          !avatar && "rounded-lg bg-muted/60",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        {label ? <dt className="text-xs text-muted-foreground">{label}</dt> : null}
        <dd className="break-words text-sm">{children}</dd>
      </div>
      {action}
    </div>
  );
}

/**
 * Ключевая сумма сущности (итог акта, сумма накладной, прибавка за день) —
 * крупно, первой строкой сводки. Одна на панель; остальные суммы — обычными
 * строками DrawerSummaryItem.
 */
export function DrawerSummaryTotal({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  /** Короткое пояснение под суммой, например «без НДС». */
  hint?: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1 [&:not(:last-child)]:border-b [&:not(:last-child)]:pb-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-3xl font-semibold tabular-nums">{children}</dd>
      {hint ? <dd className="text-xs text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}

/** Аватар человека для DrawerSummaryItem и DrawerTimelineItem. */
export function DrawerAvatar({
  name,
  src,
  size = "md",
}: {
  name: string;
  src?: string | null;
  /** md — 32px (сводка, история), sm — 20px (строка списка). */
  size?: "sm" | "md";
}) {
  const box = size === "sm" ? "size-5 text-[10px]" : "size-8 text-xs";
  return src ? (
    <img src={src} alt="" className={cn("shrink-0 rounded-full object-cover", box)} />
  ) : (
    <span
      aria-hidden
      className={cn("flex shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground", box)}
    >
      {personInitials(name)}
    </span>
  );
}


export function DrawerStatus({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: StatusTone;
}) {
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}

export function DrawerTimeline({ children }: { children: ReactNode }) {
  return <ol className="space-y-4">{children}</ol>;
}

export function DrawerTimelineItem({
  avatar,
  title,
  meta,
  children,
  last,
}: {
  avatar: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
  /** Последний элемент — без соединительной линии. */
  last?: boolean;
}) {
  return (
    <li className="relative flex gap-3">
      {!last && <span aria-hidden className="absolute -bottom-4 left-4 top-9 w-px bg-border" />}
      {avatar}
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-sm font-medium">{title}</p>
        {meta && <p className="text-xs text-muted-foreground">{meta}</p>}
        {children && <div className="mt-1.5 space-y-0.5 text-[13px]">{children}</div>}
      </div>
    </li>
  );
}
