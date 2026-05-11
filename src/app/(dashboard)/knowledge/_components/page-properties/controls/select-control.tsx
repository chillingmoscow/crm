"use client";

import { useState } from "react";

import { Check, Palette, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { PALETTE_COLORS, paletteDot } from "@/lib/palette";
import type { KbProperty, KbPropertyColor } from "@/types/knowledge";

import { OptionChip } from "../option-chip";

export function SelectControl({
  property,
  canEdit,
  canEditOptions,
  onChangeValue,
  onChangeOptions,
  onChangeOptionColors,
}: {
  property: Extract<KbProperty, { type: "select" }>;
  canEdit: boolean;
  canEditOptions: boolean;
  onChangeValue: (value: string | null) => void;
  onChangeOptions: (options: string[]) => void;
  onChangeOptionColors: (
    optionColors: Partial<Record<string, KbPropertyColor>> | undefined,
  ) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

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
    onChangeValue(v);
    setDraft("");
    setAdding(false);
  };

  // Patch optionColors map'а: либо устанавливаем явный цвет, либо
  // удаляем запись (= вернуть к hash-fallback'у).
  const setOptionColor = (option: string, color: KbPropertyColor | null) => {
    const next: Partial<Record<string, KbPropertyColor>> = {
      ...(property.optionColors ?? {}),
    };
    if (color === null) {
      delete next[option];
    } else {
      next[option] = color;
    }
    onChangeOptionColors(
      Object.keys(next).length > 0 ? next : undefined,
    );
  };

  if (!canEdit) {
    return property.value ? (
      <OptionChip
        value={property.value}
        explicit={property.optionColors?.[property.value]}
      />
    ) : (
      <span className="text-[13px] text-muted-foreground/50">—</span>
    );
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Select
        value={property.value ?? ""}
        onValueChange={(v) => onChangeValue(v === "__none__" ? null : v)}
      >
        <SelectTrigger
          className="h-7 w-auto min-w-[100px] max-w-[280px] text-[13px] border-transparent bg-transparent px-1
                     hover:border-input focus:border-input
                     [&>svg]:opacity-50 hover:[&>svg]:opacity-100"
        >
          {property.value ? (
            <OptionChip
              value={property.value}
              explicit={property.optionColors?.[property.value]}
            />
          ) : (
            <span className="text-muted-foreground/50">—</span>
          )}
        </SelectTrigger>
        <SelectContent className="max-w-[320px]">
          <SelectItem value="__none__" className="text-muted-foreground">
            (не задано)
          </SelectItem>
          {property.options.map((o) => (
            <SelectItem key={o} value={o} className="py-1.5">
              <OptionChip
                value={o}
                explicit={property.optionColors?.[o]}
              />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
                {/* Submenu с палитрой — Notion-style. Кнопка-палитра
                 *  открывает выбор цвета для этой опции; «По умолчанию»
                 *  = убрать override. */}
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
                    if (property.value === o) onChangeValue(null);
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
    </div>
  );
}
