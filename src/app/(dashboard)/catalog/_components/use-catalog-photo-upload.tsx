"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  uploadInventoryProductGroupImage,
  uploadInventoryProductImage,
} from "@/app/(dashboard)/inventory/_actions/catalog";

type Target = { type: "product" | "group"; id: string };

/**
 * Загрузка фото позиции или категории из меню строки и карточки: одно
 * скрытое поле файла на экран, цель запоминается перед открытием выбора.
 * Пока идёт загрузка, `pendingId` — id цели (строка показывает ожидание).
 */
export function useCatalogPhotoUpload() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<Target | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const upload = (file: File | null) => {
    const target = targetRef.current;
    if (!file || !target) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Можно загрузить только изображение");
      return;
    }
    const formData = new FormData();
    formData.set(target.type === "group" ? "groupId" : "productId", target.id);
    formData.set("file", file);
    setPendingId(target.id);
    startTransition(async () => {
      try {
        const result =
          target.type === "group"
            ? await uploadInventoryProductGroupImage(formData)
            : await uploadInventoryProductImage(formData);
        if (result.error) {
          toast.error(result.error);
          return;
        }
        toast.success(target.type === "group" ? "Фото категории обновлено" : "Фото обновлено");
        router.refresh();
      } catch {
        toast.error("Не удалось загрузить фото. Проверьте подключение и повторите");
      } finally {
        setPendingId(null);
      }
    });
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      className="hidden"
      aria-hidden
      tabIndex={-1}
      onChange={(event) => {
        upload(event.target.files?.[0] ?? null);
        // Тот же файл можно выбрать повторно: без сброса onChange не сработает.
        event.target.value = "";
      }}
    />
  );

  const pick = (target: Target) => {
    targetRef.current = target;
    inputRef.current?.click();
  };

  return { input, pick, pendingId };
}
