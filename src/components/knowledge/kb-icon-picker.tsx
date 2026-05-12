"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Shuffle, X } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import {
  PALETTE_COLORS,
  paletteDot,
  paletteText,
  type PaletteColor,
} from "@/lib/palette";
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
}: KbIconPickerBodyProps) {
  const [colorOpen, setColorOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pendingColor, setPendingColor] = useState<PaletteColor | null>(
    (color as PaletteColor | null) ?? null,
  );
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Sync pendingColor при смене props.color (parent открывает picker
  // на новом property — pendingColor должен следовать).
  useEffect(() => {
    setPendingColor((color as PaletteColor | null) ?? null);
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

  const onPickColor = (c: PaletteColor) => {
    setPendingColor(c);
    // Если иконка уже выбрана — применяем цвет немедленно
    // (preview = commit для существующей иконки). Также коммитим
    // если caller включил `commitColorWithoutIcon` — это нужно
    // call-site'ам с fallback-иконкой (например, роли с системной
    // иконкой по `code`), где tint без явного icon-override всё
    // ещё имеет визуальный смысл.
    if (value || commitColorWithoutIcon) {
      onChange({ icon: value, color: c });
    }
  };

  /** Random реролит и иконку, и цвет (любой кроме default). */
  const onRandom = () => {
    const pool = filteredIcons.length > 0 ? filteredIcons : KB_ICONS;
    const randomIcon = pool[Math.floor(Math.random() * pool.length)];
    if (!randomIcon) return;
    const colorPool = PALETTE_COLORS.filter((c) => c.name !== "default");
    const picked =
      colorPool[Math.floor(Math.random() * colorPool.length)]?.name ?? null;
    setPendingColor(picked);
    onPickIcon(randomIcon.name, picked);
  };

  const onClear = () => {
    setPendingColor(null);
    onChange({ icon: null, color: null });
    onCommitClose?.();
  };

  const canClear = Boolean(value || color);

  return (
    <>
      {/* Header row: search + random + color swatch + clear */}
      <div className="flex items-center gap-1.5 px-2 py-2 border-b">
        <Input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск иконок"
          className="h-8 text-sm flex-1 min-w-0"
          aria-label="Поиск иконок"
        />
        <button
          type="button"
          onClick={onRandom}
          aria-label="Случайная иконка"
          title="Случайная иконка"
          className="inline-flex items-center justify-center size-8 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors shrink-0"
        >
          <Shuffle className="size-4" />
        </button>
        <Popover open={colorOpen} onOpenChange={setColorOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Цвет иконки"
              title="Цвет иконки"
              className="inline-flex items-center justify-center size-8 rounded-md hover:bg-accent transition-colors shrink-0"
            >
              <span
                className={cn(
                  "size-5 rounded-full",
                  paletteDot(pendingColor),
                )}
              />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            side="bottom"
            sideOffset={6}
            className="w-[220px] p-3 rounded-[10px]"
          >
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70 mb-2">
              Цвет
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {PALETTE_COLORS.map((c) => {
                const isActive = pendingColor === c.name;
                return (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => onPickColor(c.name)}
                    aria-label={c.label}
                    title={c.label}
                    className={cn(
                      "relative size-8 rounded-full transition-transform shrink-0 inline-flex items-center justify-center",
                      paletteDot(c.name),
                      isActive
                        ? "ring-2 ring-offset-2 ring-offset-popover ring-foreground"
                        : "hover:scale-110",
                    )}
                  >
                    {isActive && (
                      <Check
                        className={cn(
                          "size-4",
                          // На default-swatch'е (прозрачный фон) галочка
                          // должна быть foreground; на цветных — белая.
                          c.name === "default"
                            ? "text-foreground"
                            : "text-white",
                        )}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
        <button
          type="button"
          onClick={onClear}
          disabled={!canClear}
          aria-label="Отменить выбор"
          title="Отменить выбор"
          className="inline-flex items-center justify-center size-8 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors shrink-0 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground disabled:cursor-not-allowed"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Icons grid. Без поиска — рендерим со sticky-заголовками групп
          (KB_ICONS уже отсортирован по `group`); с поиском — единый flat
          grid (категория теряет смысл если показано только пара иконок). */}
      <div className="max-h-[320px] overflow-y-auto p-2">
        {filteredIcons.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-8">
            Ничего не найдено
          </div>
        ) : query.trim() ? (
          <div className="grid grid-cols-8 gap-0.5">
            {filteredIcons.map(({ name, icon: Icon, label }) => {
              const isActive = value === name;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => onPickIcon(name)}
                  aria-label={label}
                  title={label}
                  className={cn(
                    "flex items-center justify-center size-9 rounded-md transition-colors",
                    isActive ? "bg-accent" : "hover:bg-accent/60",
                    // Default/null preview = muted (серый), как и
                    // реальная иконка без выбранного цвета.
                    paletteText(pendingColor) || "text-muted-foreground",
                  )}
                >
                  <Icon className="w-[18px] h-[18px]" />
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {groupedIcons.map(({ group, items }) => (
              <div key={group} className="flex flex-col gap-1">
                <div className="sticky top-0 bg-popover/95 backdrop-blur-sm px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 z-10">
                  {group}
                </div>
                <div className="grid grid-cols-8 gap-0.5">
                  {items.map(({ name, icon: Icon, label }) => {
                    const isActive = value === name;
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => onPickIcon(name)}
                        aria-label={label}
                        title={label}
                        className={cn(
                          "flex items-center justify-center size-9 rounded-md transition-colors",
                          isActive ? "bg-accent" : "hover:bg-accent/60",
                          paletteText(pendingColor) || "text-muted-foreground",
                        )}
                      >
                        <Icon className="w-[18px] h-[18px]" />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
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
          title="Изменить иконку"
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
        className="w-[380px] p-0 rounded-[10px]"
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
