"use client";

import { useState } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  KB_ICONS,
  KB_ICON_COLORS,
  colorDotClass,
  colorTextClass,
  type KbIconColor,
} from "@/lib/knowledge/icons";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";

interface KbIconPickerProps {
  /** Текущая иконка: имя из реестра, emoji (legacy) или null. */
  value: string | null;
  /** Текущий цвет тинта. Применяется только к Lucide-иконкам. */
  color: string | null;
  onChange: (next: { icon: string | null; color: string | null }) => void;
  disabled?: boolean;
  /** Размер квадрата-триггера и рендера иконки внутри (по умолчанию 48). */
  triggerSize?: number;
}

/**
 * Picker иконки KB-страницы: палитра 13 цветов сверху + flat grid
 * иконок. Без табов / категорий / emoji-input — Lucide only.
 *
 * Цвет работает как «активный для всего грида» — каждая иконка в гриде
 * рендерится в текущем выбранном цвете, чтобы пользователь видел
 * результат до клика. Click по иконке = apply (icon + currently
 * selected color), popover закрывается.
 *
 * Кнопка «Убрать» сбрасывает icon и color → fallback FileText в
 * KbPageIcon.
 */
export function KbIconPicker({
  value,
  color,
  onChange,
  disabled,
  triggerSize = 48,
}: KbIconPickerProps) {
  const [open, setOpen] = useState(false);
  // Локальный «текущий цвет» — изменения цвета до клика по иконке
  // живут только в picker'е и не сохраняются. Только клик по иконке
  // коммитит icon + color через onChange.
  const [pendingColor, setPendingColor] = useState<KbIconColor | null>(
    (color as KbIconColor | null) ?? null,
  );

  const onPickIcon = (name: string) => {
    onChange({ icon: name, color: pendingColor ?? null });
    setOpen(false);
  };

  const onClear = () => {
    setPendingColor(null);
    onChange({ icon: null, color: null });
    setOpen(false);
  };

  // Если текущая иконка — emoji (нет в реестре, не пустая), это
  // legacy-данные. Picker всё равно даёт выбрать новую Lucide-иконку
  // взамен; emoji при этом перезаписывается.

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // При открытии синхронизируем pendingColor с реальным.
        if (next) setPendingColor((color as KbIconColor | null) ?? null);
      }}
    >
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
        className="w-[360px] p-0 rounded-[10px]"
      >
        {/* Header: палитра + «Убрать» */}
        <div className="flex flex-col gap-2 px-3 pt-3 pb-2 border-b">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
              Цвет
            </span>
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
          <div className="flex items-center gap-1.5 flex-wrap">
            {KB_ICON_COLORS.map((c) => {
              const isActive = pendingColor === c.name;
              return (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => {
                    setPendingColor(c.name);
                    // Если иконка уже выбрана — применяем цвет сразу,
                    // не дожидаясь повторного клика по иконке. Это то,
                    // что юзер ожидает увидеть (preview = commit для
                    // существующей иконки).
                    if (value) onChange({ icon: value, color: c.name });
                  }}
                  aria-label={c.label}
                  title={c.label}
                  className={cn(
                    "size-5 rounded-full transition-transform shrink-0",
                    colorDotClass(c.name),
                    isActive
                      ? "ring-2 ring-offset-2 ring-offset-popover ring-foreground/50 scale-110"
                      : "hover:scale-110",
                  )}
                />
              );
            })}
          </div>
        </div>

        {/* Flat icons grid — все иконки одним сплошным блоком,
            каждая рендерится в pending-цвете для preview. */}
        <div className="max-h-[300px] overflow-y-auto p-2">
          <div className="grid grid-cols-8 gap-0.5">
            {KB_ICONS.map(({ name, icon: Icon, label }) => {
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
                    pendingColor
                      ? colorTextClass(pendingColor)
                      : "text-foreground",
                  )}
                >
                  <Icon className="w-[18px] h-[18px]" />
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
