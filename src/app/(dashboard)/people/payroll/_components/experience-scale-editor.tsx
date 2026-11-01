"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { AmountInput } from "@/components/finance/amount-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Row = { id: string; months: string; amount: number | null };
function readRows(rows: Row[]): {
  value: Record<string, number>;
  error: string;
} {
  const value: Record<string, number> = {};
  if (rows.length === 0)
    return {
      value,
      error: "Добавьте хотя бы одну ступень или выключите надбавку за стаж",
    };
  for (const row of rows) {
    if (!/^\d{1,4}$/.test(row.months.trim()))
      return {
        value,
        error: "Укажите стаж целым числом от 0 до 9 999 месяцев",
      };
    const month = String(Number(row.months));
    if (month in value)
      return { value, error: `Ступень с ${month} месяцев уже есть в шкале` };
    if (
      row.amount === null ||
      !Number.isFinite(row.amount) ||
      row.amount < 0 ||
      row.amount > 1000000 ||
      Math.abs(row.amount * 100 - Math.round(row.amount * 100)) > 0.00001
    )
      return {
        value,
        error: "Укажите надбавку от 0 до 1 000 000 ₽ с точностью до копейки",
      };
    value[month] = row.amount;
  }
  return { value, error: "" };
}

/** Edits the complete amount at a tenure threshold, matching the payroll engine. */
export function ExperienceScaleEditor({
  value,
  onChange,
  onError,
  disabled = false,
}: {
  value: Record<string, number>;
  onChange: (value: Record<string, number>) => void;
  onError: (error: string) => void;
  disabled?: boolean;
}) {
  const field = useId(),
    nextId = useRef(0);
  const lastMonthInput = useRef<HTMLInputElement>(null),
    focusAdded = useRef(false);
  const [rows, setRows] = useState<Row[]>(() =>
    Object.entries(value)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([months, amount]) => ({
        id: `${field}-${months}`,
        months,
        amount,
      })),
  );
  const error = readRows(rows).error;
  useEffect(() => {
    onError(error);
  }, [error, onError]);
  useEffect(() => {
    if (!focusAdded.current) return;
    focusAdded.current = false;
    lastMonthInput.current?.scrollIntoView({ block: "nearest" });
    lastMonthInput.current?.focus({ preventScroll: true });
  }, [rows]);
  const update = (next: Row[]) => {
    setRows(next);
    const parsed = readRows(next);
    onError(parsed.error);
    if (!parsed.error || next.length === 0) onChange(parsed.value);
  };
  const add = () => {
    const used = new Set(rows.map((row) => Number(row.months)));
    let months = Math.max(0, ...used) + 1;
    if (months > 9999) {
      months = 0;
      while (used.has(months) && months <= 9999) months++;
    }
    focusAdded.current = true;
    update([
      ...rows,
      {
        id: `${field}-new-${++nextId.current}`,
        months: String(months),
        amount: null,
      },
    ]);
  };
  return (
    <section className="space-y-3" aria-label="Шкала стажа">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-medium">Шкала стажа</h4>
        <span className="text-xs text-muted-foreground">
          Ступеней: {rows.length}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Полная надбавка за смену после указанного количества месяцев.
      </p>
      {rows.length > 0 ? (
        <div className="overflow-hidden rounded-lg border">
          <div
            className="grid grid-cols-[76px_minmax(0,1fr)_32px] items-end gap-3 border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
            aria-hidden="true"
          >
            <span>Стаж от, мес.</span>
            <span className="text-right">Надбавка за смену</span>
            <span />
          </div>
          <div
            className="max-h-80 space-y-2 overflow-y-auto overscroll-contain p-3"
            role="group"
            aria-label="Ступени стажа"
          >
            {rows.map((row, index) => (
              <div
                key={row.id}
                className="grid grid-cols-[76px_minmax(0,1fr)_32px] items-center gap-3"
              >
                <Input
                  ref={index === rows.length - 1 ? lastMonthInput : undefined}
                  aria-label={`Стаж в месяцах, ступень ${index + 1}`}
                  inputMode="numeric"
                  maxLength={4}
                  value={row.months}
                  disabled={disabled}
                  onChange={(event) =>
                    update(
                      rows.map((r) =>
                        r.id === row.id
                          ? { ...r, months: event.target.value }
                          : r,
                      ),
                    )
                  }
                />
                <AmountInput
                  aria-label={`Надбавка за смену, ступень ${index + 1}`}
                  value={row.amount}
                  disabled={disabled}
                  onChange={(amount) =>
                    update(
                      rows.map((r) => (r.id === row.id ? { ...r, amount } : r)),
                    )
                  }
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  disabled={disabled}
                  aria-label={`Убрать ступень ${index + 1}`}
                  onClick={() => update(rows.filter((r) => r.id !== row.id))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Добавьте первую ступень стажа.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={
          disabled ||
          (Boolean(error) && rows.length > 0) ||
          rows.length >= 10000
        }
        onClick={add}
      >
        <Plus className="mr-1.5 size-4" />
        Добавить ступень
      </Button>
    </section>
  );
}
