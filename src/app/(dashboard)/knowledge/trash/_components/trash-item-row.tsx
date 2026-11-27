"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, RotateCcw, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";

export interface TrashRow {
  id: string;
  slug: string;
  title: string;
  icon: string | null;
  iconColor: string | null;
  /** Cascade-deleted descendants count — surfaces в meta-строке, чтобы
   *  было ясно: restore/delete заберёт всё дерево. */
  descendantsCount: number;
  deletedAt: string | null;
  deletedByName: string | null;
}

const WARN_DAYS_LEFT = 7;

interface TrashItemRowProps {
  row: TrashRow;
  selected: boolean;
  onToggle: () => void;
  onRestore: () => void;
  onHardDelete: () => void;
  pending: boolean;
  daysLeft: number;
}

export function TrashItemRow({
  row,
  selected,
  onToggle,
  onRestore,
  onHardDelete,
  pending,
  daysLeft,
}: TrashItemRowProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const metaParts: string[] = [];
  if (row.deletedAt) {
    metaParts.push(
      formatDistanceToNow(new Date(row.deletedAt), {
        addSuffix: true,
        locale: ru,
      }),
    );
  }
  if (row.deletedByName) metaParts.push(row.deletedByName);
  if (row.descendantsCount > 0) {
    metaParts.push(
      `+ ${row.descendantsCount} ${childWord(row.descendantsCount)}`,
    );
  }

  const warn = daysLeft <= WARN_DAYS_LEFT;

  return (
    <div
      className={cn(
        "group flex items-center gap-3.5 px-4 py-3 transition-colors",
        selected ? "bg-brand/5" : "hover:bg-accent/50",
      )}
    >
      <Checkbox
        checked={selected}
        onCheckedChange={onToggle}
        aria-label={`Выбрать «${row.title || "Без названия"}»`}
      />
      <KbPageIcon
        icon={row.icon}
        color={row.iconColor}
        size={18}
        className="shrink-0"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="truncate text-sm font-medium">
          {row.title || "Без названия"}
        </p>
        {metaParts.length > 0 && (
          <p className="truncate text-xs text-muted-foreground">
            {metaParts.join(" · ")}
          </p>
        )}
      </div>

      {/* Действия по строке — проявляются на hover, чтобы не шуметь. */}
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <Link
          href={`/knowledge/${row.slug}`}
          aria-label="Открыть для чтения"
          data-tip="Открыть для чтения"
          className="inline-flex items-center justify-center size-8 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <Eye className="size-4" />
        </Link>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-brand"
          disabled={pending}
          onClick={onRestore}
          aria-label="Восстановить"
        >
          <RotateCcw />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-destructive"
          disabled={pending}
          onClick={() => setConfirmDelete(true)}
          aria-label="Удалить навсегда"
        >
          <Trash2 />
        </Button>
      </div>

      <span
        className={cn(
          "shrink-0 tabular-nums text-xs",
          warn
            ? "font-semibold text-orange-600 dark:text-orange-400"
            : "text-muted-foreground",
        )}
      >
        осталось {daysLeft} {dayWord(daysLeft)}
      </span>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Удалить «${row.title || "Без названия"}» навсегда?`}
        confirmLabel="Удалить навсегда"
        destructive
        consequences={[
          ...(row.descendantsCount > 0
            ? [
                {
                  kind: "remove" as const,
                  text: "Подстраницы удалятся вместе с ней",
                  count: row.descendantsCount,
                },
              ]
            : []),
          { kind: "irreversible", text: "Удаление нельзя отменить" },
        ]}
        onConfirm={() => {
          setConfirmDelete(false);
          onHardDelete();
        }}
      />
    </div>
  );
}

function childWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "подстраниц";
  if (mod10 === 1) return "подстраница";
  if (mod10 >= 2 && mod10 <= 4) return "подстраницы";
  return "подстраниц";
}

function dayWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "дней";
  if (mod10 === 1) return "день";
  if (mod10 >= 2 && mod10 <= 4) return "дня";
  return "дней";
}
