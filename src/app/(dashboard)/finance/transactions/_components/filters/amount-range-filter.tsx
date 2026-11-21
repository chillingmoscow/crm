"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { AmountInput } from "@/components/finance/amount-input";
import { TableControlPin } from "@/components/shared/table";
import { formatAmount } from "@/lib/format/amount";

export type AmountRangeValue = { min: number | null; max: number | null };

/**
 * Чип «Сумма» в ряду условий: от и до. Собран на `TableControlPin` (своих
 * чипов фильтра нет), суммы — через `AmountInput`.
 */
export function AmountRangeFilter({
  value,
  onChange,
}: {
  value: AmountRangeValue;
  onChange: (next: AmountRangeValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = value.min !== null || value.max !== null;
  const fmt = (n: number) => `${formatAmount(n, 0)} ₽`;
  const label = !active
    ? "Сумма"
    : value.min !== null && value.max !== null
      ? `${fmt(value.min)}–${fmt(value.max)}`
      : value.min !== null
        ? `От ${fmt(value.min)}`
        : `До ${fmt(value.max!)}`;

  return (
    <TableControlPin
      label={label}
      active={active}
      clearLabel="Сбросить сумму"
      onClear={() => onChange({ min: null, max: null })}
      contentClassName="w-72 p-3"
      open={open}
      onOpenChange={setOpen}
    >
      {/* Окно монтирует редактор при открытии: черновик — из текущего значения. */}
      <AmountRangeEditor
        value={value}
        onChange={(next) => {
          onChange(next);
          setOpen(false);
        }}
      />
    </TableControlPin>
  );
}

function AmountRangeEditor({
  value,
  onChange,
}: {
  value: AmountRangeValue;
  onChange: (next: AmountRangeValue) => void;
}) {
  const [min, setMin] = useState<number | null>(value.min);
  const [max, setMax] = useState<number | null>(value.max);
  const swapped = min !== null && max !== null && min > max;
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (swapped) return;
        onChange({ min, max });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="tx-amount-min">От</Label>
          <AmountInput id="tx-amount-min" value={min} onChange={setMin} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tx-amount-max">До</Label>
          <AmountInput id="tx-amount-max" value={max} onChange={setMax} />
        </div>
      </div>
      {swapped ? (
        <p className="text-xs text-destructive">«От» больше, чем «До»</p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" size="sm" className="h-8" disabled={swapped}>
          Применить
        </Button>
      </div>
    </form>
  );
}
