"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { emptyKbTrash } from "@/lib/knowledge/pages";

/** Кнопка «Очистить корзину» с обязательным подтверждением.
 *  `count` — число корневых страниц в корзине (для текста диалога). */
export function KbEmptyTrashButton({ count }: { count: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const onConfirm = () => {
    startTransition(async () => {
      const { deleted, error } = await emptyKbTrash();
      if (error) {
        toast.error(`Не удалось очистить корзину: ${error}`);
        return;
      }
      toast.success(
        deleted > 0 ? `Корзина очищена (${deleted})` : "Корзина уже пуста",
      );
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={pending}
      >
        <Trash2 />
        Очистить корзину
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Очистить корзину?"
        confirmLabel="Очистить корзину"
        destructive
        consequences={[
          {
            kind: "remove",
            text: "Страницы в корзине и их подстраницы удалятся",
            count,
          },
          { kind: "irreversible", text: "Удаление нельзя отменить" },
        ]}
        onConfirm={() => {
          setOpen(false);
          onConfirm();
        }}
      />
    </>
  );
}
