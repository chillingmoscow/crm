import {
  ArrowDownAZ,
  ArrowUpDown,
  Calculator,
  CalendarDays,
  Copy,
  Eye,
  EyeOff,
  Gauge,
  Info,
  LayoutGrid,
  ListChecks,
  ListFilter,
  Paintbrush,
  Palette,
  Replace,
  Ruler,
  Settings2,
  SlidersHorizontal,
  ToggleRight,
  Trash2,
  Type,
} from "lucide-react";

/**
 * ЕДИНЫЙ РЕЕСТР ИКОНОК для UI базы знаний (меню/редактор свойств,
 * collection-вью). **Источник истины.**
 *
 * Правила:
 *  1. Любая иконка в меню/редакторе свойства берётся ТОЛЬКО отсюда —
 *     не импортируй lucide-иконки в эти места напрямую.
 *  2. Значения должны быть взаимно различны (одна lucide-иконка не
 *     должна стоять у двух разных концептов) — иначе в одном меню
 *     появятся одинаковые иконки у разных пунктов. Уникальность
 *     закреплена тестом `property-ui-icons.test.mts`.
 *  3. Нужен новый концепт — добавь сюда новый ключ с НЕиспользуемой
 *     ещё иконкой, потом используй ключ.
 */
export const KB_PROPERTY_UI_ICONS = {
  // Редактор свойства
  description: Info,
  changeType: Replace,
  duplicate: Copy,
  delete: Trash2,
  appearance: LayoutGrid,
  color: Palette,
  unit: Ruler,
  rounding: Calculator,
  dateFormat: CalendarDays,
  scale: SlidersHorizontal,
  rating: Gauge,
  showValue: ToggleRight,
  // Collection-вью
  display: Paintbrush,
  filter: ListFilter,
  grouping: ListChecks,
  hidden: EyeOff,
  layout: Settings2,
  sort: ArrowUpDown,
  sortDirection: ArrowDownAZ,
  type: Type,
  visibility: Eye,
} as const;
