"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { refreshInventoryDocumentResults } from "@/app/(dashboard)/inventory/actions";

export function RefreshResultsButton({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const refresh = () => {
    startTransition(async () => {
      const result = await refreshInventoryDocumentResults({ documentId });
      if (result.error) {
        toast.error(result.error);
        return;
      }

      if (!result.processed) {
        toast.info("Акт обновлен, но в Quick Resto он еще не проведен");
      } else if (result.resultsHasLineAmounts) {
        toast.success("Итоги из Quick Resto обновлены");
      } else {
        toast.info("Итоги обновлены, но QR не вернул построчные расчеты");
      }
      router.refresh();
    });
  };

  // Кнопка с подписью в одном ряду с контролами таблицы. h-9 — чтобы
  // высота совпадала с иконками-кнопками TableControls. Без ml-2: интервал
  // между иконкой и текстом даёт встроенный gap-2 у Button (экономит ширину
  // на мобильном, где ряд кнопок и так впритык).
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={refresh}
      disabled={isPending}
      className="h-9"
    >
      {isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <RefreshCw className="h-4 w-4" />
      )}
      Обновить итоги
    </Button>
  );
}
