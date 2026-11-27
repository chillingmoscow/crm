/**
 * EmptyState — реиспользуемый паттерн «нет данных» по дизайн-системе Sheerly.
 *
 * Размещение: внутри карточки (Card) или сразу после header'а страницы.
 * Структура: картинка (линейная иллюстрация по смыслу или круглая 80×80
 * иконка с border) + title (18px semibold) + subtitle (13px muted) +
 * опциональный CTA.
 *
 * Иллюстрации — `illustration`: «empty» (данных ещё нет), «search» (по
 * фильтрам и поиску ничего не найдено), «error» (не удалось загрузить),
 * «done» (всё сделано, очередь пуста). Нарисованы одной линией на
 * `currentColor` (muted-foreground) с одной синей деталью — одинаково в
 * светлой и тёмной теме. Правило — `docs/design-system.md`, «Состояния».
 */

import * as React from "react";
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  CheckCheck,
  CheckCircle2,
  CircleCheck,
  Inbox,
  PackageOpen,
  PlugZap,
  Search,
  SearchX,
  UserSearch,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type EmptyStateIllustration = "empty" | "search" | "error" | "done";

/**
 * Иконки, у которых есть иллюстрация того же смысла: экран, передавший
 * такую иконку, получает иллюстрацию сам (поиск без результата, ошибка
 * загрузки, «всё сделано», пустой ящик). Остальные иконки — предметные
 * («Склады», «Нет доступа») — остаются иконкой в круге.
 */
const ILLUSTRATION_BY_ICON = new Map<LucideIcon, EmptyStateIllustration>([
  [SearchX, "search"],
  [Search, "search"],
  [UserSearch, "search"],
  [AlertCircle, "error"],
  [AlertTriangle, "error"],
  [PlugZap, "error"],
  [CheckCheck, "done"],
  [CheckCircle2, "done"],
  [CircleCheck, "done"],
  [Inbox, "empty"],
  [PackageOpen, "empty"],
  [Archive, "empty"],
]);

interface EmptyStateProps {
  /** Иконка в круге — если подходящей иллюстрации нет (нет доступа и т.п.). */
  icon?: LucideIcon;
  /** Иллюстрация по смыслу; если задана, иконка не рисуется. `false` —
   *  оставить иконку, даже если для неё есть иллюстрация. */
  illustration?: EmptyStateIllustration | false;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  illustration,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  const art =
    illustration === false
      ? null
      : (illustration ?? (Icon ? ILLUSTRATION_BY_ICON.get(Icon) : undefined) ?? null);
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 bg-muted rounded-xl p-8 min-h-[320px] text-center",
        className,
      )}
    >
      {art ? (
        <EmptyIllustration kind={art} />
      ) : Icon ? (
        <div className="flex items-center justify-center size-20 rounded-full bg-background border border-border shrink-0">
          <Icon className="w-7 h-7 text-muted-foreground" />
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5 max-w-[360px]">
        <p className="text-[18px] font-semibold text-foreground leading-tight">
          {title}
        </p>
        {description && (
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

// ── Иллюстрации ─────────────────────────────────────────────────
// viewBox 120×96, линия 1.5, скругления как у карточек. Подложка —
// круг цвета фона страницы, контур и детали — currentColor, одна
// деталь — brand.

const ACCENT = "hsl(var(--brand))";
const PAPER = "hsl(var(--background))";

export function EmptyIllustration({
  kind,
  className,
}: {
  kind: EmptyStateIllustration;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 120 96"
      width={120}
      height={96}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      data-illustration={kind}
      className={cn("shrink-0 text-muted-foreground", className)}
    >
      <circle cx="60" cy="48" r="40" fill={PAPER} stroke="none" />
      {kind === "empty" && <EmptyArt />}
      {kind === "search" && <SearchArt />}
      {kind === "error" && <ErrorArt />}
      {kind === "done" && <DoneArt />}
    </svg>
  );
}

/** Лоток с двумя карточками: «здесь будут данные». */
function EmptyArt() {
  return (
    <>
      <rect x="40" y="18" width="40" height="30" rx="5" fill={PAPER} opacity={0.6} />
      <rect x="35" y="25" width="50" height="32" rx="5" fill={PAPER} />
      <path d="M43 34h20M43 40h30" opacity={0.6} />
      <path
        d="M26 54l8-10h52l8 10v16a6 6 0 0 1-6 6H32a6 6 0 0 1-6-6V54z"
        fill={PAPER}
      />
      <path d="M26 54h22l3 6h18l3-6h22" />
      <path d="M52 66h16" stroke={ACCENT} />
    </>
  );
}

/** Документ с пустыми строками и лупа: «по запросу ничего нет». */
function SearchArt() {
  return (
    <>
      <rect x="30" y="18" width="44" height="56" rx="6" fill={PAPER} />
      <path d="M39 30h26M39 38h18" opacity={0.6} />
      <path d="M39 46h22M39 54h12" strokeDasharray="3 4" opacity={0.6} />
      <circle cx="76" cy="58" r="13" fill={PAPER} />
      <path d="M85.5 67.5L95 77" strokeWidth={3} />
      <path d="M71 58h10" stroke={ACCENT} />
    </>
  );
}

/** Окно с обрывом и предупреждением: «не удалось загрузить». */
function ErrorArt() {
  return (
    <>
      <rect x="24" y="20" width="72" height="52" rx="7" fill={PAPER} />
      <path d="M24 32h72" />
      <circle cx="31" cy="26" r="1" fill="currentColor" stroke="none" />
      <circle cx="36" cy="26" r="1" fill="currentColor" stroke="none" />
      <circle cx="41" cy="26" r="1" fill="currentColor" stroke="none" />
      <path d="M60 39l13 23H47l13-23z" fill={PAPER} />
      <path d="M60 47v7" stroke={ACCENT} />
      <circle cx="60" cy="58" r="0.6" stroke={ACCENT} strokeWidth={1.8} />
    </>
  );
}

/** Галочка в круге с искрами: «всё сделано». */
function DoneArt() {
  return (
    <>
      <circle cx="60" cy="48" r="22" fill={PAPER} />
      <path d="M50 48.5l7 7 14-15" stroke={ACCENT} strokeWidth={2} />
      <path d="M90 22v8M86 26h8" opacity={0.7} />
      <path d="M28 64v6M25 67h6" opacity={0.7} />
      <circle cx="31" cy="27" r="2" opacity={0.7} />
      <circle cx="92" cy="66" r="1.5" opacity={0.7} />
    </>
  );
}
