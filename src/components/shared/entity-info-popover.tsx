"use client";

/**
 * EntityInfoPopover — стандартизованный popover «О <сущности>» для
 * entity detail pages: должность, сотрудник, счёт, транзакция,
 * контрагент, KB-страница и т.д. (см. дизайн r5eX3 / ZHjVB).
 *
 * Триггер: 36×36 icon-button (info), стиль как у NotificationBell —
 * место рядом с колокольчиком в header дашборда (через
 * <PageHeaderActions>).
 *
 * Содержимое: 5 строк — ID, Создана, Создал, Изменена, Изменил.
 * Создал/Изменил подсвечиваются brand-blue (как в дизайне),
 * пустые значения отрисовываются как «—».
 *
 * KB-overrides (см. usage в knowledge/[slug]/page.tsx):
 * - createdByLabel/updatedByLabel — KB зовёт их «Автор»/«Редактор»
 * - createdByAvatarUrl/updatedByAvatarUrl — мини-аватарки слева от имени
 * - showTime — даты с HH:mm
 * - relativeUpdatedAt — «Изменена» как «5 мин назад» вместо даты
 */

import { Info } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface EntityInfoPopoverProps {
  /** Заголовок попапа: «О должности», «О сотруднике» и т.д. */
  title: string;
  /** Полный UUID сущности — отображается shortened (первые 8 символов) */
  id: string;
  createdAt: string | null;
  createdByName: string | null;
  updatedAt: string | null;
  updatedByName: string | null;

  // ─── KB-style overrides (опциональны, defaults сохраняют поведение
  //     для существующих entities — должности и т.д.) ───
  /** Override label «Создал» (KB: «Автор») */
  createdByLabel?: string;
  /** Override label «Изменил» (KB: «Редактор») */
  updatedByLabel?: string;
  createdByAvatarUrl?: string | null;
  updatedByAvatarUrl?: string | null;
  /** Когда true — даты отображаются с HH:mm. */
  showTime?: boolean;
  /** Когда true — «Изменена» отображается относительно («5 мин назад»). */
  relativeUpdatedAt?: boolean;
}

function formatDate(iso: string | null, withTime: boolean): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      ...(withTime
        ? ({ hour: "2-digit", minute: "2-digit" } as const)
        : ({} as const)),
    });
  } catch {
    return "—";
  }
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function formatRelativeRu(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.round((now - then) / 1000));
  if (diffSec < 60) return "только что";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} ${plural(diffMin, "минуту", "минуты", "минут")} назад`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} ${plural(diffHr, "час", "часа", "часов")} назад`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay} ${plural(diffDay, "день", "дня", "дней")} назад`;
  return formatDate(iso, false);
}

function MiniAvatar({
  name,
  avatarUrl,
}: {
  name: string | null | undefined;
  avatarUrl: string | null | undefined;
}) {
  const initials =
    (name ?? "")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?";
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={name ?? ""}
        className="size-4 rounded-full object-cover bg-muted shrink-0"
      />
    );
  }
  return (
    <span className="size-4 rounded-full bg-muted text-muted-foreground inline-flex items-center justify-center text-[8px] font-semibold shrink-0">
      {initials}
    </span>
  );
}

type Row = {
  label: string;
  value: string;
  isUser?: boolean;
  avatarUrl?: string | null;
};

export function EntityInfoPopover({
  title,
  id,
  createdAt,
  createdByName,
  updatedAt,
  updatedByName,
  createdByLabel = "Создал",
  updatedByLabel = "Изменил",
  createdByAvatarUrl = null,
  updatedByAvatarUrl = null,
  showTime = false,
  relativeUpdatedAt = false,
}: EntityInfoPopoverProps) {
  const rows: Row[] = [
    { label: "ID", value: id.slice(0, 8) },
    { label: "Создана", value: formatDate(createdAt, showTime) },
    {
      label: createdByLabel,
      value: createdByName ?? "—",
      isUser: true,
      avatarUrl: createdByAvatarUrl,
    },
    {
      label: "Изменена",
      value: relativeUpdatedAt
        ? formatRelativeRu(updatedAt)
        : formatDate(updatedAt, showTime),
    },
    {
      label: updatedByLabel,
      value: updatedByName ?? "—",
      isUser: true,
      avatarUrl: updatedByAvatarUrl,
    },
  ];

  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* Top-bar button per DS iedpv: 36×36, no border, bg-background,
            muted icon → foreground on hover. */}
        <button
          type="button"
          aria-label={title}
          className="inline-flex items-center justify-center size-9 rounded-lg bg-background text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <Info className="w-[18px] h-[18px]" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        className="w-[300px] p-5 rounded-xl"
      >
        <h2 className="text-[14px] font-semibold mb-3.5">{title}</h2>
        <div className="h-px bg-border -mx-5 mb-3" />
        <dl className="flex flex-col gap-2">
          {rows.map((r) => (
            <div
              key={r.label}
              className="flex items-center justify-between gap-3 text-[13px]"
            >
              <dt className="text-muted-foreground">{r.label}</dt>
              <dd
                className={
                  r.isUser && r.value !== "—"
                    ? "inline-flex items-center gap-1.5 font-medium text-brand"
                    : "font-medium text-foreground text-right"
                }
              >
                {r.isUser && r.value !== "—" && (
                  <MiniAvatar name={r.value} avatarUrl={r.avatarUrl ?? null} />
                )}
                {r.value}
              </dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}
