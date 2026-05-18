"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, GripVertical, Plus, Star } from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS as DndCSS } from "@dnd-kit/utilities";

import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PALETTE_GRID, paletteDot } from "@/lib/palette";
import { KB_PROPERTY_UI_ICONS } from "@/components/knowledge/property-ui-icons";
import { unitSuffix, type Unit } from "@/lib/units";
import type { KbProperty, KbPropertyColor, KbPropertyType } from "@/types/knowledge";

import { OptionChip } from "./option-chip";
import { OptionMenuPopover } from "./controls/option-menu-popover";
import { PropertyIconButton } from "./controls/property-icon-button";
import { UnitPickerItems } from "./controls/unit-picker-items";
import { propertyTypeOptions, TYPE_LABELS, TYPE_ICONS } from "./helpers";

interface PropertyEditorPopoverProps {
  /** Опциональный триггер. Если не задан — поповер контролируется
   *  через `open`/`onOpenChange` и якорится скрытым span'ом. */
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  property: KbProperty;
  canEdit: boolean;
  onRename: (name: string) => void;
  onChangeIcon: (icon: string | null, iconColor: string | null) => void;
  onChangeDescription: (description: string) => void;
  onChangeType: (t: KbPropertyType) => void;
  onChangeUnit: (unit: Unit | null) => void;
  onChangeRatingScale: (max: number) => void;
  onChangeDisplayVariant: (variant: string | undefined) => void;
  onChangeNumberView: (view: "number" | "stars" | "slider") => void;
  onChangeNumberDecimals: (decimals: number | undefined) => void;
  onChangeDateFormat: (fmt: "full" | "short" | "relative") => void;
  onToggleCollapse: () => void;
  onChangeOptions: (options: string[]) => void;
  onChangeOptionColors: (
    c: Partial<Record<string, KbPropertyColor>> | undefined,
  ) => void;
  onRenameOption: (from: string, to: string) => void;
  onRemoveOption: (option: string) => void;
  onChangeRatingColor: (c: KbPropertyColor | null) => void;
  onChangeRatingShowValue: (show: boolean) => void;
  onChangeOptionSort: (sort: "manual" | "alpha" | "alpha-desc") => void;
  onChangeOptionDescriptions: (
    d: Partial<Record<string, string>> | undefined,
  ) => void;
}

