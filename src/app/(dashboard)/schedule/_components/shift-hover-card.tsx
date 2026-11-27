"use client";

import { useRef, useState, type FocusEvent, type ReactElement } from "react";
import { Clock } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ColorDot } from "@/components/ui/color-dot";
import { personInitials } from "@/lib/format/initials";
import { avatarImageUrl } from "@/lib/people/avatar-thumb";
import type { ShiftAttendanceMark } from "@/lib/payroll/types";
import { cn } from "@/lib/utils";
import { attendanceView } from "./shift-attendance-popover";
import { LiveDot } from "./shift-live";

export type ShiftHoverInfo = {
  name: string;
  role?: string | null;
  avatar?: string | null;
  /** «09:00–17:00». */
  time: string;
  hours: number;
  template?: { name: string; color: string | null } | null;
  draft: boolean;
  running: boolean;
  /** Отметка выхода — только у тех, кому её и так видно в сетке. */
  attendance?: ShiftAttendanceMark;
};

/**
 * Фото 56px, как в шапке карточки сотрудника (`ProfileHeader`). Как в
 * `PersonAvatar`: под фото лежат инициалы — пока оно грузится, круг не
 * пустой; не загрузилась уменьшенная копия — берём оригинал, не загрузился
 * и он — остаются инициалы.
 */
function Avatar56({ name, src }: { name: string; src?: string | null }) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const url = [src ? avatarImageUrl(src, 128) : null, src].find(
    (candidate): candidate is string => !!candidate && !failed.has(candidate),
  );
  return (
    <span className="relative flex size-14 shrink-0 items-center justify-center rounded-full bg-muted text-lg font-semibold text-muted-foreground">
      <span aria-hidden>{personInitials(name)}</span>
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={url}
          src={url}
          alt=""
          width={56}
          height={56}
          decoding="async"
          className="absolute inset-0 size-14 rounded-full object-cover"
          onError={() => setFailed((prev) => new Set(prev).add(url))}
        />
      )}
    </span>
  );
}

/**
 * Карточка при наведении на смену: кто, должность, время, часы, идёт ли
 * сейчас и отметка выхода. Открывается и с клавиатуры (видимый фокус).
 *
 * - `suppressed` — идёт перетаскивание: карточка закрыта и не открывается.
 * - Нажатие на смену (начало клика или переноса) закрывает карточку до
 *   ухода курсора, отмены касания, конца переноса или фокуса с клавиатуры —
 *   она не висит над открытой панелью и не едет за мышью.
 * - `enabled = false` (сенсорный экран, смена без сотрудника): карточка не
 *   открывается, но обёртка остаётся — иначе кнопка смены перемонтируется
 *   и теряет фокус и начатый перенос. Касания Radix не открывают.
 */
export function ShiftHoverCard({
  enabled,
  suppressed,
  info,
  children,
}: {
  enabled: boolean;
  suppressed: boolean;
  info: ShiftHoverInfo;
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const pressed = useRef(false);
  const release = () => {
    pressed.current = false;
  };
  const blocked = !enabled || suppressed;
  const attendance = info.attendance ? attendanceView(info.attendance) : null;
  return (
    <HoverCard
      open={open && !blocked}
      onOpenChange={(next) => setOpen(next && !blocked && !pressed.current)}
      openDelay={450}
      closeDelay={100}
    >
      <HoverCardTrigger
        asChild
        onPointerDown={() => {
          pressed.current = true;
          setOpen(false);
        }}
        onPointerLeave={release}
        onPointerCancel={release}
        onDragEnd={release}
        // Фокус после клика или возврата из панели карточку не открывает —
        // только фокус с клавиатуры. preventDefault отменяет открытие Radix.
        onFocus={(event: FocusEvent<HTMLElement>) => {
          if (!enabled || !event.currentTarget.matches(":focus-visible")) event.preventDefault();
          else release();
        }}
      >
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        collisionPadding={16}
        // Интерактива внутри нет: курсор проходит сквозь карточку к сменам
        // соседних дней, и их карточки открываются как обычно.
        className="pointer-events-none w-64 max-w-[calc(100vw-32px)] p-3"
      >
        <div className="flex items-center gap-3">
          <Avatar56 name={info.name} src={info.avatar} />
          <div className="min-w-0">
            <p className="break-words text-sm font-semibold leading-snug">{info.name}</p>
            {info.role && <p className="truncate text-xs text-muted-foreground">{info.role}</p>}
          </div>
        </div>
        <div className="mt-3 space-y-1.5 border-t pt-3 text-[13px]">
          <p className="flex items-center gap-2 tabular-nums">
            <Clock aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            {info.time}
            <span className="text-muted-foreground">· {info.hours.toLocaleString("ru")} ч</span>
          </p>
          {info.template && (
            <p className="flex min-w-0 items-center gap-2">
              <span className="flex size-3.5 shrink-0 items-center justify-center">
                <ColorDot color={info.template.color} size="sm" />
              </span>
              <span className="truncate">{info.template.name}</span>
            </p>
          )}
          {info.running && (
            <p className="flex items-center gap-2 text-brand">
              <span className="flex size-3.5 shrink-0 items-center justify-center">
                <LiveDot />
              </span>
              Идёт сейчас
            </p>
          )}
          {attendance && (
            <p
              className={cn(
                "flex items-center gap-2",
                attendance.attention ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground",
              )}
            >
              <attendance.Icon aria-hidden className="size-3.5 shrink-0" />
              {attendance.heading}
            </p>
          )}
          {info.draft && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <span aria-hidden className="size-3.5 shrink-0" />
              Черновик
            </p>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
