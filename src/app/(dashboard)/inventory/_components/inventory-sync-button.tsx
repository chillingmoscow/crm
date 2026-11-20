"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { LocalDateTime, useLocalDateTimeText } from "@/components/shared/local-date-time";
import { syncQuickRestoInventory } from "@/app/(dashboard)/inventory/_actions/sync";

type Props = {
  canSync: boolean;
  lastSyncedAt: string | null;
  /**
   * `stacked` — кнопка и строка «Последняя синхронизация» под ней (страницы,
   * ещё не приведённые к эталону шапки). `toolbar` — кнопка 36px для ряда
   * инструментов списка (docs/design-system.md, «Page header»): время
   * последней синхронизации уходит в подсказку, второй строки нет.
   */
  layout?: "stacked" | "toolbar";
};

// Полная синхронизация QuickResto (группы, ингредиенты, склады, акты).
// Гранулярная синхронизация по типу позиции — отдельная задача (бэклог,
// требует расширения scope в syncQuickRestoInventory на бэкенде).
export function InventorySyncButton({ canSync, lastSyncedAt, layout = "stacked" }: Props) {
  const router = useRouter();
  const lastSyncedText = useLocalDateTimeText(lastSyncedAt, "ещё не было");
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
        // Восстановленные связи показываем, только когда они были: это редкое
        // событие (позиция появилась в каталоге позже, чем импортировался акт),
        // и в обычном прогоне лишняя цифра только зашумила бы сообщение.
        const withRelinked =
          result.summary.relinked > 0
            ? `${base}. Восстановлено связей в актах: ${result.summary.relinked}`
            : base;
        // Сбойные акты не роняют проход, но и молчать о них нельзя.
        if (result.summary.failedDocuments > 0) {
          toast.warning(`${withRelinked}. Не удалось обработать актов: ${result.summary.failedDocuments}`);
        } else {
          toast.success(withRelinked);
        }
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Синхронизация не выполнена");
      }
    });
  };

  if (layout === "toolbar") {
    if (!canSync) return null;
    return (
      // Подсказка — на обёртке: у неактивной кнопки (идёт синхронизация)
      // pointer-events выключены, события получает span.
      <span
        className="inline-flex"
        data-tip="Загрузить склады, номенклатуру и акты из Quick Resto"
        data-tip-sub={`Последняя синхронизация: ${lastSyncedText}`}
      >
        <Button type="button" size="sm" className="h-9 min-w-44 gap-2" onClick={runSync} disabled={isPending}>
          {isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {isPending ? "Синхронизируем…" : "Синхронизировать"}
        </Button>
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {canSync ? (
        <Button type="button" onClick={runSync} disabled={isPending}>
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="ml-2">Синхронизировать с Quick Resto</span>
        </Button>
      ) : null}
      <span className="text-xs text-muted-foreground">
        Последняя синхронизация: <LocalDateTime value={lastSyncedAt} />
      </span>
    </div>
  );
}
