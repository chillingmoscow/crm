"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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

  // Иконка-кнопка в одном ряду с контролами таблицы (search/filter/sort).
  // Стиль 1-в-1 с TableControls.TooltipIconButton.
  return (
    <Tooltip delayDuration={450}>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={refresh}
            disabled={isPending}
            aria-label="Обновить итоги"
            className="h-9 w-9 border-border text-muted-foreground hover:border-brand/40 hover:bg-background hover:text-foreground [&_svg]:h-4 [&_svg]:w-4"
          >
            {isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>Обновить итоги</TooltipContent>
    </Tooltip>
  );
}
