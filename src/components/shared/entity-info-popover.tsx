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
 * Содержимое: до 5 строк — ID, Создана, Создал, Изменена, Изменил.
 * Создал/Изменил подсвечиваются brand-blue (как в дизайне). Строка без
 * значения не выводится: пустое «—» ничего не сообщает. Подписи дат
 * задаются под род и смысл сущности (`createdLabel`/`updatedLabel`).
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
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { pluralRu } from "@/lib/format/plural";
import { personInitials } from "@/lib/format/initials";

interface EntityInfoPopoverProps {
  /** Заголовок попапа: «О должности», «О сотруднике» и т.д. */
  title: string;
  /** Полный UUID сущности — отображается shortened (первые 8 символов) */
  id: string;
  createdAt: string | null;
  createdByName: string | null;
  updatedAt: string | null;
  updatedByName: string | null;

  /** Подпись даты создания: «Создана» (должность), «Создано»
   *  (подразделение), «Аккаунт создан» (сотрудник). */
  createdLabel?: string;
  /** Подпись второй даты: «Изменена» или, например, «В заведении с». */
  updatedLabel?: string;

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
  /**
   * Свои строки сразу после ID — например, код позиции во внешней системе.
   * Строка без значения, как и остальные, не выводится.
   */
  extraRows?: { label: string; value: string | null }[];
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

function formatRelativeRu(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.round((now - then) / 1000));
  if (diffSec < 60) return "только что";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} ${pluralRu(diffMin, "минуту", "минуты", "минут")} назад`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} ${pluralRu(diffHr, "час", "часа", "часов")} назад`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay} ${pluralRu(diffDay, "день", "дня", "дней")} назад`;
  return formatDate(iso, false);
}

function MiniAvatar({
  name,
  avatarUrl,
}: {
  name: string | null | undefined;
  avatarUrl: string | null | undefined;
}) {
  const initials = personInitials(name);
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
    <span className="size-4 rounded-full bg-muted text-muted-foreground inline-flex items-center justify-center text-xs font-semibold leading-none shrink-0">
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
  createdLabel = "Создана",
  updatedLabel = "Изменена",
  createdByLabel = "Создал",
  updatedByLabel = "Изменил",
  createdByAvatarUrl = null,
  updatedByAvatarUrl = null,
  showTime = false,
  relativeUpdatedAt = false,
  extraRows = [],
}: EntityInfoPopoverProps) {
  const candidates: (Omit<Row, "value"> & { value: string | null })[] = [
    { label: "ID", value: id.slice(0, 8) },
    ...extraRows,
    {
      label: createdLabel,
      value: createdAt ? formatDate(createdAt, showTime) : null,
    },
    {
      label: createdByLabel,
      value: createdByName,
      isUser: true,
      avatarUrl: createdByAvatarUrl,
    },
    {
      label: updatedLabel,
      value: !updatedAt
        ? null
        : relativeUpdatedAt
          ? formatRelativeRu(updatedAt)
          : formatDate(updatedAt, showTime),
    },
    {
      label: updatedByLabel,
      value: updatedByName,
      isUser: true,
      avatarUrl: updatedByAvatarUrl,
    },
  ];
  const rows = candidates.filter(
    (row): row is Row => !!row.value && row.value !== "—",
  );

  return (
    <Popover>
      <IconTooltip label={title}>
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
      </IconTooltip>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        className="w-[300px] p-5"
      >
        <h2 className="text-sm font-semibold mb-3.5">{title}</h2>
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
                  r.isUser
                    ? "inline-flex items-center gap-1.5 font-medium text-brand"
                    : "font-medium text-foreground text-right"
                }
              >
                {r.isUser && (
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
