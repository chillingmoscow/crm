"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/icon-tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { softDeleteKbPage } from "@/lib/knowledge/pages";

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

  if (!canDelete) return null;

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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Удалить страницу?</DialogTitle>
          <DialogDescription>
            «{pageTitle || "Без названия"}» переместится в корзину.{" "}
            {childCount > 0 ? (
              <>
                Все подстраницы ({childCount}) удалятся вместе с ней
                и вернутся в той же иерархии при восстановлении.{" "}
              </>
            ) : null}
            Удалённое можно восстановить из корзины.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Отмена
          </Button>
          <Button variant="destructive" onClick={onDelete} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            Удалить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
