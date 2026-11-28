"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Shuffle } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CategoryColorPicker, CATEGORY_COLORS } from "@/components/finance/category-color";
import { normalizePaletteColor, paletteText, type PaletteColor } from "@/lib/palette";
import { KB_ICONS } from "@/lib/knowledge/icons";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";

interface KbIconPickerBodyProps {
  /** Текущая иконка: имя из реестра, emoji (legacy) или null. */
  value: string | null;
  /** Текущий цвет тинта. */
  color: string | null;
  /** Commit изменений. После применения caller обычно закрывает popover. */
  onChange: (next: { icon: string | null; color: string | null }) => void;
  /** Зовётся когда юзер сделал commit'ящий выбор (icon / random / clear). */
  onCommitClose?: () => void;
  /**
   * По умолчанию выбор цвета без иконки только обновляет `pendingColor`
   * и коммитится позже, когда юзер выберет иконку. Для случаев, где
   * есть fallback-иконка (роли — иконка по `code`), это значит, что
   * tint без явного выбора иконки терялся. Опт-ин `commitColorWithoutIcon`
   * меняет поведение: цвет применяется немедленно даже при `value === null`.
   */
  commitColorWithoutIcon?: boolean;
  /** Цвет здесь не сохраняется (значок вида коллекции) — блок «Цвет» не
   *  показываем, иначе выбор цвета молча терялся. */
  hideColor?: boolean;
  /** Подпись кнопки сброса. Где после сброса остаётся значок по умолчанию
   *  (должность, вид коллекции), — «Значок по умолчанию». */
  clearLabel?: string;
}

/** Цвет, который предлагает окно: палитра без «по умолчанию» (это и есть
 *  «без цвета»). Прежнее явное «default» читается как отсутствие цвета. */
function initialColor(color: string | null): PaletteColor | null {
  if (!color || color === "default") return null;
  return normalizePaletteColor(color);
}

/**
 * Внутренности popover'а picker'а — header (search + random + color +
 * clear) + grid иконок. Вынесено отдельно чтобы переиспользовать
 * в разных trigger-обёртках:
 *   - `<KbIconPicker>` — Notion-style 48-64px квадрат для KB-страниц
 *   - `<PropertyIconButton>` (kb-page-properties.tsx) — маленький 20px
 *     trigger перед именем свойства
 */
