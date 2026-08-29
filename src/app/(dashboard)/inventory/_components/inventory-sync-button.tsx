"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { syncQuickRestoInventory } from "@/app/(dashboard)/inventory/_actions/sync";

type Props = {
  canSync: boolean;
  lastSyncedAt: string | null;
};

// Полная синхронизация QuickResto (группы, ингредиенты, склады, акты).
// Гранулярная синхронизация по типу позиции — отдельная задача (бэклог,
// требует расширения scope в syncQuickRestoInventory на бэкенде).
export function InventorySyncButton({ canSync, lastSyncedAt }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const runSync = () => {
    startTransition(async () => {
      try {
        const result = await syncQuickRestoInventory({ scope: "full" });
        if (result.error || !result.summary) {
          toast.error(result.error ?? "Синхронизация не выполнена");
          return;
        }
        const base = `Синхронизировано: позиций ${result.summary.products}, складов ${result.summary.stores}, актов ${result.summary.documents}`;
        // Сбойные акты не роняют проход, но и молчать о них нельзя.
        if (result.summary.failedDocuments > 0) {
          toast.warning(`${base}. Не удалось обработать актов: ${result.summary.failedDocuments}`);
        } else {
          toast.success(base);
        }
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Синхронизация не выполнена");
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      {canSync ? (
        <Button type="button" onClick={runSync} disabled={isPending}>
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="ml-2">Синхронизировать с QuickResto</span>
        </Button>
      ) : null}
      <span className="text-xs text-muted-foreground">
        Последняя синхронизация:{" "}
        {lastSyncedAt ? new Date(lastSyncedAt).toLocaleString("ru-RU") : "—"}
      </span>
    </div>
  );
}
