"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { restoreKbPage } from "@/lib/knowledge/pages";

/** Инлайн-кнопка «Восстановить» в строке журнала рядом с событием
 *  удаления. Видна только если страница ещё в корзине и у юзера есть
 *  право kb.delete_pages (проверяется на странице журнала + RPC
 *  kb_restore_cascade гейтит ещё раз). Каскадно возвращает ветку. */
export function KbAuditRestoreButton({ pageId }: { pageId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onRestore = () => {
    startTransition(async () => {
      const { restored, error } = await restoreKbPage(pageId);
      if (error) {
        toast.error(`Не удалось восстановить: ${error}`);
        return;
      }
      toast.success(
        restored > 1
          ? `Восстановлено страниц: ${restored}`
          : "Страница восстановлена",
      );
      router.refresh();
    });
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 shrink-0 border-brand/30 text-brand hover:bg-brand/10 hover:text-brand"
      disabled={pending}
      onClick={onRestore}
    >
      <RotateCcw />
      Восстановить
    </Button>
  );
}
