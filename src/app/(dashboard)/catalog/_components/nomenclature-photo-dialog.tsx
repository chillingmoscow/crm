"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, Package, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { removeInventoryProductImage } from "@/app/(dashboard)/inventory/_actions/catalog";

import { useCatalogPhotoUpload } from "./use-catalog-photo-upload";

/**
 * Фото позиции крупно. В шапке карточки фото маленькое (56px), а узнавать
 * позицию на полке по нему должны с телефона — поэтому просмотр отдельный.
 * Замена и удаление — здесь же, удаление с подтверждением.
 */
export function NomenclaturePhotoDialog({
  open,
  onOpenChange,
  productId,
  name,
  imageUrl,
  canManage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  name: string;
  imageUrl: string | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const photo = useCatalogPhotoUpload();
  const uploading = photo.pendingId === productId;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, startRemove] = useTransition();

  const remove = () => {
    setRemoveError(null);
    startRemove(async () => {
      try {
        const result = await removeInventoryProductImage({ productId });
        if (result.error) {
          setRemoveError(result.error);
          return;
        }
        toast.success("Фото удалено");
        setConfirmOpen(false);
        router.refresh();
      } catch {
        setRemoveError("Не удалось удалить фото. Проверьте подключение и повторите");
      }
    });
  };

  return (
    <>
      {photo.input}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Фото позиции</DialogTitle>
            <DialogDescription className="truncate">{name}</DialogDescription>
          </DialogHeader>
          <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
            {imageUrl ? (
              // Подписанная ссылка хранилища: оптимизатор next/image её не ждёт.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt={name} className="size-full object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-2 text-sm">
                <Package className="size-8" aria-hidden />
                Фото пока нет
              </div>
            )}
            {uploading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                <Loader2 className="size-6 animate-spin" aria-label="Загружаем фото" />
              </div>
            ) : null}
          </div>
          {canManage ? (
            <DialogFooter className="gap-2 sm:space-x-0">
              {imageUrl ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive sm:mr-auto"
                  aria-label="Удалить фото"
                  data-tip="Удалить фото"
                  disabled={uploading}
                  onClick={() => {
                    setRemoveError(null);
                    setConfirmOpen(true);
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Закрыть
              </Button>
              <Button
                className="min-w-40"
                disabled={uploading}
                onClick={() => photo.pick({ type: "product", id: productId })}
              >
                <ImagePlus className="size-4" />
                {uploading ? "Загружаем…" : imageUrl ? "Заменить фото" : "Загрузить фото"}
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(next) => {
          setConfirmOpen(next);
          if (!next) setRemoveError(null);
        }}
        title="Удалить фото позиции?"
        description="Фото пропадёт из каталога и из формы акта. Потом можно загрузить новое"
        confirmLabel="Удалить фото"
        pendingLabel="Удаляем…"
        destructive
        busy={removing}
        error={removeError}
        onConfirm={remove}
      />
    </>
  );
}
