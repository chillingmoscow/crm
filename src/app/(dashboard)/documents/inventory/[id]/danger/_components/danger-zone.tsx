"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
import { Button } from "@/components/ui/button";
import { deleteInventoryDocument } from "@/app/(dashboard)/inventory/_actions/documents";

/**
 * Содержимое таба «Опасная зона» страницы акта. Сейчас здесь
 * только удаление акта. В будущем сюда могут добавиться: ручной
 * пересчёт расхождений (PR3 recount mechanic), снятие проведения,
 * перенос в другой склад/заведение.
 */
export function DangerZone({
  documentId,
  documentNumber,
}: {
  documentId: string;
  documentNumber: string;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isDeleting, startDelete] = useTransition();

  const runDelete = () => {
    startDelete(async () => {
      try {
        const result = await deleteInventoryDocument({ documentId });
        if (result.error) {
          toast.error(result.error);
          return;
        }
        toast.success(`Акт № ${documentNumber} удалён`);
        setConfirmOpen(false);
        router.push("/documents/inventory");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось удалить акт");
      }
    });
  };

  return (
    <div className="mx-auto w-full max-w-[720px]">
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5">
        <h2 className="text-base font-semibold text-foreground">Удалить акт</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Удалит акт и все его позиции. Если акт пришёл из Quick Resto, он может
          вернуться при следующей синхронизации — для безвозвратного удаления
          сделай то же самое в QR.
        </p>
        <Button
          variant="destructive"
          className="mt-4"
          onClick={() => setConfirmOpen(true)}
        >
          <Trash2 className="h-4 w-4" />
          Удалить акт
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить акт № {documentNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              Это удалит акт и все его позиции. Если акт пришёл из Quick Resto,
              он может вернуться при следующей синхронизации.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(e) => {
                e.preventDefault();
                runDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
