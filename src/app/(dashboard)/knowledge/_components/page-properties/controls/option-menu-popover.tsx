"use client";

import { useEffect, useRef, useState } from "react";
import { Check, MoreHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PALETTE_GRID, paletteDot } from "@/lib/palette";
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

  const flush = (next: boolean) => {
    if (!next) {
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
          className="size-5 inline-flex shrink-0 items-center justify-center rounded
                     text-muted-foreground/40 opacity-0 transition
                     hover:text-foreground group-hover/opt:opacity-100
                     data-[state=open]:opacity-100"
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        onClick={(e) => e.stopPropagation()}
        className="w-[244px] overflow-hidden rounded-xl p-0"
      >
        <div className="flex items-center gap-2 px-2.5 pt-2.5 pb-2">
          <div className="relative min-w-0 flex-1">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
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
              className="h-8 w-full rounded-md border border-input bg-transparent pl-2 pr-10 text-[13px] text-foreground outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
            <button
              type="button"
              aria-label="Описание варианта"
              onClick={() => setDescOpen((v) => !v)}
              className={cn(
                "absolute right-1 top-1/2 size-6 -translate-y-1/2 inline-flex items-center justify-center rounded-full transition-colors",
                descOpen
                  ? "bg-foreground/10 text-foreground"
                  : "text-muted-foreground/60 hover:bg-foreground/[0.06] hover:text-foreground",
              )}
            >
              <KB_PROPERTY_UI_ICONS.description className="size-3.5" />
            </button>
          </div>
        </div>

        {descOpen && (
          <div className="px-2.5 pb-2">
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
                if (e.key === "Escape") {
                  setDescDraft(description ?? "");
                  onSetDescription(description ?? "");
                  setDescOpen(false);
                }
              }}
              placeholder="Добавить описание…"
              aria-label="Описание варианта"
              className="w-full resize-none overflow-hidden rounded-md border
                         border-input bg-transparent px-2 py-1.5 text-[13px]
                         leading-snug text-muted-foreground outline-none
                         focus:border-brand focus:ring-2 focus:ring-brand/30
                         placeholder:text-muted-foreground/40"
            />
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onRemove();
          }}
          className="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-[13px]
                     text-destructive transition-colors hover:bg-accent"
        >
          <KB_PROPERTY_UI_ICONS.delete className="size-4" />
          Удалить
        </button>

        <div className="mt-1 border-t border-border px-1 py-1">
          <div className="pb-1.5 pl-1 text-[12px] font-semibold text-muted-foreground/70">
            Цвета
          </div>
          {PALETTE_GRID.map((c) => {
            const isCurrent = (color ?? "default") === c.name;
            return (
              <button
                key={c.name}
                type="button"
                onClick={() => onSetColor(c.name)}
                className="flex w-full items-center gap-2.5 rounded-md px-1.5
                           py-1.5 text-[13px] transition-colors hover:bg-accent"
              >
                <span
                  className={cn(
                    "size-4 shrink-0 rounded",
                    c.name === "default" ? "bg-muted" : paletteDot(c.name),
                  )}
                />
                <span className="flex-1 text-left">{c.label}</span>
                {isCurrent && (
                  <Check className="size-3.5 text-muted-foreground/60" />
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
