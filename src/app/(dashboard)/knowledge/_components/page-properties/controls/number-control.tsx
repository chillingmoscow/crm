"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { formatWithUnit, unitSuffix, type Unit } from "@/lib/units";
import type { KbProperty } from "@/types/knowledge";

import { RatingValueControl } from "./rating-control";

export function NumberValueControl({
  property,
  canEdit,
  onChangeValue,
}: {
  property: Extract<KbProperty, { type: "number" }>;
  canEdit: boolean;
  onChangeValue: (value: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (property.displayVariant === "rating") {
    return (
      <RatingValueControl
        value={
          property.value === null ? null : Math.trunc(property.value)
        }
        max={property.max ?? 5}
        variant={property.ratingVariant ?? "stars"}
        showValue={property.ratingShowValue ?? true}
        canEdit={canEdit}
        onChange={onChangeValue}
      />
    );
  }

  const unit: Unit = property.unit ?? { kind: "none" };
  const suffix = unitSuffix(unit);

  const display =
    property.value === null ? "—" : formatWithUnit(property.value, unit);

  if (!canEdit) {
    return <span className="text-[13px] tabular-nums">{display}</span>;
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={cn(
          "text-left text-[13px] tabular-nums w-full truncate",
          property.value === null && "text-muted-foreground/50",
        )}
        aria-label="Редактировать число"
      >
        {display}
      </button>
    );
  }

  // Edit-mode: <input> + inline suffix, без рамки. `size` атрибут
  // подгоняет ширину input'а под содержимое, чтобы suffix лип к числу
  // вплотную (а не висел справа в отрыве).
  const valueStr = property.value === null ? "" : String(property.value);
  const inputSize = Math.max(2, valueStr.length || 2);

  return (
    <span className="inline-flex items-baseline max-w-full">
      <input
        autoFocus
        type="number"
        inputMode="numeric"
        size={inputSize}
        value={property.value ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onChangeValue(v === "" ? null : Number(v));
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") {
            e.currentTarget.blur();
          }
        }}
        placeholder="—"
        className="text-[13px] tabular-nums outline-none bg-transparent
                   border-0 p-0 m-0
                   [appearance:textfield]
                   [&::-webkit-outer-spin-button]:appearance-none
                   [&::-webkit-inner-spin-button]:appearance-none"
      />
      {suffix && (
        <span
          className="text-[13px] text-muted-foreground/80 shrink-0 select-none"
          data-tip="Единица измерения (изменить — через ⋯ меню)"
        >
          {suffix}
        </span>
      )}
    </span>
  );
}
