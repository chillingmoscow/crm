"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Unlock, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { IconTooltip } from "@/components/ui/icon-tooltip";
import { setKbPageLock } from "@/lib/knowledge/pages";
import { flushAllPendingSaves } from "@/lib/knowledge/pending-saves";

interface KbPageLockToggleProps {
  pageId: string;
  /** Текущее lock-состояние (server-rendered initial). */
  initialLocked: boolean;
}

/**
 * Admin toggle «заблокировать страницу» в page-header actions.
 * Видна только под `kb.lock_pages` (gated на server-render'е
 * [slug]/page.tsx). Sprint D Phase 3.
 *
 * Visual: иконка замка. Filled-yellow когда заблокировано (как
 * required-reading toggle — тёплый «внимание» цвет), muted-серый
 * когда нет. Click → toggle с optimistic update + router.refresh.
 */
export function KbPageLockToggle({
  pageId,
  initialLocked,
}: KbPageLockToggleProps) {
  const router = useRouter();
  const [locked, setLocked] = useState(initialLocked);
  const [pending, setPending] = useState(false);

  const onToggle = async () => {
    const next = !locked;
    setLocked(next); // optimistic
    setPending(true);
    // Перед lock'ом — дождаться pending debounced-save'а редактора.
    // Иначе strict-lock guard в kb_save_page (миграция 086) reject'ит
    // последний flush на 42501 → unsaved edits теряются. См. Codex #65 P2.
    if (next) {
      try {
        await flushAllPendingSaves();
      } catch {
        // Если flush упал — продолжаем с lock'ом. Editor сам покажет
        // toast.error из своего save-handler'а; lock не блокируем,
        // потому что причина flush-fail может быть network — а user
        // явно хочет защитить страницу.
      }
    }
    const { error } = await setKbPageLock({ pageId, locked: next });
    setPending(false);
    if (error) {
      setLocked(!next); // revert
      toast.error(`Не удалось переключить блокировку: ${error}`);
      return;
    }
    // Без success-toast'а: banner на странице сам объясняет состояние.
    // Дублирующее уведомление избыточно.
    router.refresh();
  };

  return (
    <IconTooltip
      label={
        locked
          ? "Заблокировано (нажмите чтобы разблокировать)"
          : "Заблокировать страницу"
      }
    >
      <button
        type="button"
        aria-label={locked ? "Разблокировать страницу" : "Заблокировать страницу"}
        aria-pressed={locked}
        onClick={onToggle}
        disabled={pending}
        className="inline-flex items-center justify-center size-9 rounded-lg bg-background text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="w-[18px] h-[18px] animate-spin" />
        ) : locked ? (
          <Lock className="w-[18px] h-[18px] fill-amber-200 text-amber-700 dark:fill-amber-900 dark:text-amber-400" />
        ) : (
          <Unlock className="w-[18px] h-[18px]" />
        )}
      </button>
    </IconTooltip>
  );
}
