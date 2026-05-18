"use client";

import { useMemo, useState } from "react";
import { Check, Plus, X } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { KbPropertyColor } from "@/types/knowledge";

import { OptionChip } from "../option-chip";
import { OptionMenuPopover } from "./option-menu-popover";

export type OptionSort = "manual" | "alpha" | "alpha-desc";

/** Порядок вариантов: manual = как в массиве, alpha = А–Я,
 *  alpha-desc = Я–А (ru-локаль). */
export function orderedOptions(
  options: string[],
  sort: OptionSort | undefined,
): string[] {
  if (sort !== "alpha" && sort !== "alpha-desc") return options;
  const sorted = [...options].sort((a, b) =>
    a.localeCompare(b, "ru", { sensitivity: "base" }),
  );
  return sort === "alpha-desc" ? sorted.reverse() : sorted;
}

/**
 * Единый поисковый пикер вариантов для select / multi-select.
 * Notion-паттерн в нашем стиле: чипы выбранного (с «×»), поповер с
 * поиском, выбором и созданием на лету. Управление цветами/порядком/
 * переименованием/удалением/описанием вариантов живёт в редакторе
 * свойства (PropertyEditorPopover) — здесь только выбор и создание.
 */
export function OptionValuePicker({
  multi,
  value,
  options,
  optionColors,
  optionDescriptions,
  optionSort,
  onChange,
  onChangeOptions,
  onChangeOptionColors,
  onChangeOptionDescriptions,
  onRenameOption,
  onRemoveOption,
}: {
  multi: boolean;
  value: string[];
  options: string[];
  optionColors?: Partial<Record<string, KbPropertyColor>>;
  optionDescriptions?: Partial<Record<string, string>>;
  optionSort?: OptionSort;
  onChange: (next: string[]) => void;
  onChangeOptions: (options: string[]) => void;
  onChangeOptionColors?: (
    c: Partial<Record<string, KbPropertyColor>> | undefined,
  ) => void;
  onChangeOptionDescriptions?: (
    d: Partial<Record<string, string>> | undefined,
  ) => void;
  onRenameOption?: (from: string, to: string) => void;
  onRemoveOption?: (option: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedSet = useMemo(() => new Set(value), [value]);
  const ordered = useMemo(
    () => orderedOptions(options, optionSort),
    [options, optionSort],
  );

  const q = query.trim();
  const filtered = q
    ? ordered.filter((o) => o.toLowerCase().includes(q.toLowerCase()))
    : ordered;
  const exact = options.some((o) => o.toLowerCase() === q.toLowerCase());
  const canCreate = q.length > 0 && !exact;

  const pick = (option: string) => {
    if (multi) {
      onChange(
        selectedSet.has(option)
          ? value.filter((v) => v !== option)
          : [...value, option],
      );
      setQuery("");
    } else {
      onChange([option]);
      setOpen(false);
    }
  };

  const create = () => {
    if (!canCreate) return;
    onChangeOptions([...options, q]);
    if (multi) {
      onChange([...value, q]);
      setQuery("");
    } else {
      onChange([q]);
      setOpen(false);
    }
  };

  const removeChip = (option: string) => {
    onChange(value.filter((v) => v !== option));
  };

  // Управление вариантом доступно, когда проброшены rename/remove.
  const canManage = !!onRenameOption && !!onRemoveOption;

  const setOptionColor = (option: string, c: KbPropertyColor | null) => {
    if (!onChangeOptionColors) return;
    const next: Partial<Record<string, KbPropertyColor>> = {
      ...(optionColors ?? {}),
    };
    if (c === null) delete next[option];
    else next[option] = c;
    onChangeOptionColors(Object.keys(next).length > 0 ? next : undefined);
  };

  const setOptionDescription = (option: string, d: string) => {
    if (!onChangeOptionDescriptions) return;
    // Raw (без trim) — см. setDescription в option-editor-popover.
    const next: Partial<Record<string, string>> = {
      ...(optionDescriptions ?? {}),
    };
    if (d === "") delete next[option];
    else next[option] = d;
    onChangeOptionDescriptions(
      Object.keys(next).length > 0 ? next : undefined,
    );
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Выбрать вариант"
          className="min-h-7 w-full inline-flex flex-wrap items-center gap-1
                     rounded px-1 text-left text-[13px] transition-colors"
        >
          {value.length > 0 ? (
            value.map((v) => (
              <span key={v} className="inline-flex items-center gap-0.5">
                <OptionChip value={v} explicit={optionColors?.[v]} />
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label={`Убрать «${v}»`}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeChip(v);
                  }}
                  className="inline-flex size-4 items-center justify-center
                             rounded text-muted-foreground/50
                             transition-colors hover:text-foreground"
                >
                  <X className="size-3" />
                </span>
              </span>
            ))
          ) : (
            <span className="text-muted-foreground/50">—</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[260px] overflow-hidden rounded-xl p-0"
      >
        <div className="border-b border-border px-2.5 py-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canCreate) {
                e.preventDefault();
                create();
              }
            }}
            placeholder="Поиск варианта…"
            aria-label="Поиск варианта"
            className="w-full bg-transparent text-[13px] outline-none
                       placeholder:text-muted-foreground/50"
          />
        </div>
        <div className="max-h-[260px] overflow-y-auto p-1">
          <div className="px-2 py-1 text-[12px] font-semibold text-muted-foreground/60">
            Выберите вариант или создайте
          </div>
          {filtered.map((o) => {
            const checked = selectedSet.has(o);
            const desc = optionDescriptions?.[o]?.trim();
            const chip = <OptionChip value={o} explicit={optionColors?.[o]} />;
            return (
              <div
                key={o}
                className="group/opt flex items-center gap-1 rounded-md pr-1
                           transition-colors hover:bg-accent"
              >
                <button
                  type="button"
                  onClick={() => pick(o)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md
                             px-2 py-1 text-left"
                >
                  {desc ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">{chip}</span>
                      </TooltipTrigger>
                      <TooltipContent
                        side="left"
                        align="center"
                        sideOffset={24}
                        collisionPadding={8}
                        className="max-w-[260px]"
                      >
                        <div className="grid gap-0.5">
                          <strong className="font-semibold leading-tight">
                            {o}
                          </strong>
                          <span className="font-normal leading-snug text-neutral-200">
                            {desc}
                          </span>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    chip
                  )}
                  {checked && (
                    <Check className="ml-auto size-3.5 shrink-0 text-muted-foreground/60" />
                  )}
                </button>
                {canManage && (
                  <OptionMenuPopover
                    option={o}
                    color={optionColors?.[o]}
                    description={optionDescriptions?.[o]}
                    onRename={(to) => onRenameOption?.(o, to)}
                    onRemove={() => onRemoveOption?.(o)}
                    onSetColor={(c) => setOptionColor(o, c)}
                    onSetDescription={(d) => setOptionDescription(o, d)}
                  />
                )}
              </div>
            );
          })}
          {canCreate && (
            <button
              type="button"
              onClick={create}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5
                         text-left text-[13px] transition-colors hover:bg-accent"
            >
              <Plus className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">Создать</span>
              <OptionChip value={q} explicit="default" />
            </button>
          )}
          {filtered.length === 0 && !canCreate && (
            <div className="px-2 py-2 text-[12px] text-muted-foreground">
              Ничего не найдено
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
