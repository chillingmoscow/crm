"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Loader2, Unlock } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { setKbPageLock } from "@/lib/knowledge/pages";

interface KbPageLockBannerProps {
  pageId: string;
  /** Когда заблокирована (ISO). null = разблокирована, баннер не
   *  рендерим. */
  lockedAt: string | null;
  /** Имя того, кто заблокировал (resolved server-side из profiles).
   *  null если автор blocker'а удалён или auth.users.delete cascaded. */
  lockedByName: string | null;
  /** Может ли current user снять блок (= имеет `kb.lock_pages`). */
  canUnlock: boolean;
}

/**
 * Banner-уведомление «Страница заблокирована» под title-областью.
 * Показывается, когда `kb_pages.locked_at IS NOT NULL`. Если у юзера
 * есть `kb.lock_pages` — отображает кнопку «Разблокировать». Без права
 * — только информация.
 *
 * Sprint D Phase 3.
 */
export function KbPageLockBanner({
  pageId,
  lockedAt,
  lockedByName,
  canUnlock,
}: KbPageLockBannerProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  if (!lockedAt) return null;

  const onUnlock = async () => {
    setPending(true);
    const { error } = await setKbPageLock({ pageId, locked: false });
    setPending(false);
    if (error) {
      toast.error(`Не удалось разблокировать: ${error}`);
      return;
    }
    toast.success("Блокировка снята");
    router.refresh();
  };

  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4
                 dark:border-amber-900 dark:bg-amber-950"
    >
      <span className="shrink-0 inline-flex items-center justify-center size-8 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
        <Lock className="size-4" />
      </span>
      <div className="flex-1 flex flex-col gap-1 min-w-0">
        <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">
          Страница заблокирована
        </div>
        <div className="text-[13px] leading-snug text-amber-800 dark:text-amber-200">
          {lockedByName
            ? `Заблокировал ${lockedByName} ${formatRelative(lockedAt)}.`
            : `Заблокирована ${formatRelative(lockedAt)}.`}{" "}
          Редактирование выключено{canUnlock ? " — снимите блок чтобы продолжить" : ""}.
        </div>
      </div>
      {canUnlock && (
        <Button
          size="sm"
          variant="outline"
          onClick={onUnlock}
          disabled={pending}
          className="shrink-0 border-amber-300 bg-amber-100 hover:bg-amber-200 text-amber-900 dark:border-amber-800 dark:bg-amber-900 dark:hover:bg-amber-800 dark:text-amber-100"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Unlock className="size-4" />
          )}
          Разблокировать
        </Button>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ${plural(days, "день", "дня", "дней")} назад`;
  const months = Math.floor(days / 30);
  return `${months} ${plural(months, "месяц", "месяца", "месяцев")} назад`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