export function KbIconPickerBody({
  value,
  color,
  onChange,
  onCommitClose,
  commitColorWithoutIcon = false,
  hideColor = false,
  clearLabel = "Убрать значок",
}: KbIconPickerBodyProps) {
  const [query, setQuery] = useState("");
  const [pendingColor, setPendingColor] = useState<PaletteColor | null>(() =>
    initialColor(color),
  );
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Sync pendingColor при смене props.color (parent открывает picker
  // на новом property — pendingColor должен следовать).
  useEffect(() => {
    setPendingColor(initialColor(color));
  }, [color]);

  // Auto-focus search на mount.
  useEffect(() => {
    requestAnimationFrame(() => searchRef.current?.focus());
  }, []);

  // Filter иконки по запросу. Case-insensitive, по label И name.
  const filteredIcons = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return KB_ICONS;
    return KB_ICONS.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        i.name.toLowerCase().includes(q),
    );
  }, [query]);

  // Группировка для рендера без поиска: сохраняем порядок KB_ICONS,
  // создавая массив { group, items } со стабильным insertion-order.
  // Используется только когда query пустой (с поиском показываем
  // плоский grid — заголовки только мешают).
  const groupedIcons = useMemo(() => {
    const groups: { group: string; items: typeof KB_ICONS }[] = [];
    const indexByGroup = new Map<string, number>();
    for (const item of KB_ICONS) {
      let idx = indexByGroup.get(item.group);
      if (idx === undefined) {
        idx = groups.length;
        indexByGroup.set(item.group, idx);
        groups.push({ group: item.group, items: [] });
      }
      groups[idx].items.push(item);
    }
    return groups;
  }, []);

  const onPickIcon = (name: string, withColor?: PaletteColor | null) => {
    const finalColor = withColor !== undefined ? withColor : pendingColor;
    onChange({ icon: name, color: finalColor });
    onCommitClose?.();
  };

  const onPickColor = (c: string | null) => {
    const next = (c as PaletteColor | null) ?? null;
    setPendingColor(next);
    // Если иконка уже выбрана — применяем цвет немедленно
    // (preview = commit для существующей иконки). Также коммитим
    // если caller включил `commitColorWithoutIcon` — это нужно
    // call-site'ам с fallback-иконкой (например, роли с системной
    // иконкой по `code`), где tint без явного icon-override всё
    // ещё имеет визуальный смысл.
    if (value || commitColorWithoutIcon) {
      onChange({ icon: value, color: next });
    }
  };

  /** «Случайный» — и значок, и цвет (из тех, что предлагает выбор цвета). */
  const onRandom = () => {
    const pool = filteredIcons.length > 0 ? filteredIcons : KB_ICONS;
    const randomIcon = pool[Math.floor(Math.random() * pool.length)];
    if (!randomIcon) return;
    const picked = hideColor
      ? null
      : (CATEGORY_COLORS[Math.floor(Math.random() * CATEGORY_COLORS.length)]?.name ?? null);
    setPendingColor(picked);
    onPickIcon(randomIcon.name, picked);
  };

  const onClear = () => {
    setPendingColor(null);
    onChange({ icon: null, color: null });
    onCommitClose?.();
  };

  const canClear = Boolean(value || color);

  const renderTile = ({ name, icon: Icon, label }: (typeof KB_ICONS)[number]) => {
    const isActive = value === name;
    return (
      <button
        key={name}
        type="button"
        onClick={() => onPickIcon(name)}
        aria-label={label}
        aria-pressed={isActive}
        data-tip={label}
        className={cn(
          // Плитка по ширине колонки: окно 340px — 36px, встроенный выбор в
          // меню столбца (300px) — уже, но без наползания и прокрутки вбок.
          "flex aspect-square w-full items-center justify-center rounded-md transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isActive ? "bg-brand/10 ring-1 ring-inset ring-brand/40" : "hover:bg-accent",
          // Без цвета — серый, как и сам значок без цвета.
          paletteText(pendingColor) || "text-muted-foreground",
        )}
      >
        <Icon className="size-[18px]" />
      </button>
    );
  };

  // Окно по правилам всплывающих окон DS: поиск, цвет прямо в окне (без
  // второго всплывающего), сетка с подписями групп 12 / 500, внизу
  // текстовые действия вместо безымянных значков. Действия в разметке идут
  // до сетки (order-last рисует их внизу): с клавиатуры до них не нужно
  // проходить Tab по всем значкам.
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 border-b p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Найти значок"
            className="h-9 pl-9"
            aria-label="Найти значок"
          />
        </div>
        {!hideColor && (
          <CategoryColorPicker
            value={pendingColor}
            onChange={onPickColor}
            ringOffsetClassName="ring-offset-popover"
          />
        )}
      </div>

      <div className="order-last flex items-center justify-between gap-2 border-t p-2">
        <Button type="button" variant="ghost" size="sm" onClick={onRandom}>
          <Shuffle className="size-4" />
          Случайный
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClear}
          disabled={!canClear}
          className="text-muted-foreground"
        >
          {clearLabel}
        </Button>
      </div>

      {/* overscroll-contain + onWheel.stop — окно открывают и из EditDrawer:
          блокировка прокрутки Dialog перехватывала колесо. */}
      <div
        className="max-h-[240px] overflow-y-auto overscroll-contain p-2"
        onWheel={(e) => e.stopPropagation()}
      >
        {filteredIcons.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Ничего не найдено
          </p>
        ) : query.trim() ? (
          <div className="grid grid-cols-8 gap-1">{filteredIcons.map(renderTile)}</div>
        ) : (
          <div className="flex flex-col gap-2">
            {groupedIcons.map(({ group, items }) => (
              <div key={group} className="flex flex-col gap-1">
                <div className="sticky top-0 z-10 bg-popover px-1 py-1 text-xs font-medium text-muted-foreground">
                  {group}
                </div>
                <div className="grid grid-cols-8 gap-1">{items.map(renderTile)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface KbIconPickerProps {
  value: string | null;
  color: string | null;
  onChange: (next: { icon: string | null; color: string | null }) => void;
  disabled?: boolean;
  /** Размер квадрата-триггера и рендера иконки внутри (по умолчанию 48). */
  triggerSize?: number;
}

/**
 * Notion-style picker иконки KB-страницы. Триггер — большой квадрат
 * 48-64px с рамкой; popover-body — общий с другими picker'ами через
 * `<KbIconPickerBody>`.
 */
export function KbIconPicker({
  value,
  color,
  onChange,
  disabled,
  triggerSize = 48,
}: KbIconPickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Изменить иконку страницы"
          data-tip="Изменить иконку"
          className={cn(
            "inline-flex items-center justify-center rounded-lg border border-transparent transition-colors shrink-0",
            "hover:border-border hover:bg-accent",
            "data-[state=open]:border-border data-[state=open]:bg-accent",
            "disabled:cursor-default disabled:hover:border-transparent disabled:hover:bg-transparent",
          )}
          style={{ width: triggerSize, height: triggerSize }}
        >
          <KbPageIcon
            icon={value}
            color={color}
            size={Math.round(triggerSize * 0.55)}
          />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-[340px] p-0"
      >
        <KbIconPickerBody
          value={value}
          color={color}
          onChange={onChange}
          onCommitClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
