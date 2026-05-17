"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { IconTooltip } from "@/components/ui/icon-tooltip";
import { restoreKbPage } from "@/lib/knowledge/pages";

/**
 * Компактная кнопка-иконка «Восстановить» для удалённой KB-страницы
 * в общем журнале. Без громоздкой текстовой кнопки — только иконка +
 * подсказка при наведении (по просьбе юзера). Каскадно возвращает
 * страницу из корзины (RPC kb_restore_cascade гейтит kb.delete_pages
 * ещё раз — defense in depth).
 */
export function KbRestoreIconButton({ pageId }: { pageId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onRestore = () => {
    startTransition(async () => {
      const { restored, error } = await restoreKbPage(pageId);
      if (error) {
        toast.error(`Не удалось восстановить: ${error}`);
        return;
      }
      toast.success(
        restored > 1
          ? `Восстановлено страниц: ${restored}`
          : "Страница восстановлена",
      );
      router.refresh();
    });
  };

  return (
    <IconTooltip label="Восстановить из корзины">
      <button
        type="button"
        aria-label="Восстановить из корзины"
        disabled={pending}
        onClick={onRestore}
        className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-brand hover:bg-accent transition-colors disabled:opacity-50"
      >
        <RotateCcw className="size-3.5" />
      </button>
    </IconTooltip>
  );
}
