"use client";

import { cn } from "@/lib/utils";
import { PALETTE_COLORS, paletteChip } from "@/lib/palette";
import type { KbPropertyColor } from "@/types/knowledge";

// Хеш-FNV, выбирает цвет из палитры (без `default`) детерминированно
// по value: «Высокий приоритет» всегда красится одинаково везде, где
// появляется. Если юзер override'ит через picker — берём его.
const HASH_PALETTE = PALETTE_COLORS.filter((c) => c.name !== "default").map(
  (c) => c.name,
) as Exclude<KbPropertyColor, "default">[];

export function colorNameForOption(value: string): KbPropertyColor {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return HASH_PALETTE[Math.abs(h) % HASH_PALETTE.length];
}

/** Resolve финального цвета: explicit override > hash-fallback. */
export function resolveOptionColor(
  value: string,
  explicit?: KbPropertyColor,
): string {
  // Если у explicit `default` — возвращаем нейтральный chip; для null/
  // undefined падаем в hash. paletteChip сам нормализует legacy-имена
  // (stone/amber/sky/teal/indigo) до миграции 115.
  return paletteChip(explicit ?? colorNameForOption(value));
}

/** Цветной chip для select-option. `explicit` — если юзер вручную
 *  выбрал цвет в палитре; иначе fallback на hash-FNV. */
export function OptionChip({
  value,
  explicit,
  className,
}: {
  value: string;
  explicit?: KbPropertyColor;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[12.5px] font-medium leading-tight max-w-full",
        resolveOptionColor(value, explicit),
        className,
      )}
    >
      <span className="truncate">{value}</span>
    </span>
  );
}
