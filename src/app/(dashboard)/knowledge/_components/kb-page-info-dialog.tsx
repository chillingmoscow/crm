"use client";

import { Info, X } from "lucide-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

interface KbPageInfoDialogProps {
  pageId: string;
  createdAt: string | null;
  createdByName: string | null;
  createdByAvatarUrl: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
  updatedByAvatarUrl: string | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

/**
 * «О странице» — модалка с полной audit-информацией: short ID,
 * created/updated даты с временем + аватарки автора и редактора.
 *
 * Раньше эта информация жила в `EntityInfoPopover` (отдельная иконка
 * в топбаре), но после переезда всех page-actions в ⋯-меню (PR #111)
 * popover убрали, и юзер потерял доступ к ID/Created. Возвращаем как
 * controlled dialog, который открывается из `KbPageMenu` пунктом
 * «О странице».
 */
export function KbPageInfoDialog({
  pageId,
  createdAt,
  createdByName,
  createdByAvatarUrl,
  updatedAt,
  updatedByName,
  updatedByAvatarUrl,
  open,
  onOpenChange,
}: KbPageInfoDialogProps) {
  const rows: Array<{
    label: string;
    value: string;
    isUser?: boolean;
    avatarUrl?: string | null;
  }> = [
    { label: "ID", value: pageId.slice(0, 8) },
    { label: "Создана", value: formatDateTime(createdAt) },
    {
      label: "Автор",
      value: createdByName ?? "—",
      isUser: true,
      avatarUrl: createdByAvatarUrl,
    },
    { label: "Изменена", value: formatRelativeRu(updatedAt) },
    {
      label: "Редактор",
      value: updatedByName ?? "—",
      isUser: true,
      avatarUrl: updatedByAvatarUrl,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px] p-0 gap-0 [&>button:last-child]:hidden">
        <div className="flex items-start gap-3.5 px-6 pt-6 pb-4">
          <span className="inline-flex shrink-0 items-center justify-center size-10 rounded-full bg-muted text-muted-foreground">
            <Info className="size-[18px]" />
          </span>
          <div className="flex-1 flex flex-col gap-1 min-w-0">
            <DialogTitle className="text-[17px] font-semibold leading-tight tracking-tight text-foreground">
              О странице
            </DialogTitle>
            <DialogDescription className="text-sm leading-snug text-muted-foreground">
              Метаданные страницы — кто создал, кто последний редактировал.
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <button
              type="button"
              aria-label="Закрыть"
              className="inline-flex shrink-0 items-center justify-center size-7 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <X className="size-4" />
            </button>
          </DialogClose>
        </div>
        <dl className="px-6 pb-6 pt-1 flex flex-col gap-2">
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
                  <MiniAvatar
                    name={r.value}
                    avatarUrl={r.avatarUrl ?? null}
                  />
                )}
                {r.value}
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
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

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
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
  if (diffMin < 60)
    return `${diffMin} ${plural(diffMin, "минуту", "минуты", "минут")} назад`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24)
    return `${diffHr} ${plural(diffHr, "час", "часа", "часов")} назад`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7)
    return `${diffDay} ${plural(diffDay, "день", "дня", "дней")} назад`;
  return formatDateTime(iso);
}
