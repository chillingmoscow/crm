"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { toast } from "sonner";

import { IconTooltip } from "@/components/ui/icon-tooltip";
import { addKbFavorite, removeKbFavorite } from "@/lib/knowledge/favorites";
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
  const router = useRouter();
  const [favorited, setFavorited] = useState(initialFavorited);
  const [, startTransition] = useTransition();

  // Sync с server-prop'ом при навигации между страницами (компонент
  // живёт в PageHeaderActions slot'е через context, без remount'а).
  useEffect(() => {
    setFavorited(initialFavorited);
  }, [initialFavorited]);

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
        toast.error(`Не удалось обновить избранное: ${error}`);
        return;
      }
      // Refresh tree-section в KB-сайдбаре.
      router.refresh();
    });
  };

  return (
    <IconTooltip label={favorited ? "Убрать из избранного" : "В избранное"}>
      <button
        type="button"
        aria-label={favorited ? "Убрать из избранного" : "Добавить в избранное"}
        aria-pressed={favorited}
        onClick={onToggle}
        className={cn(
          "inline-flex items-center justify-center size-9 rounded-lg bg-background transition-colors",
          favorited
            ? "text-yellow-500 hover:bg-yellow-500/10"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <Star
          className={cn("w-[18px] h-[18px]", favorited && "fill-current")}
        />
      </button>
    </IconTooltip>
  );
}
