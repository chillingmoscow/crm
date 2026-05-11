"use client";

import { useMemo, useState } from "react";

import { Check, Palette, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { PALETTE_COLORS, paletteDot } from "@/lib/palette";
import type { KbProperty, KbPropertyColor } from "@/types/knowledge";

import { OptionChip } from "../option-chip";

/** Multi-select value-control: chips inline (выбранные значения) +
 *  trigger для открытия dropdown'а с checkbox-списком. Полностью
 *  параллелен SelectControl, но value — string[] вместо string|null.
 *  Cleanup options/optionColors происходит выше в onChangeOptions. */
export function MultiSelectControl({
  property,
  canEdit,
  canEditOptions,
  onChangeValue,
  onChangeOptions,
  onChangeOptionColors,
}: {
  property: Extract<KbProperty, { type: "multi-select" }>;
  canEdit: boolean;
  canEditOptions: boolean;
  onChangeValue: (value: string[]) => void;
  onChangeOptions: (options: string[]) => void;
  onChangeOptionColors: (
    optionColors: Partial<Record<string, KbPropertyColor>> | undefined,
  ) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const selectedSet = useMemo(() => new Set(property.value), [property.value]);

  const toggleValue = (option: string) => {
    if (selectedSet.has(option)) {
      onChangeValue(property.value.filter((v) => v !== option));
    } else {
      onChangeValue([...property.value, option]);
    }
  };

  const removeChip = (option: string) => {
    onChangeValue(property.value.filter((v) => v !== option));
  };

  const commitAdd = () => {
    const v = draft.trim();
    if (!v) {
      setAdding(false);
      setDraft("");
      return;
    }
    if (property.options.includes(v)) {
      toast.warning("Такая опция уже есть");
      return;
    }
    onChangeOptions([...property.options, v]);
    onChangeValue([...property.value, v]);
    setDraft("");
    setAdding(false);
  };

  const setOptionColor = (option: string, color: KbPropertyColor | null) => {
    const next: Partial<Record<string, KbPropertyColor>> = {
      ...(property.optionColors ?? {}),
    };
    if (color === null) delete next[option];
    else next[option] = color;
    onChangeOptionColors(Object.keys(next).length > 0 ? next : undefined);
  };

  if (!canEdit) {
    return property.value.length > 0 ? (
      <div className="flex flex-wrap gap-1">
        {property.value.map((v) => (
          <OptionChip
            key={v}
            value={v}
            explicit={property.optionColors?.[v]}
          />
        ))}
      </div>
    ) : (
      <span className="text-[13px] text-muted-foreground/50">—</span>
    );
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="min-h-7 min-w-[100px] max-w-full inline-flex items-center gap-1 flex-wrap
                       text-[13px] border border-transparent rounded px-1
                       hover:border-input data-[state=open]:border-input transition-colors
                       text-left"
          >
            {property.value.length > 0 ? (
              property.value.map((v) => (
                <OptionChip
                  key={v}
                  value={v}
                  explicit={property.optionColors?.[v]}
                />
              ))
            ) : (
              <span className="text-muted-foreground/50">—</span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          sideOffset={4}
          className="w-[260px] p-0 rounded-md"
        >
          <ul className="flex flex-col py-1 max-h-[260px] overflow-y-auto">
            {property.options.map((o) => {
              const checked = selectedSet.has(o);
              return (
                <li key={o}>
                  <button
                    type="button"
                    onClick={() => toggleValue(o)}
                    className="w-full flex items-center gap-2 px-2 py-1 hover:bg-accent text-left"
                  >
                    <Checkbox
                      checked={checked}
                      tabIndex={-1}
                      className="pointer-events-none"
                    />
                    <OptionChip
                      value={o}
                      explicit={property.optionColors?.[o]}
                      className="flex-1 min-w-0"
                    />
                  </button>
                </li>
              );
            })}
            {property.options.length === 0 && (
              <li className="px-2 py-2 text-[12px] text-muted-foreground">
                Опций пока нет
              </li>
            )}
          </ul>
        </PopoverContent>
      </Popover>

      {/* Кнопка «опции» — то же что у SelectControl, с палитрой. */}
      {canEditOptions && property.options.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[11px] text-muted-foreground/70 hover:text-foreground"
              aria-label="Управление опциями"
            >
              опции ({property.options.length})
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[260px]">
            {property.options.map((o) => (
              <div
                key={o}
                className="group/opt flex items-center gap-1 px-1.5 py-1 rounded-sm hover:bg-accent"
              >
                <OptionChip
                  value={o}
                  explicit={property.optionColors?.[o]}
                  className="flex-1 min-w-0"
                />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="px-1 [&>svg:last-child]:hidden">
                    <Palette className="size-3.5 text-muted-foreground/70" />
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="min-w-[180px]">
                    <DropdownMenuItem
                      onSelect={() => setOptionColor(o, null)}
                      className="text-muted-foreground"
                    >
                      <span className="size-3.5 shrink-0 rounded-full border border-dashed border-muted-foreground/40" />
                      По умолчанию
                      {!property.optionColors?.[o] && (
                        <Check className="ml-auto size-3.5" />
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {PALETTE_COLORS.filter((c) => c.name !== "default").map(
                      (c) => {
                        const isCurrent = property.optionColors?.[o] === c.name;
                        return (
                          <DropdownMenuItem
                            key={c.name}
                            onSelect={() => setOptionColor(o, c.name)}
                          >
                            <span
                              className={cn(
                                "size-3.5 shrink-0 rounded-full",
                                paletteDot(c.name),
                              )}
                            />
                            {c.label}
                            {isCurrent && (
                              <Check className="ml-auto size-3.5" />
                            )}
                          </DropdownMenuItem>
                        );
                      },
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <button
                  type="button"
                  aria-label={`Удалить опцию «${o}»`}
                  onClick={() => {
                    const next = property.options.filter((x) => x !== o);
                    onChangeOptions(next);
                  }}
                  className="size-6 flex items-center justify-center rounded-sm
                             text-muted-foreground/50 hover:text-destructive
                             hover:bg-destructive/10"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setAdding(true);
              }}
            >
              <Plus className="size-3.5" /> добавить опцию
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {canEditOptions && (adding || property.options.length === 0) && (
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitAdd}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitAdd();
            } else if (e.key === "Escape") {
              setAdding(false);
              setDraft("");
            }
          }}
          placeholder="новая опция"
          className="h-7 w-[140px] text-[13px]"
        />
      )}
      {/* Inline X-кнопки на чипсах для быстрого снятия */}
      {property.value.length > 0 && (
        <span className="sr-only">
          Выбрано: {property.value.join(", ")}
        </span>
      )}
      {property.value.map((v) => (
        <button
          key={`remove-${v}`}
          type="button"
          aria-label={`Снять выбор «${v}»`}
          onClick={() => removeChip(v)}
          className="hidden"
        />
      ))}
    </div>
  );
}
