"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { IconTooltip } from "@/components/ui/icon-tooltip";
import { setKbPageRequiredReading } from "@/lib/knowledge/required-reading";
import {
  setKbPageStateOverride,
  useKbPageStateOverride,
} from "@/app/(dashboard)/knowledge/_components/kb-page-state-overrides-store";

interface KbRequiredReadingToggleProps {
  pageId: string;
  /** Текущий required-reading flag (server-rendered initial). */
  initialRequired: boolean;
}

/**
 * Admin toggle «обязательно к прочтению» в page-header actions.
 * Видна только пользователям с `kb.manage_required_reading`
 * (gated на server-render'е [slug]/page.tsx).
 *
 * UX: optimistic через client-side override store
 * (`kb-page-state-overrides-store`). Раньше после успеха был
 * `router.refresh()` → full RSC re-fetch → ~300мс задержка. Теперь
 * override push'ится мгновенно, consumer'ы (banner на странице,
 * sidebar-icon если рендерится) подхватывают новое значение.
 * revalidatePath на сервере (см. setKbPageRequiredReading) — для
 * соседних табов / других юзеров на следующей навигации.
 */
export function KbRequiredReadingToggle({
  pageId,
  initialRequired,
}: KbRequiredReadingToggleProps) {
  const override = useKbPageStateOverride(pageId);
  const required = override?.requiredReading ?? initialRequired;

  const [pending, setPending] = useState(false);

  const onToggle = async () => {
    const next = !required;
    setKbPageStateOverride(pageId, { requiredReading: next }); // optimistic
    setPending(true);
    const { error } = await setKbPageRequiredReading({
      pageId,
      required: next,
    });
    setPending(false);
    if (error) {
      setKbPageStateOverride(pageId, { requiredReading: !next }); // revert
      toast.error(`Не удалось переключить: ${error}`);
      return;
    }
    toast.success(
      next
        ? "Страница помечена как обязательная к прочтению"
        : "Снят флаг обязательного прочтения",
    );
    // НЕ зовём router.refresh() — override уже синхронизировал UI.
    // revalidatePath на сервере покрывает next-navigation для других
    // пользователей.
  };

  return (
    <IconTooltip
      label={
        required
          ? "Обязательно к прочтению (нажмите чтобы снять)"
          : "Сделать обязательным к прочтению"
      }
    >
      <button
        type="button"
        aria-label={
          required
            ? "Снять флаг обязательного прочтения"
            : "Сделать обязательным к прочтению"
        }
        aria-pressed={required}
        onClick={onToggle}
        disabled={pending}
        className="inline-flex items-center justify-center size-9 rounded-lg bg-background text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="w-[18px] h-[18px] animate-spin" />
        ) : (
          <AlertTriangle
            className={
              required
                ? "w-[18px] h-[18px] fill-yellow-400 text-yellow-600"
                : "w-[18px] h-[18px]"
            }
          />
        )}
      </button>
    </IconTooltip>
  );
}
