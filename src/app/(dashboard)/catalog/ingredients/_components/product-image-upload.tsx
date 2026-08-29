"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, ImagePlus, Loader2, Package, Pencil } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadInventoryProductImage } from "@/app/(dashboard)/inventory/_actions/catalog";

type Props = {
  productId: string;
  /** "button" — компактная кнопка (дерево каталога, дефолт). "box" —
      кликабельная плашка-превью (карточка ингредиента): клик по плашке
      открывает выбор файла, подсказка «Добавить фото» (пусто) /
      «Изменить» (по ховеру, если фото уже есть). */
  variant?: "button" | "box";
  imageUrl?: string | null;
  name?: string;
};

export function ProductImageUpload({ productId, variant = "button", imageUrl, name }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  const handleFile = (file: File | null) => {
    if (!file) return;
    const formData = new FormData();
    formData.set("productId", productId);
    formData.set("file", file);

    setBusy(true);
    startTransition(async () => {
      const result = await uploadInventoryProductImage(formData);
      setBusy(false);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Фото обновлено");
      router.refresh();
    });
  };

  const loading = busy || isPending;

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      className="hidden"
      onChange={(event) => handleFile(event.target.files?.[0] ?? null)}
    />
  );

  if (variant === "box") {
    const hasImage = Boolean(imageUrl);
    return (
      <>
        {fileInput}
        <button
          type="button"
          disabled={loading}
          onClick={() => inputRef.current?.click()}
          aria-label={hasImage ? "Изменить фото" : "Добавить фото"}
          className="group relative flex h-40 w-40 items-center justify-center overflow-hidden rounded-lg border bg-muted transition-colors hover:border-foreground/30 disabled:cursor-not-allowed"
        >
          {hasImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl as string} alt={name ?? ""} className="h-full w-full object-cover" />
          ) : (
            <Package className="h-8 w-8 text-muted-foreground" />
          )}
          <span
            className={cn(
              "absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-background/85 py-1.5 text-xs font-medium text-foreground backdrop-blur-sm transition-opacity",
              hasImage ? "opacity-0 group-hover:opacity-100" : "opacity-100",
            )}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : hasImage ? (
              <>
                <Pencil className="h-3.5 w-3.5" /> Изменить
              </>
            ) : (
              <>
                <ImagePlus className="h-3.5 w-3.5" /> Добавить фото
              </>
            )}
          </span>
        </button>
      </>
    );
  }

  return (
    <>
      {fileInput}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={loading}
        onClick={() => inputRef.current?.click()}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Camera className="h-4 w-4" />
        )}
        <span className="ml-2">Фото</span>
      </Button>
    </>
  );
}
