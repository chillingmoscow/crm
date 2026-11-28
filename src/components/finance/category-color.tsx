"use client";

import { Check } from "lucide-react";

import { ColorDot } from "@/components/ui/color-dot";
import { normalizePaletteColor, PALETTE_COLORS, paletteDot } from "@/lib/palette";
import { cn } from "@/lib/utils";

const HEX = /^#?[0-9a-f]{6}$/i;

/** Цвета, которые предлагаем статье: яркие, без серого и «по умолчанию». */
export const CATEGORY_COLORS = PALETTE_COLORS.filter(
  (color) => !["default", "gray", "brown"].includes(color.name),
);

/**
 * Точка цвета статьи. Новые статьи хранят цвет палитры; у статей,
 * перенесённых из прежнего учёта, мог остаться hex («22c55e») — его
 * показываем как есть, пока цвет не выберут заново. Без цвета — ничего.
 */
export function CategoryColorDot({
  color,
  size = "lg",
  className,
}: {
  color: string | null | undefined;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  if (!color) return null;
  if (normalizePaletteColor(color)) return <ColorDot color={color} size={size} className={className} />;
  if (!HEX.test(color)) return null;
  const sizeClass = size === "sm" ? "size-2" : size === "md" ? "size-2.5" : "size-3";
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block shrink-0 rounded-full", sizeClass, className)}
      // Данные прежнего учёта: hex из базы, не токен интерфейса.
      style={{ backgroundColor: color.startsWith("#") ? color : `#${color}` }}
    />
  );
}

/**
 * Полоска доли статьи (дашборд «Топ статей расходов») в цвете статьи.
 * Без цвета и для «Без статьи» — нейтральная, чтобы цвет оставался
 * приметой конкретной статьи, а не типа операции.
 */
export function CategoryShareBar({
  color,
  percent,
  index = 0,
}: {
  color: string | null | undefined;
  percent: number;
  /** Место в списке: полоски растут по очереди (docs/motion.md). */
  index?: number;
}) {
  const palette = normalizePaletteColor(color);
  const legacyHex = !palette && color && HEX.test(color) ? (color.startsWith("#") ? color : `#${color}`) : null;
  const width = `${Math.max(0, Math.min(100, percent))}%`;
  return (
    <div className="h-1.5 overflow-hidden rounded-sm bg-muted" aria-hidden="true">
      <div
        className={cn(
          "chart-bar-grow-x h-full rounded-sm",
          palette && palette !== "default" ? paletteDot(palette) : legacyHex ? null : "bg-muted-foreground/40",
        )}
        // Hex — данные прежнего учёта, не токен интерфейса.
        style={{
          width,
          animationDelay: `${200 + index * 90}ms`,
          ...(legacyHex ? { backgroundColor: legacyHex } : null),
        }}
      />
    </div>
  );
}

/**
 * Выбор цвета статьи — кружки 28px (docs/design-system.md § «Выбор цвета»).
 * Цвет необязателен: «Без цвета» — текстовая ссылка в строке подписи.
 */
export function CategoryColorPicker({
  value,
  onChange,
  disabled,
  ringOffsetClassName = "ring-offset-background",
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  /** Цвет зазора у кольца выбранного кружка — фон, на котором стоит выбор
   *  (во всплывающем окне — `ring-offset-popover`, иначе в тёмной теме
   *  вокруг кружка тёмный ободок). */
  ringOffsetClassName?: string;
}) {
  const current = normalizePaletteColor(value);
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <legend className="text-sm font-medium">Цвет</legend>
        {value && !disabled ? (
          <button
            type="button"
            className="text-[13px] text-brand hover:underline"
            onClick={() => onChange(null)}
          >
            Без цвета
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2 p-0.5">
        {CATEGORY_COLORS.map((color) => {
          const selected = current === color.name;
          return (
            <button
              key={color.name}
              type="button"
              aria-label={color.label}
              aria-pressed={selected}
              data-tip={color.label}
              onClick={() => onChange(color.name)}
              className={cn(
                "touch-target flex size-7 items-center justify-center rounded-full text-white ring-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:cursor-not-allowed disabled:opacity-50",
                ringOffsetClassName,
                paletteDot(color.name),
                selected && "ring-2 ring-foreground",
              )}
            >
              {selected ? <Check className="size-4" strokeWidth={3} /> : null}
            </button>
          );
        })}
      </div>
      {value && !current ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Цвет из прежнего учёта. Выберите цвет палитры, чтобы он совпадал с остальными статьями
        </p>
      ) : null}
    </fieldset>
  );
}
