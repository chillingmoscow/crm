"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-4" />
          Удалить
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Удалить страницу?</DialogTitle>
          <DialogDescription>
            «{pageTitle || "Без названия"}» переместится в корзину.{" "}
            {childCount > 0 ? (
              <>
                Подстраницы ({childCount}) останутся в дереве как корневые
                до отдельной чистки.{" "}
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
