/**
 * Единая 10-цветная Notion-style палитра приложения.
 *
 * Источник правды для:
 *   • цвет тинта KB-иконок (kb_pages.icon_color)
 *   • выделение текста / фон в BlockNote (data-text-color / data-background-color
 *     рендерятся в `globals.css` через --palette-{c}-{fg|bg})
 *   • будущие бейджи / теги / аватары (см. follow-up план в
 *     plan-файле — добавление `tone` prop у Badge, avatarPaletteColor хелпер).
 *
 * Имена 1-в-1 совпадают с BlockNote-ом (см. kb-color-picker-item.tsx → `COLORS`).
 *
 * Tailwind-маппинг (исторически из icons.ts COLOR_TEXT/TINT/DOT):
 *   brown → amber, red → rose, green → emerald, purple → violet, blue → brand.
 *
 * `default` означает "как у foreground / без тинта" — UI рендерит таким же,
 * как `null`, но сохраняется через onChange как явный пользовательский выбор.
 */

export type PaletteColor =
  | "default"
  | "gray"
  | "brown"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "red";

export const PALETTE_COLORS: { name: PaletteColor; label: string }[] = [
  { name: "default", label: "По умолчанию" },
  { name: "gray",    label: "Серый" },
  { name: "brown",   label: "Коричневый" },
  { name: "orange",  label: "Оранжевый" },
  { name: "yellow",  label: "Жёлтый" },
  { name: "green",   label: "Зелёный" },
  { name: "blue",    label: "Синий" },
  { name: "purple",  label: "Фиолетовый" },
  { name: "pink",    label: "Розовый" },
  { name: "red",     label: "Красный" },
];

const PALETTE_NAMES: ReadonlySet<PaletteColor> = new Set(
  PALETTE_COLORS.map((c) => c.name),
);

/** Legacy → canonical. До миграции 113 в БД могут лежать
 *  lime/teal/cyan/indigo. Вызывается в каждом read-site (paletteText/Bg/Dot),
 *  чтобы UI показывал ближайший Notion-цвет даже до backfill'а. */
export function normalizePaletteColor(
  v: string | null | undefined,
): PaletteColor | null {
  if (!v) return null;
  if (PALETTE_NAMES.has(v as PaletteColor)) return v as PaletteColor;
  switch (v) {
    case "lime":
    case "teal":
      return "green";
    case "cyan":
      return "blue";
    case "indigo":
      return "purple";
    default:
      return null;
  }
}

export function isPaletteColor(v: unknown): v is PaletteColor {
  return typeof v === "string" && PALETTE_NAMES.has(v as PaletteColor);
}

// ─── Tailwind class helpers ──────────────────────────────────────────────
//
// Возвращают строку Tailwind-классов. Tailwind purger видит литералы ниже
// и оставляет нужные утилиты в финальном bundle'е. Для `default` и `null`
// возвращаем "" — caller использует свой fallback (обычно `text-foreground`).

const TEXT: Record<Exclude<PaletteColor, "default">, string> = {
  gray:   "text-gray-600 dark:text-gray-300",
  brown:  "text-amber-800 dark:text-amber-300",
  orange: "text-orange-700 dark:text-orange-300",
  yellow: "text-yellow-700 dark:text-yellow-300",
  green:  "text-emerald-700 dark:text-emerald-300",
  blue:   "text-brand",
  purple: "text-violet-700 dark:text-violet-300",
  pink:   "text-pink-700 dark:text-pink-300",
  red:    "text-rose-700 dark:text-rose-300",
};

const BG: Record<Exclude<PaletteColor, "default">, string> = {
  gray:   "bg-gray-100 dark:bg-gray-800/50",
  brown:  "bg-amber-100 dark:bg-amber-900/30",
  orange: "bg-orange-100 dark:bg-orange-900/30",
  yellow: "bg-yellow-100 dark:bg-yellow-900/30",
  green:  "bg-emerald-100 dark:bg-emerald-900/30",
  blue:   "bg-brand/10",
  purple: "bg-violet-100 dark:bg-violet-900/30",
  pink:   "bg-pink-100 dark:bg-pink-900/30",
  red:    "bg-rose-100 dark:bg-rose-900/30",
};

const DOT: Record<Exclude<PaletteColor, "default">, string> = {
  gray:   "bg-gray-500",
  brown:  "bg-amber-700",
  orange: "bg-orange-500",
  yellow: "bg-yellow-500",
  green:  "bg-emerald-500",
  blue:   "bg-brand",
  purple: "bg-violet-500",
  pink:   "bg-pink-500",
  red:    "bg-rose-500",
};

/** Класс foreground-цвета (text-*). Для default/null/невалидных — "". */
export function paletteText(c: string | null | undefined): string {
  const n = normalizePaletteColor(c);
  if (!n || n === "default") return "";
  return TEXT[n];
}

/** Класс background-тинта (bg-*). Для default/null/невалидных — "". */
export function paletteBg(c: string | null | undefined): string {
  const n = normalizePaletteColor(c);
  if (!n || n === "default") return "";
  return BG[n];
}

/** Сплошной swatch-класс для dot-индикатора в picker'е.
 *  Для `default` возвращаем рамку с прозрачным фоном — визуально читаемо
 *  как "никакого цвета". Для null — то же самое. */
export function paletteDot(c: string | null | undefined): string {
  const n = normalizePaletteColor(c);
  if (!n || n === "default") {
    return "bg-transparent border border-border";
  }
  return DOT[n];
}
