"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { softDeleteKbPage } from "@/lib/knowledge/pages";

interface KbDeletePageDialogProps {
  pageId: string;
  pageTitle: string;
  /** Number of direct + cascade descendants — surfaced in the
   *  confirm-dialog ("страница и все её подстраницы (N) ..."). */
  childCount: number;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Удаляем ли страницу, на которой пользователь сейчас находится.
   *  true (из ⋯-меню страницы) → уводим с неё на /knowledge. false
   *  (из меню узла дерева) → НЕ навигируем: остаёмся где были,
   *  только обновляем дерево. По умолчанию true (безопасно). */
  isCurrentPage?: boolean;
}

/**
 * Подтверждение soft-delete'а страницы. Извлечено из `KbPageActions`,
 * потому что новая ⋯-меню (`KbPageMenu`) триггерит его как пункт-айтем
 * без отдельной icon-button-кнопки в топбаре. Оба компонента теперь
 * импортируют этот dialog и владеют его open-state'ом сами.
 *
 * Soft-delete cascade через `softDeleteKbPage` (RPC kb_soft_delete_cascade,
 * миграция 063). После успеха — toast «Страница перемещена в корзину»
 * + redirect в /knowledge.
 */
export function KbDeletePageDialog({
  pageId,
  pageTitle,
  childCount,
  open,
  onOpenChange,
  isCurrentPage = true,
}: KbDeletePageDialogProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const onDelete = async () => {
    setPending(true);
    const { error } = await softDeleteKbPage(pageId);
    setPending(false);
    if (error) {
      toast.error(`Не удалось удалить: ${error}`);
      return;
    }
    // Без success-toast'а: redirect на /knowledge + исчезновение страницы
    // из tree сами по себе достаточный feedback. Дублирующий toast
    // отвлекал пользователя.
    onOpenChange(false);
    if (isCurrentPage) {
      // Удалили страницу, на которой стояли — нужно с неё уйти.
      router.push("/knowledge");
      router.refresh();
    } else {
      // Удалили чужую страницу из дерева — остаёмся где были,
      // просто обновляем дерево (никаких перекидываний на дашборд).
      router.refresh();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px] p-0 gap-0 [&>button:last-child]:hidden">
        <div className="flex items-start gap-3.5 px-6 pt-6 pb-4">
          <span className="inline-flex shrink-0 items-center justify-center size-10 rounded-full bg-destructive/10 text-destructive">
            <Trash2 className="size-[18px]" />
          </span>
          <div className="flex-1 flex flex-col gap-1.5 min-w-0">
            <DialogTitle className="text-[17px] font-semibold leading-tight tracking-tight text-foreground">
              Удалить «{pageTitle || "Без названия"}»?
            </DialogTitle>
            <DialogDescription className="text-sm leading-snug text-muted-foreground">
              {childCount > 0 ? (
                <>
                  Страница и все её подстраницы ({childCount}) будут
                  перемещены в корзину.
                </>
              ) : (
                <>Страница будет перемещена в корзину.</>
              )}
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <button
              type="button"
              aria-label="Закрыть"
              className="inline-flex shrink-0 items-center justify-center size-7 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <X className="size-4" />
            </button>
          </DialogClose>
        </div>
        <div className="px-6 pb-4 pl-[78px] text-[13px] leading-snug text-muted-foreground">
          Восстановить страницу можно из корзины
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Отмена
          </Button>
          <Button variant="destructive" onClick={onDelete} disabled={pending}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            Удалить
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
