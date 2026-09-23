"use client";

// ВРЕМЕННО (диагностика #3): кнопка-проба структуры QR-номенклатуры блюд и
// полуфабрикатов. Удаляется вместе с probeQuickRestoNomenclature после того, как
// структура подтверждена и реальный синк построен.

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { probeQuickRestoNomenclature } from "@/app/(dashboard)/inventory/_actions/sync";

export function NomenclatureProbeButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const run = () => {
    startTransition(async () => {
      const res = await probeQuickRestoNomenclature();
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setResult(JSON.stringify(res.result, null, 2));
    });
  };

  return (
    <div className="mt-8 rounded-lg border border-dashed border-amber-400/50 bg-amber-500/5 p-4">
      <div className="text-sm font-medium">Диагностика: структура номенклатуры (блюда / полуфабрикаты)</div>
      <p className="mt-1 text-xs text-muted-foreground">
        Временная проба перед импортом блюд и полуфабрикатов. Ничего не сохраняет —
        только читает первый образец каждого типа из Quick Resto.
      </p>
      <Button type="button" variant="outline" size="sm" className="mt-3" disabled={pending} onClick={run}>
        {pending ? "Пробуем…" : "Запустить пробу"}
      </Button>

      <Dialog open={result !== null} onOpenChange={(open) => !open && setResult(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Структура номенклатуры Quick Resto</DialogTitle>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded bg-muted p-3 text-xs">{result}</pre>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              if (result) navigator.clipboard?.writeText(result);
              toast.success("Скопировано");
            }}
          >
            Копировать
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
