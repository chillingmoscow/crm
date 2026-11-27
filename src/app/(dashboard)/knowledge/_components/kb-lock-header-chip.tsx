"use client";

import { useState } from "react";
import { Loader2, Lock, Pencil, Unlock } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { errorText } from "@/lib/actions/error-text";
import { statusTones } from "@/components/ui/status-badge";
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
  // На телефоне от чипа остаётся замок ~24×20: зону нажатия растягиваем по
  // высоте до 44px, но не вбок — соседние значки шапки стоят вплотную.
  // Бейдж статуса DS: та же форма и палитра, что у StatusBadge
  // (statusTones), но кнопкой — у бейджа есть действия. Заблокировано —
  // neutral, разблокировано для себя — info.
  const chipClassName = cn(
    "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 max-sm:px-1.5 relative max-sm:before:absolute max-sm:before:inset-x-0 max-sm:before:-inset-y-3 max-sm:before:content-[''] text-xs font-medium transition-colors [&_svg]:size-3 [&_svg]:shrink-0",
    localUnlocked
      ? cn(statusTones.info, "hover:bg-brand/15 data-[state=open]:bg-brand/15")
      : cn(statusTones.neutral, "hover:text-foreground data-[state=open]:text-foreground"),
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
      toast.error(errorText(error, "Не удалось разблокировать страницу"));
    }
  };

  if (!hasActions) {
    return (
      <span className={chipClassName} aria-label="Страница заблокирована">
        <Icon className="size-3" />
        <span className="max-sm:hidden">{label}</span>
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
        <span className="max-sm:hidden">{label}</span>
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
          <span className="max-sm:hidden">{label}</span>
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
