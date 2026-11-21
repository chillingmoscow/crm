"use client";

import { ArrowLeftRight, Minus, Plus, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { TransactionRow } from "@/types/finance";

import { TYPE_LABEL } from "../../_lib/labels";

type TxType = TransactionRow["type"];

const TYPE_ICON: Record<TxType, LucideIcon> = { income: Plus, expense: Minus, transfer: ArrowLeftRight };
const ALL_TYPES: TxType[] = ["income", "expense", "transfer"];

/** Тип операции — чипы-сегменты; только при создании. */
export function TypeSwitch<T extends TxType>({
  value,
  onChange,
  transferBlocked = false,
  types = ALL_TYPES as T[],
}: {
  value: T;
  onChange: (next: T) => void;
  transferBlocked?: boolean;
  /** Какие типы предлагать; по умолчанию все три. */
  types?: T[];
}) {
  return (
    <div className="space-y-2">
      <div
        role="radiogroup"
        aria-label="Тип операции"
        className="inline-flex h-10 w-full items-center gap-1 rounded-md bg-muted p-1"
      >
        {types.map((type) => {
          const Icon: LucideIcon = TYPE_ICON[type as TxType];
          const selected = value === type;
          const disabled = type === "transfer" && transferBlocked;
          return (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(type)}
              className={cn(
                "inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
                selected
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
                disabled && "cursor-not-allowed opacity-50 hover:text-muted-foreground",
              )}
            >
              <Icon
                className={cn(
                  "size-4",
                  selected && type === "income" && "text-green-700 dark:text-green-400",
                  selected && type === "expense" && "text-red-700 dark:text-red-400",
                )}
              />
              {TYPE_LABEL[type]}
            </button>
          );
        })}
      </div>
      {transferBlocked && types.includes("transfer" as T) ? (
        <p className="text-xs text-muted-foreground">Для перевода нужно хотя бы два счёта</p>
      ) : null}
    </div>
  );
}
