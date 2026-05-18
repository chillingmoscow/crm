"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { hardDeleteKbPage, restoreKbPage } from "@/lib/knowledge/pages";

interface KbDeletedPageBannerProps {
  pageId: string;
  pageSlug: string;
  title: string;
  deletedAt: string | null;
  deletedByName: string | null;
  descendantsCount: number;
  /** `kb.delete_pages` — управляет показом действий. По RLS саму
   *  страницу и так видит только обладатель права, но гейтим явно. */
  canManage: boolean;
}

/**
 * Notion-style баннер «страница в корзине». Удалённая страница
 * больше не 404-ит: открывается read-only (редактор передаётся с
 * canEditBase=false), а сверху висит этот баннер с действиями
 * «Восстановить» / «Удалить навсегда». Каскад: восстановление/
 * удаление забирает всю ветку подстраниц.
 */
export function KbDeletedPageBanner({
  pageId,
  pageSlug,
  title,
  deletedAt,
  deletedByName,
  descendantsCount,
  canManage,
}: KbDeletedPageBannerProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const meta: string[] = [];
  if (deletedAt) {
    meta.push(
      `удалена ${formatDistanceToNow(new Date(deletedAt), {
        addSuffix: true,
        locale: ru,
      })}`,
    );
  }
  if (deletedByName) meta.push(deletedByName);
  if (descendantsCount > 0) {
    meta.push(`+ ${descendantsCount} ${childWord(descendantsCount)}`);
  }

  const onRestore = () => {
    startTransition(async () => {
      const { error } = await restoreKbPage(pageId);
      if (error) {
        toast.error(`Не удалось восстановить: ${error}`);
        return;
      }
      toast.success("Страница восстановлена");
      router.replace(`/knowledge/${pageSlug}`);
      router.refresh();
    });
  };

  const onHardDelete = () => {
    startTransition(async () => {
      const { error } = await hardDeleteKbPage(pageId);
      if (error) {
        toast.error(`Не удалось удалить: ${error}`);
        return;
      }
      toast.success("Страница удалена навсегда");
      router.replace("/knowledge/trash");
      router.refresh();
    });
  };

  return (
    <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 border-b border-destructive/30 bg-destructive/5 px-6 py-3 md:px-8">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <Trash2 className="size-4 shrink-0 text-destructive" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            «{title || "Без названия"}» в корзине — только для чтения
          </p>
          {meta.length > 0 && (
            <p className="truncate text-xs text-muted-foreground">
              {meta.join(" · ")}
            </p>
          )}
        </div>
      </div>

      {canManage && (
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            onClick={onRestore}
            disabled={pending}
            className="gap-1.5"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RotateCcw className="size-4" />
            )}
            Восстановить
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirmDelete(true)}
            disabled={pending}
            className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-4" />
            Удалить навсегда
          </Button>
        </div>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить навсегда?</AlertDialogTitle>
            <AlertDialogDescription>
              «{title || "Без названия"}»
              {descendantsCount > 0
                ? ` и ${descendantsCount} ${childWord(descendantsCount)}`
                : ""}{" "}
              будут удалены безвозвратно. Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={onHardDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Удалить навсегда
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function childWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "подстраниц";
  if (mod10 === 1) return "подстраница";
  if (mod10 >= 2 && mod10 <= 4) return "подстраницы";
  return "подстраниц";
}