export function PropertyEditorPopover({
  trigger,
  open,
  onOpenChange,
  property,
  canEdit,
  onRename,
  onChangeIcon,
  onChangeDescription,
  onChangeType,
  onChangeUnit,
  onChangeRatingScale,
  onChangeDisplayVariant,
  onChangeNumberView,
  onChangeNumberDecimals,
  onChangeDateFormat,
  onToggleCollapse,
  onChangeOptions,
  onChangeOptionColors,
  onRenameOption,
  onRemoveOption,
  onChangeRatingColor,
  onChangeRatingShowValue,
  onChangeOptionSort,
  onChangeOptionDescriptions,
}: PropertyEditorPopoverProps) {
  // ── Name draft ──────────────────────────────────────────────────────
  const [nameDraft, setNameDraft] = useState(property.name);
  useEffect(() => setNameDraft(property.name), [property.name]);

  // ── Description toggle + draft ──────────────────────────────────────
  const [descOpen, setDescOpen] = useState(false);
  const [descDraft, setDescDraft] = useState(property.description ?? "");
  useEffect(() => setDescDraft(property.description ?? ""), [property.description]);
  const descRef = useRef<HTMLTextAreaElement | null>(null);
  // Auto-grow textarea: сброс height → scrollHeight (иначе высота
  // «залипает» на максимуме и не сжимается при удалении).
  const resizeDesc = () => {
    const ta = descRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  };
  useEffect(() => {
    if (descOpen) resizeDesc();
  }, [descOpen, descDraft]);

  // Закрытие поповера (клик мимо / Esc) — сбрасываем несохранённый
  // draft описания в проп, чтобы не требовать Enter.
  const handleOpenChange = (next: boolean) => {
    if (!next && descDraft !== (property.description ?? "")) {
      onChangeDescription(descDraft);
    }
    onOpenChange?.(next);
  };

  // ── Options DnD ─────────────────────────────────────────────────────
  const [adding, setAdding] = useState(false);
  const [optDraft, setOptDraft] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const options =
    property.type === "select" || property.type === "multi-select"
      ? property.options
      : [];
  const optionColors =
    property.type === "select" || property.type === "multi-select"
      ? property.optionColors
      : undefined;
  const optionDescriptions =
    property.type === "select" || property.type === "multi-select"
      ? property.optionDescriptions
      : undefined;

  const setColor = (option: string, color: KbPropertyColor | null) => {
    const next: Partial<Record<string, KbPropertyColor>> = {
      ...(optionColors ?? {}),
    };
    if (color === null) delete next[option];
    else next[option] = color;
    onChangeOptionColors(Object.keys(next).length > 0 ? next : undefined);
  };

  const setDescription = (option: string, description: string) => {
    // Храним raw (без trim) — иначе resync draft'а из пропа на каждый
    // keystroke съедал бы пробелы. Trim делает zod при сохранении.
    const next: Partial<Record<string, string>> = {
      ...(optionDescriptions ?? {}),
    };
    if (description === "") delete next[option];
    else next[option] = description;
    onChangeOptionDescriptions(
      Object.keys(next).length > 0 ? next : undefined,
    );
  };

  const removeOption = (option: string) => {
    onRemoveOption(option);
  };

  const renameOption = (from: string, to: string) => {
    const v = to.trim();
    if (!v || v === from) return;
    if (options.includes(v)) {
      toast.warning("Такой вариант уже есть");
      return;
    }
    onRenameOption(from, v);
  };

  const commitAdd = () => {
    const v = optDraft.trim();
    if (!v) {
      setAdding(false);
      setOptDraft("");
      return;
    }
    if (options.includes(v)) {
      toast.warning("Такой вариант уже есть");
      return;
    }
    onChangeOptions([...options, v]);
    setOptDraft("");
    setAdding(false);
  };

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = options.indexOf(String(active.id));
    const to = options.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onChangeOptions(arrayMove(options, from, to));
  };

  // ── Number view derived state ────────────────────────────────────────
  const numberView: "number" | "stars" | "slider" =
    property.type === "number"
      ? property.displayVariant !== "rating"
        ? "number"
        : (property.ratingVariant ?? "stars")
      : "number";

  // ── Unit display label ───────────────────────────────────────────────
  const unitLabel =
    property.type === "number" && property.unit
      ? unitSuffix(property.unit) || "—"
      : "—";

  const isOptionType =
    property.type === "select" || property.type === "multi-select";

  // ── Is stars / slider for number & rating ───────────────────────────
  const isStars =
    (property.type === "number" && numberView === "stars") ||
    (property.type === "rating" && (property.displayVariant ?? "stars") === "stars");
  const isSlider =
    (property.type === "number" && numberView === "slider") ||
    (property.type === "rating" && property.displayVariant === "slider");

  // ── ratingColor for both number & rating ────────────────────────────
  const ratingColor: KbPropertyColor | undefined =
    property.type === "number" || property.type === "rating"
      ? (property as { ratingColor?: KbPropertyColor }).ratingColor
      : undefined;

  // ── ratingShowValue ─────────────────────────────────────────────────
  const ratingShowValue =
    (property.type === "number" && property.displayVariant === "rating")
      ? (property.ratingShowValue ?? true)
      : property.type === "rating"
        ? (property.ratingShowValue ?? true)
        : true;

  // ── Max value ───────────────────────────────────────────────────────
  const currentMax =
    (property.type === "number" || property.type === "rating")
      ? ((property as { max?: number }).max ?? 5)
      : 5;

  // ── Slider max input draft ───────────────────────────────────────────
  const [sliderMaxDraft, setSliderMaxDraft] = useState(String(currentMax));
  useEffect(() => {
    setSliderMaxDraft(String(currentMax));
  }, [currentMax]);

  const commitSliderMax = (raw: string) => {
    const n = Math.max(1, Math.round(Number(raw) || 1));
    onChangeRatingScale(n);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <span
            className="pointer-events-none absolute left-0 top-1/2 size-px"
            aria-hidden="true"
          />
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[244px] overflow-hidden rounded-xl p-0"
      >
        {/* ── Header: icon · name · description ──────────────────────── */}
        <div className="flex items-center gap-2 px-2.5 pt-2.5 pb-2">
          <PropertyIconButton
            property={property}
            canEdit={canEdit}
            onChangeIcon={onChangeIcon}
          />
          <div className="relative min-w-0 flex-1">
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => {
                const t = nameDraft.trim();
                if (t && t !== property.name) onRename(t);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const t = e.currentTarget.value.trim();
                  if (t && t !== property.name) onRename(t);
                  e.currentTarget.blur();
                }
                if (e.key === "Escape") {
                  setNameDraft(property.name);
                  e.currentTarget.blur();
                }
              }}
              placeholder="Имя свойства"
              aria-label="Имя свойства"
              className="h-8 w-full rounded-md border border-input bg-transparent pl-2 pr-10 text-[13px] text-foreground outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 placeholder:text-muted-foreground/50"
            />
            <button
              type="button"
              aria-label="Описание свойства"
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
              autoFocus
              rows={1}
              value={descDraft}
              onChange={(e) => {
                setDescDraft(e.target.value);
                onChangeDescription(e.target.value);
              }}
              onInput={resizeDesc}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  setDescOpen(false);
                }
                if (e.key === "Escape") {
                  setDescDraft(property.description ?? "");
                  onChangeDescription(property.description ?? "");
                  setDescOpen(false);
                }
              }}
              placeholder="Добавить описание…"
              aria-label="Описание свойства"
              className="w-full resize-none overflow-hidden rounded-md border
                         border-input bg-transparent px-2 py-1.5 text-[13px]
                         leading-snug text-muted-foreground outline-none
                         focus:border-brand focus:ring-2 focus:ring-brand/30
                         placeholder:text-muted-foreground/40"
            />
          </div>
        )}

        {/* ── Type ─────────────────────────────────────────────────────── */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between px-2.5 py-1.5
                         text-[13px] transition-colors hover:bg-accent"
            >
              <span className="flex items-center gap-2.5 text-muted-foreground">
                <KB_PROPERTY_UI_ICONS.changeType className="size-4 text-muted-foreground/70" />
                Тип
              </span>
              <span className="flex items-center gap-1 text-foreground">
                {TYPE_LABELS[property.type]}
                <ChevronRight className="size-3.5 text-muted-foreground/50" />
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[176px]">
            {propertyTypeOptions(property.type).map((t) => {
              const TIcon = TYPE_ICONS[t];
              const isCurrent = t === property.type;
              return (
                <DropdownMenuItem
                  key={t}
                  disabled={isCurrent}
                  onSelect={() => onChangeType(t)}
                >
                  <TIcon className="size-3.5 text-muted-foreground" />
                  {TYPE_LABELS[t]}
                  {isCurrent && (
                    <Check className="ml-auto size-3.5 text-muted-foreground/60" />
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        {isOptionType && (
          <OptionSortDropdownRow
            value={
              ("optionSort" in property
                ? property.optionSort
                : undefined) ?? "manual"
            }
            onChange={onChangeOptionSort}
          />
        )}

        {/* ── Per-type params ─────────────────────────────────────────── */}
        <div className="py-1">
          {isOptionType && (
            <div className="px-2.5 py-1">
              <SectionLabel>Варианты</SectionLabel>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={options}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="flex flex-col">
                    {options.map((o) => (
                      <OptionRow
                        key={o}
                        option={o}
                        color={optionColors?.[o]}
                        description={optionDescriptions?.[o]}
                        onRename={(to) => renameOption(o, to)}
                        onRemove={() => removeOption(o)}
                        onSetColor={(c) => setColor(o, c)}
                        onSetDescription={(d) => setDescription(o, d)}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
              {adding || options.length === 0 ? (
                <input
                  autoFocus
                  value={optDraft}
                  onChange={(e) => setOptDraft(e.target.value)}
                  onBlur={commitAdd}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitAdd();
                    } else if (e.key === "Escape") {
                      setAdding(false);
                      setOptDraft("");
                    }
                  }}
                  placeholder="Новый вариант"
                  className="mt-1.5 h-8 w-full rounded-lg bg-muted/50 px-2.5 text-[13px]
                             outline-none ring-brand/30 transition-shadow
                             focus:bg-transparent focus:ring-2"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="mt-1 flex w-full items-center gap-2 rounded-md px-1.5 py-1.5
                             text-[13px] font-medium text-brand transition-colors
                             hover:bg-brand/[0.08]"
                >
                  <Plus className="size-3.5" />
                  Добавить вариант
                </button>
              )}
            </div>
          )}

          {property.type === "number" && (
            <div className="flex flex-col gap-1">
              <div className="px-2.5 py-1">
                <ViewCards
                  value={numberView}
                  onChange={(v) =>
                    onChangeNumberView(v as "number" | "stars" | "slider")
                  }
                  options={[
                    { value: "number", label: "Число", glyph: <NumberGlyph /> },
                    { value: "stars", label: "Звёзды", glyph: <StarsGlyph /> },
                    {
                      value: "slider",
                      label: "Слайдер",
                      glyph: <SliderGlyph />,
                    },
                  ]}
                />
              </div>

              {numberView === "number" ? (
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between px-2.5 py-1.5
                                   text-[13px] transition-colors hover:bg-accent"
                      >
                        <span className="flex items-center gap-2.5 text-muted-foreground">
                          <KB_PROPERTY_UI_ICONS.unit className="size-4 text-muted-foreground/70" />
                          Единицы
                        </span>
                        <span className="flex items-center gap-1 text-foreground">
                          {unitLabel}
                          <ChevronRight className="size-3.5 text-muted-foreground/50" />
                        </span>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="min-w-[200px] max-h-[360px] overflow-y-auto"
                    >
                      <UnitPickerItems
                        current={property.unit}
                        onChange={onChangeUnit}
                      />
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <RoundingDropdownRow
                    value={property.decimals}
                    onChange={onChangeNumberDecimals}
                  />
                </>
              ) : (
                /* stars or slider */
                <>
                  {isStars && (
                    <ScaleDropdownRow
                      current={currentMax}
                      onChange={onChangeRatingScale}
                    />
                  )}
                  {isSlider && (
                    <>
                      <SliderMaxRow
                        value={sliderMaxDraft}
                        onChange={setSliderMaxDraft}
                        onCommit={commitSliderMax}
                      />
                      <ShowValueRow
                        checked={ratingShowValue}
                        onCheckedChange={onChangeRatingShowValue}
                      />
                    </>
                  )}
                  <ColorRow
                    color={ratingColor}
                    onChange={onChangeRatingColor}
                  />
                </>
              )}
            </div>
          )}

          {property.type === "checkbox" && (
            <div className="px-2.5 py-1">
              <ViewCards
                value={property.displayVariant ?? "checkbox"}
                onChange={(v) =>
                  onChangeDisplayVariant(
                    v === "checkbox" ? undefined : "switch",
                  )
                }
                options={[
                  {
                    value: "checkbox",
                    label: "Чекбокс",
                    glyph: <CheckboxGlyph />,
                  },
                  {
                    value: "switch",
                    label: "Триггер",
                    glyph: <SwitchGlyph />,
                  },
                ]}
              />
            </div>
          )}

          {property.type === "rating" && (
            <div className="flex flex-col gap-1">
              <div className="px-2.5 py-1">
                <ViewCards
                  value={property.displayVariant ?? "stars"}
                  onChange={(v) =>
                    onChangeDisplayVariant(
                      v === "stars" ? undefined : "slider",
                    )
                  }
                  options={[
                    { value: "stars", label: "Звёзды", glyph: <StarsGlyph /> },
                    {
                      value: "slider",
                      label: "Слайдер",
                      glyph: <SliderGlyph />,
                    },
                  ]}
                />
              </div>
              {isStars && (
                <ScaleDropdownRow
                  current={currentMax}
                  onChange={onChangeRatingScale}
                />
              )}
              {isSlider && (
                <>
                  <SliderMaxRow
                    value={sliderMaxDraft}
                    onChange={setSliderMaxDraft}
                    onCommit={commitSliderMax}
                  />
                  <ShowValueRow
                    checked={ratingShowValue}
                    onCheckedChange={onChangeRatingShowValue}
                  />
                </>
              )}
              <ColorRow
                color={ratingColor}
                onChange={onChangeRatingColor}
              />
            </div>
          )}

          {property.type === "text" && (
            <div className="flex w-full items-center justify-between px-2.5 py-1.5 text-[13px]">
              <span className="text-muted-foreground">Сворачивать</span>
              <Switch
                checked={property.collapsed === true}
                onCheckedChange={() => onToggleCollapse()}
              />
            </div>
          )}

          {property.type === "url" && (
            <div className="flex w-full items-center justify-between px-2.5 py-1.5 text-[13px]">
              <span className="text-muted-foreground">Сокращать ссылку</span>
              <Switch
                checked={property.urlCollapsed === true}
                onCheckedChange={() => onToggleCollapse()}
              />
            </div>
          )}

          {property.type === "date" && (
            <DateFormatDropdownRow
              value={property.dateFormat ?? "full"}
              onChange={onChangeDateFormat}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** @deprecated Use PropertyEditorPopover instead. Kept for backwards compatibility. */
export { PropertyEditorPopover as OptionEditorPopover };

// ── Section label (без uppercase — sentence-case, по просьбе юзера) ──────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="pb-1.5 text-[12px] font-semibold text-muted-foreground/70">
      {children}
    </div>
  );
}

// ── «Шкала» dropdown row (for stars mode) ────────────────────────────────────
function ScaleDropdownRow({
  current,
  onChange,
}: {
  current: number;
  onChange: (n: number) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between px-2.5 py-1.5
                     text-[13px] transition-colors hover:bg-accent"
        >
          <span className="flex items-center gap-2.5 text-muted-foreground">
            <KB_PROPERTY_UI_ICONS.scale className="size-4 text-muted-foreground/70" />
            Шкала
          </span>
          <span className="flex items-center gap-1 text-foreground">
            {current}
            <ChevronRight className="size-3.5 text-muted-foreground/50" />
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[100px]">
        {[3, 5, 10].map((n) => {
          const isCurrent = current === n;
          return (
            <DropdownMenuItem
              key={n}
              disabled={isCurrent}
              onSelect={() => onChange(n)}
            >
              {n}
              {isCurrent && (
                <Check className="ml-auto size-3.5 text-muted-foreground/60" />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── «Максимальное значение» numeric input row (for slider mode) ───────────────
function SliderMaxRow({
  value,
  onChange,
  onCommit,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
}) {
  return (
    <div className="flex w-full items-center justify-between px-2.5 py-1.5 text-[13px]">
      <span className="text-muted-foreground">Максимальное значение</span>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onCommit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit(e.currentTarget.value);
            e.currentTarget.blur();
          }
        }}
        className="w-14 h-7 rounded-md border border-input bg-transparent px-2 text-right
                   text-[13px] text-foreground outline-none
                   focus:border-brand focus:ring-2 focus:ring-brand/30
                   [appearance:textfield]
                   [&::-webkit-outer-spin-button]:appearance-none
                   [&::-webkit-inner-spin-button]:appearance-none"
        aria-label="Максимальное значение шкалы"
      />
    </div>
  );
}

// ── «Показывать число» switch row ─────────────────────────────────────────────
function ShowValueRow({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex w-full items-center justify-between px-2.5 py-1.5 text-[13px]">
      <span className="text-muted-foreground">Показывать число</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

// ── «Цвет» row with palette grid popover ─────────────────────────────────────
function ColorRow({
  color,
  onChange,
}: {
  color?: import("@/lib/palette").PaletteColor;
  onChange: (c: import("@/lib/palette").PaletteColor | null) => void;
}) {
  const currentName = color ?? "default";
  const currentLabel =
    PALETTE_GRID.find((c) => c.name === currentName)?.label ?? "По умолчанию";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between px-2.5 py-1.5
                     text-[13px] transition-colors hover:bg-accent"
        >
          <span className="flex items-center gap-2.5 text-muted-foreground">
            <KB_PROPERTY_UI_ICONS.color className="size-4 text-muted-foreground/70" />
            Цвет
          </span>
          <span className="flex items-center gap-1.5 text-foreground">
            <span
              className={cn(
                "size-3.5 shrink-0 rounded-full",
                currentName === "default"
                  ? "bg-muted"
                  : paletteDot(currentName),
              )}
            />
            {currentLabel}
            <ChevronRight className="size-3.5 text-muted-foreground/50" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[200px] p-1.5 rounded-[10px]"
      >
        {PALETTE_GRID.map((c) => {
          const isCurrent = currentName === c.name;
          return (
            <button
              key={c.name}
              type="button"
              onClick={() => onChange(c.name === "default" ? null : c.name)}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5
                         text-[13px] transition-colors hover:bg-accent"
            >
              <span
                className={cn(
                  "size-4 shrink-0 rounded-full",
                  c.name === "default"
                    ? "bg-muted"
                    : paletteDot(c.name),
                )}
              />
              <span className="flex-1 text-left">{c.label}</span>
              {isCurrent && (
                <Check className="size-3.5 text-muted-foreground/60" />
              )}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

// ── Graphic «view» cards (Notion «Show as») ─────────────────────────────────
function ViewCards({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string; glyph: React.ReactNode }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      className="grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }}
    >
      {options.map((opt) => {
        const isCurrent = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => !isCurrent && onChange(opt.value)}
            className={cn(
              "flex flex-col items-center gap-2 rounded-lg border px-2 pt-3 pb-2",
              "transition-[border-color,background-color,transform] active:scale-[0.98]",
              isCurrent
                ? "border-brand bg-brand/10 ring-1 ring-brand/40"
                : "border-border hover:border-foreground/25 hover:bg-accent",
            )}
            aria-pressed={isCurrent}
          >
            <span className="flex h-6 items-center justify-center text-foreground/80">
              {opt.glyph}
            </span>
            <span
              className={cn(
                "text-[11px] leading-none",
                isCurrent
                  ? "font-medium text-brand"
                  : "text-muted-foreground",
              )}
            >
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── «Округление» dropdown row ────────────────────────────────────────────────
const ROUNDING_OPTIONS: { value: number | undefined; label: string }[] = [
  { value: undefined, label: "Авто" },
  { value: 0, label: "Целое" },
  { value: 1, label: "1 знак" },
  { value: 2, label: "2 знака" },
  { value: 3, label: "3 знака" },
];

function RoundingDropdownRow({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) {
  const currentLabel =
    ROUNDING_OPTIONS.find((o) => o.value === value)?.label ?? "Авто";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between px-2.5 py-1.5
                     text-[13px] transition-colors hover:bg-accent"
        >
          <span className="flex items-center gap-2.5 text-muted-foreground">
            <KB_PROPERTY_UI_ICONS.rounding className="size-4 text-muted-foreground/70" />
            Округление
          </span>
          <span className="flex items-center gap-1 text-foreground">
            {currentLabel}
            <ChevronRight className="size-3.5 text-muted-foreground/50" />
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px]">
        {ROUNDING_OPTIONS.map((o) => {
          const isCurrent = o.value === value;
          return (
            <DropdownMenuItem
              key={String(o.value)}
              disabled={isCurrent}
              onSelect={() => onChange(o.value)}
            >
              {o.label}
              {isCurrent && (
                <Check className="ml-auto size-3.5 text-muted-foreground/60" />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── «Формат» date dropdown row ───────────────────────────────────────────────
const DATE_FORMAT_OPTIONS: {
  value: "full" | "short" | "relative";
  label: string;
}[] = [
  { value: "full", label: "Полный" },
  { value: "short", label: "Короткий" },
  { value: "relative", label: "Относительный" },
];

function DateFormatDropdownRow({
  value,
  onChange,
}: {
  value: "full" | "short" | "relative";
  onChange: (v: "full" | "short" | "relative") => void;
}) {
  const currentLabel =
    DATE_FORMAT_OPTIONS.find((o) => o.value === value)?.label ?? "Полный";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between px-2.5 py-1.5
                     text-[13px] transition-colors hover:bg-accent"
        >
          <span className="flex items-center gap-2.5 text-muted-foreground">
            <KB_PROPERTY_UI_ICONS.dateFormat className="size-4 text-muted-foreground/70" />
            Формат
          </span>
          <span className="flex items-center gap-1 text-foreground">
            {currentLabel}
            <ChevronRight className="size-3.5 text-muted-foreground/50" />
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        {DATE_FORMAT_OPTIONS.map((o) => {
          const isCurrent = o.value === value;
          return (
            <DropdownMenuItem
              key={o.value}
              disabled={isCurrent}
              onSelect={() => onChange(o.value)}
            >
              {o.label}
              {isCurrent && (
                <Check className="ml-auto size-3.5 text-muted-foreground/60" />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── «Сортировка» option-list dropdown row ───────────────────────────────────
const OPTION_SORT_OPTIONS: {
  value: "manual" | "alpha" | "alpha-desc";
  label: string;
}[] = [
  { value: "manual", label: "Ручная" },
  { value: "alpha", label: "А–Я" },
  { value: "alpha-desc", label: "Я–А" },
];

function OptionSortDropdownRow({
  value,
  onChange,
}: {
  value: "manual" | "alpha" | "alpha-desc";
  onChange: (v: "manual" | "alpha" | "alpha-desc") => void;
}) {
  const currentLabel =
    OPTION_SORT_OPTIONS.find((o) => o.value === value)?.label ?? "Ручная";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between px-2.5 py-1.5
                     text-[13px] transition-colors hover:bg-accent"
        >
          <span className="flex items-center gap-2.5 text-muted-foreground">
            <KB_PROPERTY_UI_ICONS.sort className="size-4 text-muted-foreground/70" />
            Сортировка
          </span>
          <span className="flex items-center gap-1 text-foreground">
            {currentLabel}
            <ChevronRight className="size-3.5 text-muted-foreground/50" />
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px]">
        {OPTION_SORT_OPTIONS.map((o) => {
          const isCurrent = o.value === value;
          return (
            <DropdownMenuItem
              key={o.value}
              disabled={isCurrent}
              onSelect={() => onChange(o.value)}
            >
              {o.label}
              {isCurrent && (
                <Check className="ml-auto size-3.5 text-muted-foreground/60" />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Tiny graphics for ViewCards ─────────────────────────────────────────────
function NumberGlyph() {
  return (
    <span className="text-[17px] font-semibold tabular-nums tracking-tight">
      42
    </span>
  );
}

function StarsGlyph() {
  return (
    <span className="flex items-center gap-0.5">
      {[0, 1, 2].map((i) => (
        <Star key={i} className="size-3 fill-amber-400 text-amber-400" />
      ))}
    </span>
  );
}

function SliderGlyph() {
  return (
    <span className="relative block h-1 w-9 rounded-full bg-muted-foreground/25">
      <span className="absolute inset-y-0 left-0 w-5 rounded-full bg-foreground/50" />
      <span className="absolute left-5 top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow-sm" />
    </span>
  );
}

function CheckboxGlyph() {
  return (
    <span className="inline-flex size-[18px] items-center justify-center rounded-[5px] bg-brand text-white">
      <Check className="size-3" strokeWidth={3} />
    </span>
  );
}

function SwitchGlyph() {
  return (
    <span className="relative block h-[18px] w-7 rounded-full bg-brand">
      <span className="absolute right-0.5 top-1/2 size-3.5 -translate-y-1/2 rounded-full bg-white shadow-sm" />
    </span>
  );
}

// ── OptionRow: цветной чип + drag-handle + hover «⋯» меню ────────────────────
function OptionRow({
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
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: option });

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: DndCSS.Transform.toString(transform),
        transition,
      }}
      className="group/opt flex items-center gap-1.5 rounded-md px-1 py-1 hover:bg-accent"
    >
      <button
        type="button"
        aria-label="Перетащить вариант"
        className="size-5 inline-flex items-center justify-center text-muted-foreground/40
                   cursor-grab active:cursor-grabbing hover:text-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5" />
      </button>
      {description?.trim() ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex min-w-0">
              <OptionChip value={option} explicit={color} className="min-w-0" />
            </span>
          </TooltipTrigger>
          <TooltipContent
            side="left"
            align="center"
            sideOffset={48}
            collisionPadding={8}
            className="max-w-[260px]"
          >
            <div className="grid gap-0.5">
              <strong className="font-semibold leading-tight">{option}</strong>
              <span className="font-normal leading-snug text-neutral-200">
                {description}
              </span>
            </div>
          </TooltipContent>
        </Tooltip>
      ) : (
        <OptionChip value={option} explicit={color} className="min-w-0" />
      )}
      <span className="flex-1" />
      <OptionMenuPopover
        option={option}
        color={color}
        description={description}
        onRename={onRename}
        onRemove={onRemove}
        onSetColor={onSetColor}
        onSetDescription={onSetDescription}
      />
    </li>
  );
}

