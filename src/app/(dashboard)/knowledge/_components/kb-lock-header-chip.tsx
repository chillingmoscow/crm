"use client";

import { useState } from "react";
import { Loader2, Lock, Pencil, Unlock } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setKbPageLock } from "@/lib/knowledge/pages";
import {
  setKbPageStateOverride,
  useKbPageStateOverride,
} from "@/app/(dashboard)/knowledge/_components/kb-page-state-overrides-store";

/**
 * Компактный lock-чип в верхней панели рядом с ⋯-меню (как «Locked»
 * в хлебных крошках Notion). Раньше это был `KbLockedPill` отдельной
 * строкой в теле страницы — ел вертикальное место и был неочевиден.
 *
 * Состояния (через override-store, fallback — server-prop):
 *   • не заблокирована → ничего не рендерим;
 *   • заблокирована, нет прав → статичный чип «Заблокировано»;
 *   • локально разблокирована для себя → чип «Разблокировано»
 *     (клик — снова заблокировать для себя);
 *   • заблокирована, есть права → dropdown «Редактировать»
 *     (unlock for me) / «Разблокировать» (unlock for everyone).
 */
export function KbLockHeaderChip({
  pageId,
  initialLocked,
  canEditBase,
  canLock,
}: {
  pageId: string;
  initialLocked: boolean;
  canEditBase: boolean;
  canLock: boolean;
}) {
  const [unlockPending, setUnlockPending] = useState(false);
  const override = useKbPageStateOverride(pageId);
  const globalLocked = override?.locked ?? initialLocked;
  const localUnlocked = override?.localUnlocked ?? false;

  if (!globalLocked) return null;

  const hasActions = canEditBase || canLock;
  const Icon = localUnlocked ? Unlock : Lock;
  const label = localUnlocked ? "Разблокировано" : "Заблокировано";
  // Бейдж статуса DS (форма pill, 12 / 500): заблокировано — neutral,
  // разблокировано для себя — info (docs/design-system.md → «Статусные бейджи»).
  const chipClassName = cn(
    "inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors",
    localUnlocked
      ? "bg-brand/10 text-brand hover:bg-brand/15 data-[state=open]:bg-brand/15"
      : "bg-muted text-muted-foreground hover:text-foreground data-[state=open]:text-foreground",
  );

  const unlockForMe = () =>
    setKbPageStateOverride(pageId, { localUnlocked: true });
  const lockForMe = () =>
    setKbPageStateOverride(pageId, { localUnlocked: false });

  const unlockForEveryone = async () => {
    setKbPageStateOverride(pageId, { locked: false, localUnlocked: false });
    setUnlockPending(true);
    const { error } = await setKbPageLock({ pageId, locked: false });
    setUnlockPending(false);
    if (error) {
      setKbPageStateOverride(pageId, { locked: true, localUnlocked: false });
      toast.error(`Не удалось разблокировать страницу: ${error}`);
    }
  };

  if (!hasActions) {
    return (
      <span className={chipClassName} aria-label="Страница заблокирована">
        <Icon className="size-3" />
        <span>{label}</span>
      </span>
    );
  }

  if (localUnlocked) {
    return (
      <button
        type="button"
        className={chipClassName}
        aria-label="Снова заблокировать страницу для себя"
        onClick={lockForMe}
      >
        <Icon className="size-3" />
        <span>{label}</span>
      </button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={chipClassName}
          aria-label="Страница заблокирована"
        >
          <Icon className="size-3" />
          <span>{label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="w-56"
      >
        {canEditBase && (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              unlockForMe();
            }}
            className="gap-2.5"
          >
            <Pencil className="size-4 shrink-0" />
            <span>Редактировать</span>
          </DropdownMenuItem>
        )}
        {canLock && (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              if (!unlockPending) void unlockForEveryone();
            }}
            disabled={unlockPending}
            className="gap-2.5"
          >
            {unlockPending ? (
              <Loader2 className="size-4 shrink-0 animate-spin" />
            ) : (
              <Unlock className="size-4 shrink-0" />
            )}
            <span>Разблокировать</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
