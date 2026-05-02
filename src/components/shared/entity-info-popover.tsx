"use client";

/**
 * EntityInfoPopover — стандартизованный popover «О <сущности>» для
 * entity detail pages: должность, сотрудник, счёт, транзакция,
 * контрагент и т.д. (см. дизайн r5eX3 / ZHjVB).
 *
 * Триггер: 36×36 icon-button (info), стиль как у NotificationBell —
 * место рядом с колокольчиком в header дашборда (через
 * <PageHeaderActions>).
 *
 * Содержимое: 5 строк — ID, Создана, Создал, Изменена, Изменил.
 * Создал/Изменил подсвечиваются brand-blue (как в дизайне),
 * пустые значения отрисовываются как «—».
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
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

export function EntityInfoPopover({
  title,
  id,
  createdAt,
  createdByName,
  updatedAt,
  updatedByName,
}: EntityInfoPopoverProps) {
  const rows: { label: string; value: string; isUser?: boolean }[] = [
    { label: "ID", value: id.slice(0, 8) },
    { label: "Создана", value: formatDate(createdAt) },
    { label: "Создал", value: createdByName ?? "—", isUser: true },
    { label: "Изменена", value: formatDate(updatedAt) },
    { label: "Изменил", value: updatedByName ?? "—", isUser: true },
  ];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={title}
          className="inline-flex items-center justify-center size-9 rounded-lg border border-border bg-background text-foreground hover:bg-accent transition-colors"
        >
          <Info className="w-[18px] h-[18px]" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        className="w-[280px] p-5 rounded-xl"
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
                    ? "font-medium text-brand"
                    : "font-medium text-foreground"
                }
              >
                {r.value}
              </dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}
