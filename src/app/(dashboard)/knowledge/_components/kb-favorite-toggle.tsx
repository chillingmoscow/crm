"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Star } from "lucide-react";
import { toast } from "sonner";

import { errorText } from "@/lib/actions/error-text";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import { addKbFavorite, removeKbFavorite } from "@/lib/knowledge/favorites";
import { KB_COMMAND_EVENT, type KbCommand } from "@/lib/kb-hotkeys";
import { cn } from "@/lib/utils";

/**
 * Star toggle для добавления/удаления страницы из «Избранного»
 * текущего юзера. Состояние оптимистично переключается, на ошибку
 * откатывается обратно. Server-side: kb_user_favorites pivot,
 * RLS гейтит на user_id = auth.uid() (см. миграцию 066).
 */
export function KbFavoriteToggle({
  pageId,
  initialFavorited,
}: {
  pageId: string;
  initialFavorited: boolean;
}) {
  const [favorited, setFavorited] = useState(initialFavorited);
  const [, startTransition] = useTransition();

  // Sync с server-prop'ом при навигации между страницами (компонент
  // живёт в PageHeaderActions slot'е через context, без remount'а).
  // pageId в deps нужен (Codex #86 P1): иначе если на page A юзер
  // оптимистично переключил state, а у page B initialFavorited такой
  // же как стал на A после toggle'а — useEffect не fires, state
  // stale'ится. С pageId каждое page-transition детерминированно
  // сбрасывает state.
  useEffect(() => {
    setFavorited(initialFavorited);
  }, [initialFavorited, pageId]);

  // Хоткей Mod+Shift+F (KB_COMMAND_EVENT) — то же, что нажатие звёздочки.
  const toggleRef = useRef<() => void>(() => {});
  useEffect(() => {
    const onCommand = (e: Event) => {
      const command = (e as CustomEvent<{ command: KbCommand }>).detail.command;
      if (command === "toggle-favorite") toggleRef.current();
    };
    window.addEventListener(KB_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(KB_COMMAND_EVENT, onCommand);
  }, []);

  const onToggle = () => {
    const next = !favorited;
    // Optimistic — мгновенно меняем UI, server-call в background.
    setFavorited(next);
    startTransition(async () => {
      const { error } = next
        ? await addKbFavorite(pageId)
        : await removeKbFavorite(pageId);
      if (error) {
        setFavorited(!next); // revert
        toast.error(errorText(error, "Не удалось обновить избранное"));
      }
      // Дерево с «Избранным» обновится само: действие вызывает
      // revalidatePath, и Next возвращает свежее дерево в ответе. Лишний
      // router.refresh() перерисовывал страницу второй раз.
    });
  };

  toggleRef.current = onToggle;

  return (
    <IconTooltip label={favorited ? "Убрать из избранного" : "Добавить в избранное"}>
      <button
        type="button"
        aria-label={favorited ? "Убрать из избранного" : "Добавить в избранное"}
        aria-pressed={favorited}
        onClick={onToggle}
        className={cn(
          "inline-flex items-center justify-center size-9 rounded-lg bg-background transition-colors",
          favorited
            ? "text-amber-500 hover:bg-amber-500/10"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <Star
          className={cn("size-[18px]", favorited && "fill-amber-400")}
        />
      </button>
    </IconTooltip>
  );
}
