"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { IconTooltip } from "@/components/ui/icon-tooltip";
import { setKbPageRequiredReading } from "@/lib/knowledge/required-reading";

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
 * Visual: иконка треугольника, fill-yellow когда флаг активен,
 * muted когда нет. Клик → toggle. Optimistic update + router.refresh.
 */
export function KbRequiredReadingToggle({
  pageId,
  initialRequired,
}: KbRequiredReadingToggleProps) {
  const router = useRouter();
  const [required, setRequired] = useState(initialRequired);
  const [pending, setPending] = useState(false);

  const onToggle = async () => {
    const next = !required;
    setRequired(next); // optimistic
    setPending(true);
    const { error } = await setKbPageRequiredReading({
      pageId,
      required: next,
    });
    setPending(false);
    if (error) {
      setRequired(!next); // revert
      toast.error(`Не удалось переключить: ${error}`);
      return;
    }
    toast.success(
      next
        ? "Страница помечена как обязательная к прочтению"
        : "Снят флаг обязательного прочтения",
    );
    router.refresh();
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
