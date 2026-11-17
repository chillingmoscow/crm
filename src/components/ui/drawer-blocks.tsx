/* eslint-disable @next/next/no-img-element */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Блоки содержимого боковой панели (EditDrawer). Правила — в
 * docs/design-system.md § «Боковая панель».
 *
 * - DrawerSection — плоский раздел: заголовок и тонкая линия сверху
 *   (у первого раздела линии нет). Без рамок и фона.
 * - DrawerSummary / DrawerSummaryItem — единственная сводная плашка в
 *   панели просмотра: главное о сущности.
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
      className={cn("space-y-4 border-t pt-5 first:border-t-0 first:pt-0", className)}
    >
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            {title && <h3 className="text-sm font-semibold">{title}</h3>}
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
  label,
  children,
  action,
}: {
  icon: ReactNode;
  label?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/60 text-muted-foreground [&_svg]:size-4"
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

/** Аватар человека для DrawerSummaryItem и DrawerTimelineItem. */
export function DrawerAvatar({ name, src }: { name: string; src?: string | null }) {
  return src ? (
    <img src={src} alt="" className="size-8 shrink-0 rounded-full object-cover" />
  ) : (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

const statusTones = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-brand/10 text-brand",
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  danger: "bg-destructive/10 text-destructive",
} as const;

export function DrawerStatus({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: keyof typeof statusTones;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        statusTones[tone],
      )}
    >
      {label}
    </span>
  );
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
