"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { pluralRu } from "@/lib/format/plural";
import {
  returnDocumentForRecount,
  splitDocumentForRecount,
} from "@/app/(dashboard)/inventory/actions";
import { defaultRecountMode, isoDay, recountGapDays } from "@/lib/inventory/recount-split";

type Props = {
  documentId: string;
  /** Дата акта (ISO). Нужна, чтобы предложить правильный режим по умолчанию. */
  documentInvoiceDate: string | null;
  flaggedCount: number;
  disabled: boolean;
};

function todayIso() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

/**
 * Развилка при отправке на пересчёт.
 *
 * Расчётный остаток в Quick Resto привязан к дате акта. Если пересчёт делают
 * другим днём, сравнивать его факт с остатком на дату акта нельзя: поставка
 * между датами станет излишком, продажи — недостачей. Поэтому предлагаем
 * вынести такие позиции в отдельный акт с датой пересчёта.
 */
export function RecountSplitDialog({ documentId, documentInvoiceDate, flaggedCount, disabled }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const today = todayIso();
  const actDay = isoDay(documentInvoiceDate);

  // Умный дефолт: акт сегодняшний — считаем в нём же; иначе отдельный акт.
  const [mode, setMode] = useState(() => defaultRecountMode(documentInvoiceDate, today));
  const [recountDate, setRecountDate] = useState(today);
  const gapDays = recountGapDays(documentInvoiceDate, recountDate);

  const rowsLabel = useMemo(
    () => `${flaggedCount} ${pluralRu(flaggedCount, "строка", "строки", "строк")}`,
    [flaggedCount],
  );

  const submit = () => {
    startTransition(async () => {
      const result =
        mode === "inplace"
          ? await returnDocumentForRecount({ documentId })
          : await splitDocumentForRecount({ documentId, recountDate });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        mode === "inplace"
          ? `Акт отправлен на пересчёт (${rowsLabel})`
          : `Позиции вынесены в акт пересчёта на ${recountDate} (${rowsLabel})`,
      );
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled || flaggedCount === 0}>
          <RotateCcw className="mr-2 h-4 w-4" />
          Отправить на пересчёт{flaggedCount > 0 ? ` (${flaggedCount})` : ""}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Пересчёт: {rowsLabel}</DialogTitle>
          <DialogDescription>
            Когда пересчёт делают позже даты акта, факт сравнивается с остатком на дату акта —
            поставка между датами превратится в излишек, а продажи в недостачу.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setMode("inplace")}
            className={cn(
              "w-full rounded-lg border p-3 text-left transition-colors",
              mode === "inplace" ? "border-primary bg-muted/40" : "border-border hover:bg-muted/30",
            )}
          >
            <div className="text-sm font-medium">Пересчитают сегодня</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Акт возвращается исполнителю, позиции остаются в нём. Подходит, если пересчёт будет в
              тот же учётный день, что и подсчёт.
            </div>
          </button>

          <button
            type="button"
            onClick={() => setMode("split")}
            className={cn(
              "w-full rounded-lg border p-3 text-left transition-colors",
              mode === "split" ? "border-primary bg-muted/40" : "border-border hover:bg-muted/30",
            )}
          >
            <div className="text-sm font-medium">Пересчитают другим днём</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Отмеченные позиции переезжают в отдельный акт пересчёта с датой пересчёта — Quick
              Resto посчитает по ним остаток на эту дату. Из текущего акта они удаляются, и его
              можно проводить сразу.
            </div>
            {mode === "split" ? (
              <div className="mt-3 flex flex-wrap items-center gap-2" onClick={(event) => event.stopPropagation()}>
                <Label htmlFor="recount-date" className="text-xs">
                  Дата пересчёта
                </Label>
                <Input
                  id="recount-date"
                  type="date"
                  value={recountDate}
                  min={actDay ?? undefined}
                  onChange={(event) => setRecountDate(event.target.value)}
                  className="h-8 w-40"
                />
                {gapDays !== null && gapDays > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    на {gapDays} {pluralRu(gapDays, "день", "дня", "дней")} позже даты акта
                  </span>
                ) : null}
              </div>
            ) : null}
          </button>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
            Отмена
          </Button>
          <Button type="button" onClick={submit} disabled={isPending || (mode === "split" && !recountDate)}>
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {mode === "inplace" ? "Отправить на пересчёт" : "Вынести в акт пересчёта"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
