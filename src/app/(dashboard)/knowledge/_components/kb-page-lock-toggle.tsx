"use client";

import { useState } from "react";
import { Lock, Unlock, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { IconTooltip } from "@/components/ui/icon-tooltip";
import { setKbPageLock } from "@/lib/knowledge/pages";
import { flushAllPendingSaves } from "@/lib/knowledge/pending-saves";
import {
  setKbPageStateOverride,
  useKbPageStateOverride,
} from "@/app/(dashboard)/knowledge/_components/kb-page-state-overrides-store";

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
 * UX: optimistic через client-side override store —
 * `kb-page-state-overrides-store`. Раньше после server-action был
 * `router.refresh()`, который форсировал full RSC re-fetch (10+
 * запросов в layout + page.tsx) → 300-600мс латентности на каждый
 * toggle. Теперь после успешного RPC мы пушим override, consumer'ы
 * (editor's canEdit-gate, sidebar lock-icon) читают локальное значение
 * поверх server-prop'а. revalidatePath на сервере остаётся — он нужен
 * чтобы соседние табы / другие пользователи получили свежие данные при
 * следующей навигации.
 */
export function KbPageLockToggle({
  pageId,
  initialLocked,
}: KbPageLockToggleProps) {
  // Read override поверх server-initial'а: после toggle сразу видим
  // новое состояние (бейдж переключается мгновенно), даже если сам
  // SSR-prop ещё не обновился.
  const override = useKbPageStateOverride(pageId);
  const locked = override?.locked ?? initialLocked;

  const [pending, setPending] = useState(false);

  // Cleanup override на смену pageId происходит в KbPageEditor (см.
  // useEffect там же). Toggle сам ничего не чистит — KbPageMenu, в
  // котором он живёт, рендерится через slot-context и НЕ ремоунтится
  // на смену страницы, поэтому local-cleanup здесь был бы бесполезен.

  const onToggle = async () => {
    const next = !locked;
    setKbPageStateOverride(pageId, { locked: next }); // optimistic
    setPending(true);
    // Перед lock'ом — дождаться pending debounced-save'а редактора.
    // Иначе strict-lock guard в kb_save_page (миграция 086) reject'ит
    // последний flush на 42501 → unsaved edits теряются. См. Codex #65 P2.
    if (next) {
      try {
        await flushAllPendingSaves();
      } catch {
        // Если flush упал — продолжаем с lock'ом. Editor сам покажет
        // toast.error из своего save-handler'а.
      }
    }
    const { error } = await setKbPageLock({ pageId, locked: next });
    setPending(false);
    if (error) {
      setKbPageStateOverride(pageId, { locked: !next }); // revert
      toast.error(`Не удалось переключить блокировку: ${error}`);
      return;
    }
    // Без success-toast'а: banner на странице сам объясняет состояние.
    // НЕ зовём router.refresh() — override уже даёт мгновенный UI,
    // а revalidatePath на сервере (см. setKbPageLock в pages.ts)
    // обеспечит свежие данные при следующей навигации.
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
