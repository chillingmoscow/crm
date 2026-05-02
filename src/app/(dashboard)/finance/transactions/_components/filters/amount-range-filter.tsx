"use client";

import { useEffect, useState } from "react";
import { CircleDollarSign, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type AmountRangeValue = { min: number | null; max: number | null };

type Props = {
  value: AmountRangeValue;
  onChange: (next: AmountRangeValue) => void;
};

export function AmountRangeFilter({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [tempMin, setTempMin] = useState<string>(value.min?.toString() ?? "");
  const [tempMax, setTempMax] = useState<string>(value.max?.toString() ?? "");

  useEffect(() => {
    if (open) {
      setTempMin(value.min?.toString() ?? "");
      setTempMax(value.max?.toString() ?? "");
    }
  }, [open, value.min, value.max]);

  const hasValue = value.min !== null || value.max !== null;

  const buttonText = (() => {
    if (!hasValue) return "Сумма";
    const fmt = (n: number) =>
      new Intl.NumberFormat("ru-RU", {
        style: "currency",
        currency: "RUB",
        maximumFractionDigits: 0,
      }).format(n);
    if (value.min !== null && value.max !== null) return `${fmt(value.min)} – ${fmt(value.max)}`;
    if (value.min !== null) return `От ${fmt(value.min)}`;
    return `До ${fmt(value.max!)}`;
  })();

  const apply = () => {
    const parsedMin = tempMin === "" ? null : Number(tempMin);
    const parsedMax = tempMax === "" ? null : Number(tempMax);
    onChange({
      min: Number.isFinite(parsedMin) ? (parsedMin as number) : null,
      max: Number.isFinite(parsedMax) ? (parsedMax as number) : null,
    });
    setOpen(false);
  };

  const clear = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    onChange({ min: null, max: null });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative inline-flex">
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "rounded-full h-8 pl-3 pr-8 font-normal text-sm",
              hasValue
                ? "bg-brand/10 border-brand/20 text-brand hover:bg-brand/15 hover:text-brand"
                : "bg-muted/60 border-transparent text-muted-foreground hover:bg-muted"
            )}
          >
            <CircleDollarSign className="mr-1.5 h-3.5 w-3.5" />
            <span className="truncate max-w-[160px]">{buttonText}</span>
          </Button>
        </PopoverTrigger>
        {hasValue && (
          <button
            type="button"
            onClick={clear}
            aria-label="Сбросить сумму"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-4 w-4 items-center justify-center rounded-full bg-brand text-brand-foreground hover:bg-brand/90"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <PopoverContent align="start" className="w-72 p-3 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground">От</label>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step={0.01}
              value={tempMin}
              onChange={(e) => setTempMin(e.target.value)}
              className="h-8"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">До</label>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step={0.01}
              value={tempMax}
              onChange={(e) => setTempMax(e.target.value)}
              className="h-8"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setTempMin("");
              setTempMax("");
              onChange({ min: null, max: null });
              setOpen(false);
            }}
          >
            Очистить
          </Button>
          <Button size="sm" className="bg-brand hover:bg-brand/90" onClick={apply}>
            Применить
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
