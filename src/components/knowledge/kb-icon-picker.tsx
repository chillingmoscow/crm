"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import {
  KB_ICONS,
  KB_ICON_COLORS,
  colorDotClass,
  colorTextClass,
  type KbIconColor,
} from "@/lib/knowledge/icons";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";

interface KbIconPickerProps {
  /** Текущая иконка: имя из реестра, emoji или null (= по умолчанию). */
  value: string | null;
  /** Текущий цвет тинта Lucide-иконки. Игнорируется для emoji. */
  color: string | null;
  onChange: (next: { icon: string | null; color: string | null }) => void;
  disabled?: boolean;
  /** Размер квадрата-триггера и рендера иконки внутри (по умолчанию 48). */
  triggerSize?: number;
}

/**
 * Picker иконки KB-страницы: tabs «Иконки» / «Эмодзи», палитра цвета
 * для Lucide-варианта, кнопка «Убрать» для сброса.
 *
 * Триггер — квадрат `triggerSize` × `triggerSize` с текущей иконкой
 * (если есть) или с placeholder'ом. Геометрия совпадает с h-12-input
 * заголовка страницы — чтобы строка [icon][title] не дёргалась.
 */
export function KbIconPicker({
  value,
  color,
  onChange,
  disabled,
  triggerSize = 48,
}: KbIconPickerProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"icons" | "emoji">(
    value && !KB_ICONS.find((i) => i.name === value) && value.length > 0
      ? "emoji"
      : "icons",
  );

  // Группируем по `group` для секций picker'а.
  const groups = useMemo(() => {
    const map = new Map<string, typeof KB_ICONS>();
    for (const item of KB_ICONS) {
      const arr = map.get(item.group) ?? [];
      arr.push(item);
      map.set(item.group, arr);
    }
    return Array.from(map, ([label, items]) => ({ label, items }));
  }, []);

  const onPickIcon = (name: string) => {
    onChange({ icon: name, color: color ?? null });
  };
  const onPickColor = (next: KbIconColor) => {
    onChange({ icon: value, color: next });
  };
  const onClear = () => {
    onChange({ icon: null, color: null });
    setOpen(false);
  };

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
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
          style={{ width: triggerSize, height: triggerSize }}
        >
          <KbPageIcon icon={value} color={color} size={Math.round(triggerSize * 0.55)} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-[340px] p-0 rounded-[10px]"
      >
        {/* Tabs */}
        <div className="flex items-center justify-between px-3 pt-3">
          <div className="inline-flex rounded-md bg-muted p-0.5">
            <button
              type="button"
              onClick={() => setTab("icons")}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-[5px] transition-colors",
                tab === "icons"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Иконки
            </button>
            <button
              type="button"
              onClick={() => setTab("emoji")}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-[5px] transition-colors",
                tab === "emoji"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Эмодзи
            </button>
          </div>
          <button
            type="button"
            onClick={onClear}
            disabled={!value && !color}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
            title="Убрать иконку"
          >
            <X className="w-3 h-3" />
            Убрать
          </button>
        </div>

        {tab === "icons" && (
          <>
            {/* Color row — применяется только к Lucide-иконкам */}
            <div className="flex items-center gap-1.5 px-3 pt-3 pb-2">
              {KB_ICON_COLORS.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => onPickColor(c.name)}
                  aria-label={c.label}
                  title={c.label}
                  className={cn(
                    "size-5 rounded-full transition-transform",
                    colorDotClass(c.name),
                    color === c.name && "ring-2 ring-offset-2 ring-offset-popover ring-foreground/30 scale-110",
                  )}
                />
              ))}
            </div>

            {/* Icons grid — scrollable, grouped by category */}
            <div className="max-h-[280px] overflow-y-auto px-2 pb-2">
              {groups.map((g) => (
                <div key={g.label} className="flex flex-col gap-1 pt-2">
                  <div className="px-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                    {g.label}
                  </div>
                  <div className="grid grid-cols-8 gap-0.5">
                    {g.items.map(({ name, icon: Icon, label }) => {
                      const isActive = value === name;
                      return (
                        <button
                          key={name}
                          type="button"
                          onClick={() => onPickIcon(name)}
                          aria-label={label}
                          title={label}
                          className={cn(
                            "flex items-center justify-center size-8 rounded-md transition-colors",
                            isActive
                              ? "bg-accent"
                              : "hover:bg-accent/60",
                            isActive && colorTextClass(color),
                            !isActive && "text-foreground",
                          )}
                        >
                          <Icon className="w-4 h-4" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === "emoji" && (
          <div className="flex flex-col gap-2 p-3">
            <Input
              autoFocus
              maxLength={4}
              placeholder="📄  ←  вставьте эмодзи"
              value={value && !KB_ICONS.find((i) => i.name === value) ? value : ""}
              onChange={(e) =>
                onChange({ icon: e.target.value || null, color: null })
              }
              className="text-center text-2xl h-12"
            />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Любой эмодзи. Выбор цвета не применяется к эмодзи —
              они уже цветные.
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
