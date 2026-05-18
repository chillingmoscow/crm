"use client";

import { useState } from "react";

import { Star } from "lucide-react";

import { cn } from "@/lib/utils";

/** Rating value-control. Два variant'а:
 *  - `stars` (default): ★★★☆☆ строка из звёзд. Click по N-й ставит
 *    value = N, click по уже-выбранной — null. Hover показывает preview.
 *  - `slider`: native `<input type="range">` от 0 до max + label с
 *    текущим значением. 0 = null (не задано). */
export function RatingValueControl({
  value,
  max,
  variant,
  showValue = true,
  canEdit,
  onChange,
}: {
  value: number | null;
  max: number;
  variant: "stars" | "slider";
  showValue?: boolean;
  canEdit: boolean;
  onChange: (value: number | null) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (variant === "slider") {
    const effective = value ?? 0;
    return (
      <div className="inline-flex items-center gap-2 max-w-full">
        <input
          type="range"
          min={0}
          max={max}
          step={1}
          value={effective}
          disabled={!canEdit}
          onChange={(e) => {
            const n = Number(e.target.value);
            // 0 = «не задано». Удобно: можно sweep'нуть слайдер влево
            // чтобы сбросить, без отдельной кнопки X.
            onChange(n === 0 ? null : n);
          }}
          aria-label={`Оценка от 0 до ${max}`}
          className={cn(
            "w-32 accent-amber-400",
            canEdit ? "cursor-pointer" : "cursor-default",
          )}
        />
        {showValue && (
          <span className="text-[13px] tabular-nums text-muted-foreground min-w-[40px]">
            {value === null ? "—" : `${value} / ${max}`}
          </span>
        )}
      </div>
    );
  }

  // variant === "stars"
  const effective = hover ?? value ?? 0;

  return (
    <div
      className="inline-flex items-center gap-0.5"
      onMouseLeave={canEdit ? () => setHover(null) : undefined}
      role="radiogroup"
      aria-label={`Оценка от 0 до ${max}`}
    >
      {Array.from({ length: max }).map((_, i) => {
        const star = i + 1;
        const filled = effective >= star;
        const isHoverPreview = hover !== null && hover >= star;
        return (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={value === star}
            aria-label={`${star} из ${max}`}
            disabled={!canEdit}
            onMouseEnter={canEdit ? () => setHover(star) : undefined}
            onClick={() => {
              // Click по уже-выбранной звезде = сбросить.
              onChange(value === star ? null : star);
            }}
            className={cn(
              "size-5 inline-flex items-center justify-center rounded transition-colors",
              canEdit
                ? "hover:bg-amber-100/60 dark:hover:bg-amber-900/20"
                : "cursor-default",
            )}
          >
            <Star
              className={cn(
                "size-3.5 transition-colors",
                filled
                  ? isHoverPreview && hover !== null && (value ?? 0) < star
                    ? "fill-amber-300 text-amber-400/80"
                    : "fill-amber-400 text-amber-400"
                  : "text-muted-foreground/30",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
