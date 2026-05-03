"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2, X, Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
  DialogClose,
  DialogDescription,
} from "@/components/ui/dialog";
import { exportKbPageAsMarkdown, softDeleteKbPage } from "@/lib/knowledge/pages";

interface KbPageActionsProps {
  pageId: string;
  pageTitle: string;
  /** Number of direct children — surfaced in the delete confirm. */
  childCount: number;
  canDelete: boolean;
}

/**
 * Page-level actions: delete (soft) + (future: rename / move /
 * duplicate). Restore happens from the trash view, not here.
 *
 * Soft delete is reversible — the row stays in the DB with
 * `deleted_at` set. Users with `kb.delete_pages` see deleted
 * rows in /knowledge/trash (Stage 8.7) and can restore.
 *
 * Children of the deleted page become orphaned but stay visible
 * in the tree as roots (see assembleTree() in lib/knowledge/tree.ts).
 * That's an MVP trade-off — cascading soft-delete is a future cleanup.
 */
export function KbPageActions({
  pageId,
  pageTitle,
  childCount,
  canDelete,
}: KbPageActionsProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Export доступен всем у кого `kb.view_pages` (а это любой, кто
  // вообще видит эту страницу — RLS уже отфильтровала). Поэтому не
  // делаем дополнительной permission-проверки: если страница рендерится,
  // юзер вправе её скачать.

  const onExport = async () => {
    setExporting(true);
    try {
      const { markdown, filename, error } = await exportKbPageAsMarkdown(pageId);
      if (error || !markdown || !filename) {
        toast.error(`Не удалось экспортировать: ${error ?? "неизвестная ошибка"}`);
        return;
      }
      // Скачивание через Blob + временный <a> — без библиотек,
      // работает во всех современных браузерах.
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const onDelete = async () => {
    setPending(true);
    const { error } = await softDeleteKbPage(pageId);
    setPending(false);
    if (error) {
      toast.error(`Не удалось удалить: ${error}`);
      return;
    }
    toast.success("Страница перемещена в корзину");
    setOpen(false);
    router.push("/knowledge");
    router.refresh();
  };

  return (
    <>
      <IconTooltip label="Скачать как Markdown">
        <button
          type="button"
          aria-label="Скачать как Markdown"
          onClick={onExport}
          disabled={exporting}
          className="inline-flex items-center justify-center size-9 rounded-lg bg-background text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
        >
          {exporting ? (
            <Loader2 className="w-[18px] h-[18px] animate-spin" />
          ) : (
            <Download className="w-[18px] h-[18px]" />
          )}
        </button>
      </IconTooltip>
      {canDelete && (
        <DeleteDialog
          open={open}
          setOpen={setOpen}
          onDelete={onDelete}
          pending={pending}
          pageTitle={pageTitle}
          childCount={childCount}
        />
      )}
    </>
  );
}

interface DeleteDialogProps {
  open: boolean;
  setOpen: (v: boolean) => void;
  onDelete: () => Promise<void> | void;
  pending: boolean;
  pageTitle: string;
  childCount: number;
}

function DeleteDialog({ open, setOpen, onDelete, pending, pageTitle, childCount }: DeleteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <IconTooltip label="Удалить страницу">
        <DialogTrigger asChild>
          {/* Top-bar icon button — стиль iedpv (36×36, no border,
              18px icon). Hover уезжает в destructive-цвет, чтобы
              помечать destructive intent. */}
          <button
            type="button"
            aria-label="Удалить страницу"
            className="inline-flex items-center justify-center size-9 rounded-lg bg-background text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <Trash2 className="w-[18px] h-[18px]" />
          </button>
        </DialogTrigger>
      </IconTooltip>
      {/* Дизайн по sheerly.pen → z8BoQL: 440px, header с иконкой-
          бэйджем и кастомной close-кнопкой, body-hint, footer с
          разделителем-сверху. Стандартный shadcn close спрятан
          через [&>button:last-child]:hidden. */}
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
          Восстановить из корзины можно в течение 30 дней
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Отмена
          </Button>
          <Button variant="destructive" onClick={onDelete} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            Удалить
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
