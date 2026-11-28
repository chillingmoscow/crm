"use client";

import { useEffect, useRef, useState } from "react";
import { Check, MoreHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PALETTE_GRID } from "@/lib/palette";
import { ColorDot } from "@/components/ui/color-dot";
import { Input } from "@/components/ui/input";
import { fieldFocusClass } from "@/components/ui/field-styles";
import { KB_PROPERTY_UI_ICONS } from "@/components/knowledge/property-ui-icons";
import type { KbPropertyColor } from "@/types/knowledge";

/**
 * «⋯»-меню варианта select/multi-select: переименование, описание (i),
 * выбор цвета, удаление. Notion-аналог в нашем стиле. Используется и в
 * редакторе свойства, и в поисковом пикере значения.
 */
export function OptionMenuPopover({
  option,
  color,
  description,
  onRename,
  onRemove,
  onSetColor,
  onSetDescription,
}: {
  option: string;
  color?: KbPropertyColor;
  description?: string;
  onRename: (to: string) => void;
  onRemove: () => void;
  onSetColor: (c: KbPropertyColor | null) => void;
  onSetDescription: (d: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(option);
  useEffect(() => setName(option), [option]);
  const [descOpen, setDescOpen] = useState(false);
  const [descDraft, setDescDraft] = useState(description ?? "");
  useEffect(() => setDescDraft(description ?? ""), [description]);
  const descRef = useRef<HTMLTextAreaElement | null>(null);
  const resize = () => {
    const ta = descRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  };
  useEffect(() => {
    if (descOpen) resize();
  }, [descOpen, descDraft]);

  // Esc — отмена: Radix закрывает окно раньше, чем поле получает Esc, и
  // закрытие сохраняло введённое название. Описание пишется на ходу —
  // при отмене возвращаем то, что было при открытии.
  const escapedRef = useRef(false);
  // Поле названия теряет фокус уже после закрытия — blur не должен
  // сохранить отменённое название.
  const skipBlurRef = useRef(false);
  const openDescRef = useRef(description ?? "");
  const flush = (next: boolean) => {
    if (next) {
      escapedRef.current = false;
      skipBlurRef.current = false;
      openDescRef.current = description ?? "";
    } else if (escapedRef.current) {
      escapedRef.current = false;
      skipBlurRef.current = true;
      setName(option);
      setDescDraft(openDescRef.current);
      if ((description ?? "") !== openDescRef.current) onSetDescription(openDescRef.current);
    } else {
      if (descDraft !== (description ?? "")) onSetDescription(descDraft);
      const t = name.trim();
      if (t && t !== option) onRename(t);
      else setName(option);
    }
    setOpen(next);
  };

  return (
    <Popover open={open} onOpenChange={flush}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Меню варианта «${option}»`}
          onClick={(e) => e.stopPropagation()}
          className="size-6 inline-flex shrink-0 items-center justify-center rounded-md
                     text-muted-foreground opacity-0 transition
                     hover:bg-background hover:text-foreground group-hover/opt:opacity-100
                     focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                     data-[state=open]:opacity-100"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        onClick={(e) => e.stopPropagation()}
        onEscapeKeyDown={() => {
          escapedRef.current = true;
        }}
        // Десять цветов и «Удалить» внизу: на низком экране окно
        // прокручивается, а не обрезает последний пункт.
        className="w-60 max-h-[var(--radix-popover-content-available-height)] overflow-y-auto overscroll-contain p-1"
      >
        <div className="flex items-center gap-2 p-1.5 pb-2">
          <div className="relative min-w-0 flex-1">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                if (skipBlurRef.current) {
                  skipBlurRef.current = false;
                  return;
                }
                const t = name.trim();
                if (t && t !== option) onRename(t);
                else setName(option);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const t = e.currentTarget.value.trim();
                  if (t && t !== option) onRename(t);
                  setOpen(false);
                }
                if (e.key === "Escape") {
                  setName(option);
                  setOpen(false);
                }
              }}
              aria-label="Название варианта"
              className="h-9 pl-2.5 pr-10"
            />
            <button
              type="button"
              aria-label="Описание варианта"
              onClick={() => setDescOpen((v) => !v)}
              className={cn(
                "absolute right-1.5 top-1/2 size-7 -translate-y-1/2 inline-flex items-center justify-center rounded-md transition-colors",
                descOpen
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <KB_PROPERTY_UI_ICONS.description className="size-4" />
            </button>
          </div>
        </div>

        {descOpen && (
          <div className="px-1.5 pb-2">
            <textarea
              ref={descRef}
              rows={1}
              value={descDraft}
              onChange={(e) => {
                // Пишем сразу: закрытие вложенного поповера может
                // размонтировать textarea до blur/flush — иначе теряем.
                setDescDraft(e.target.value);
                onSetDescription(e.target.value);
              }}
              onInput={resize}
              onKeyDown={(e) => {
                // Enter — сохранить и закрыть (значение уже записано в
                // onChange). Shift+Enter — перенос строки.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  setOpen(false);
                }
                // Esc отменяет правку в onEscapeKeyDown (окно закрывается).
              }}
              placeholder="Добавить описание…"
              aria-label="Описание варианта"
              className={cn(
                "w-full resize-none overflow-hidden rounded-md border border-input bg-background px-2.5 py-2 text-base leading-snug md:text-sm",
                "placeholder:text-muted-foreground",
                fieldFocusClass,
              )}
            />
          </div>
        )}

        <div className="py-1">
          <div className="px-2 pb-1 pt-0.5 text-xs font-medium text-muted-foreground">
            Цвет
          </div>
          {PALETTE_GRID.map((c) => {
            const isCurrent = (color ?? "default") === c.name;
            return (
              <button
                key={c.name}
                type="button"
                onClick={() => onSetColor(c.name)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                  "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                  isCurrent && "bg-accent",
                )}
              >
                <ColorDot color={c.name} size="md" />
                <span className="flex-1 text-left">{c.label}</span>
                {isCurrent && <Check className="size-3.5" />}
              </button>
            );
          })}
        </div>
        {/* Разрушительное — последним через разделитель (DS «Меню»). */}
        <div className="-mx-1 my-1 h-px bg-border" />
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onRemove();
          }}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm
                     text-destructive transition-colors hover:bg-accent
                     focus-visible:bg-accent focus-visible:outline-none"
        >
          <KB_PROPERTY_UI_ICONS.delete className="size-4" />
          Удалить
        </button>

      </PopoverContent>
    </Popover>
  );
}
