"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, GripVertical, Plus, X } from "lucide-react";
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
import { PALETTE_GRID, paletteDot } from "@/lib/palette";
import { KB_PROPERTY_UI_ICONS } from "@/components/knowledge/property-ui-icons";
import type { Unit } from "@/lib/units";
import type { KbProperty, KbPropertyColor, KbPropertyType } from "@/types/knowledge";

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
  onToggleCollapse: () => void;
  onChangeOptions: (options: string[]) => void;
  onChangeOptionColors: (
    c: Partial<Record<string, KbPropertyColor>> | undefined,
  ) => void;
  onRenameOption: (from: string, to: string) => void;
  onRemoveOption: (option: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
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
  onToggleCollapse,
  onChangeOptions,
  onChangeOptionColors,
  onRenameOption,
  onRemoveOption,
  onDuplicate,
  onRemove,
}: PropertyEditorPopoverProps) {
  // ── Name draft ──────────────────────────────────────────────────────
  const [nameDraft, setNameDraft] = useState(property.name);
  useEffect(() => setNameDraft(property.name), [property.name]);

  // ── Description toggle + draft ──────────────────────────────────────
  const [descOpen, setDescOpen] = useState(false);
  const [descDraft, setDescDraft] = useState(property.description ?? "");
  useEffect(() => setDescDraft(property.description ?? ""), [property.description]);

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

  const setColor = (option: string, color: KbPropertyColor | null) => {
    const next: Partial<Record<string, KbPropertyColor>> = {
      ...(optionColors ?? {}),
    };
    if (color === null) delete next[option];
    else next[option] = color;
    onChangeOptionColors(Object.keys(next).length > 0 ? next : undefined);
  };

  const removeOption = (option: string) => {
    onRemoveOption(option);
  };

  const renameOption = (from: string, to: string) => {
    const v = to.trim();
    if (!v || v === from) return;
    if (options.includes(v)) {
      toast.warning("Такая опция уже есть");
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
      toast.warning("Такая опция уже есть");
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
      ? property.unit.kind === "currency"
        ? property.unit.code
        : property.unit.kind === "mass" || property.unit.kind === "volume"
          ? property.unit.code
          : property.unit.kind === "piece"
            ? "шт."
            : "—"
      : "—";

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
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
        className="w-[300px] p-0 rounded-[12px]"
      >
        {/* ── a) Header: icon + name input + desc toggle ───────────────── */}
        <div className="flex items-center gap-2 p-2 border-b border-border">
          <PropertyIconButton
            property={property}
            canEdit={canEdit}
            onChangeIcon={onChangeIcon}
          />
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
            className="flex-1 h-8 rounded-md border border-input bg-transparent
                       px-2 text-[13px] font-medium outline-none
                       focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
          <button
            type="button"
            aria-label="Описание свойства"
            onClick={() => setDescOpen((v) => !v)}
            className={cn(
              "size-7 inline-flex items-center justify-center rounded-md transition-colors",
              descOpen
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <KB_PROPERTY_UI_ICONS.description className="size-3.5" />
          </button>
        </div>

        {/* ── b) Description input (conditional) ──────────────────────── */}
        {descOpen && (
          <div className="p-2 border-b border-border">
            <input
              autoFocus
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              onBlur={() => {
                onChangeDescription(descDraft);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onChangeDescription(e.currentTarget.value);
                  setDescOpen(false);
                }
                if (e.key === "Escape") {
                  setDescDraft(property.description ?? "");
                  setDescOpen(false);
                }
              }}
              placeholder="Описание свойства"
              aria-label="Описание свойства"
              className="h-8 w-full rounded-md border border-input bg-transparent
                         px-2 text-[13px] outline-none
                         focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </div>
        )}

        {/* ── c) Type row ──────────────────────────────────────────────── */}
        <div className="flex items-center justify-between p-2 border-b border-border text-[13px]">
          <span className="flex items-center gap-2 text-muted-foreground">
            <KB_PROPERTY_UI_ICONS.changeType className="size-3.5" />
            Тип
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-input
                           bg-transparent px-2 h-7 text-[13px] hover:bg-accent transition-colors"
              >
                {TYPE_LABELS[property.type]}
                <ChevronDown className="size-3 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[160px]">
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
                      <span className="ml-auto text-[11px] text-muted-foreground/60">
                        текущий
                      </span>
                    )}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* ── d) Per-type params ───────────────────────────────────────── */}

        {/* select / multi-select: options list */}
        {(property.type === "select" || property.type === "multi-select") && (
          <div className="p-2 border-b border-border">
            <div className="px-1 pb-1 text-[12px] text-muted-foreground/70">
              Опции
            </div>
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
                      onRename={(to) => renameOption(o, to)}
                      onRemove={() => removeOption(o)}
                      onSetColor={(c) => setColor(o, c)}
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
                placeholder="Новая опция"
                className="mt-1 h-8 w-full rounded-md bg-transparent px-2 text-[13px]
                           border border-input outline-none
                           focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5
                           text-[13px] font-medium text-brand hover:bg-brand/10 transition-colors"
              >
                <Plus className="size-3.5" />
                Добавить опцию
              </button>
            )}
          </div>
        )}

        {/* number */}
        {property.type === "number" && (
          <>
            {/* Вид: Число | Звёзды | Слайдер */}
            <div className="p-2 border-b border-border">
              <div className="pb-1.5 text-[12px] text-muted-foreground/70">
                Вид
              </div>
              <SegmentedControl
                options={[
                  { value: "number", label: "Число" },
                  { value: "stars", label: "Звёзды" },
                  { value: "slider", label: "Слайдер" },
                ]}
                value={numberView}
                onChange={(v) =>
                  onChangeNumberView(v as "number" | "stars" | "slider")
                }
              />
            </div>

            {numberView === "number" && (
              <>
                {/* Единица измерения */}
                <div className="flex items-center justify-between p-2 border-b border-border text-[13px]">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <KB_PROPERTY_UI_ICONS.unit className="size-3.5" />
                    Единица измерения
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-md border border-input
                                   bg-transparent px-2 h-7 text-[13px] hover:bg-accent transition-colors"
                      >
                        {unitLabel}
                        <ChevronDown className="size-3 text-muted-foreground" />
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
                </div>

                {/* Округление */}
                <div className="p-2 border-b border-border">
                  <div className="pb-1.5 text-[12px] text-muted-foreground/70">
                    Округление
                  </div>
                  <SegmentedControl
                    options={[
                      { value: "auto", label: "Авто" },
                      { value: "0", label: "Целое" },
                      { value: "1", label: "1" },
                      { value: "2", label: "2" },
                      { value: "3", label: "3" },
                    ]}
                    value={
                      property.decimals === undefined
                        ? "auto"
                        : String(property.decimals)
                    }
                    onChange={(v) => {
                      if (v === "auto") onChangeNumberDecimals(undefined);
                      else onChangeNumberDecimals(Number(v));
                    }}
                  />
                </div>
              </>
            )}

            {(numberView === "stars" || numberView === "slider") && (
              <div className="p-2 border-b border-border">
                <div className="pb-1.5 text-[12px] text-muted-foreground/70">
                  Шкала
                </div>
                <SegmentedControl
                  options={[
                    { value: "3", label: "3" },
                    { value: "5", label: "5" },
                    { value: "10", label: "10" },
                  ]}
                  value={String(
                    property.type === "number" ? (property.max ?? 5) : 5,
                  )}
                  onChange={(v) => onChangeRatingScale(Number(v))}
                />
              </div>
            )}
          </>
        )}

        {/* checkbox: Вид (Чекбокс | Триггер) */}
        {property.type === "checkbox" && (
          <div className="p-2 border-b border-border">
            <div className="pb-1.5 text-[12px] text-muted-foreground/70">
              Вид
            </div>
            <SegmentedControl
              options={[
                { value: "checkbox", label: "Чекбокс" },
                { value: "switch", label: "Триггер" },
              ]}
              value={property.displayVariant ?? "checkbox"}
              onChange={(v) =>
                onChangeDisplayVariant(v === "checkbox" ? undefined : "switch")
              }
            />
          </div>
        )}

        {/* rating: Вид (Звёзды | Слайдер) + Шкала */}
        {property.type === "rating" && (
          <>
            <div className="p-2 border-b border-border">
              <div className="pb-1.5 text-[12px] text-muted-foreground/70">
                Вид
              </div>
              <SegmentedControl
                options={[
                  { value: "stars", label: "Звёзды" },
                  { value: "slider", label: "Слайдер" },
                ]}
                value={property.displayVariant ?? "stars"}
                onChange={(v) =>
                  onChangeDisplayVariant(v === "stars" ? undefined : "slider")
                }
              />
            </div>
            <div className="p-2 border-b border-border">
              <div className="pb-1.5 text-[12px] text-muted-foreground/70">
                Шкала
              </div>
              <SegmentedControl
                options={[
                  { value: "3", label: "3" },
                  { value: "5", label: "5" },
                  { value: "10", label: "10" },
                ]}
                value={String(property.max ?? 5)}
                onChange={(v) => onChangeRatingScale(Number(v))}
              />
            </div>
          </>
        )}

        {/* text: Свернуть toggle */}
        {property.type === "text" && (
          <div className="flex items-center justify-between p-2 border-b border-border text-[13px]">
            <span className="text-muted-foreground">Свернуть</span>
            <Switch
              checked={property.collapsed === true}
              onCheckedChange={() => onToggleCollapse()}
            />
          </div>
        )}

        {/* url: Сокращать ссылку toggle */}
        {property.type === "url" && (
          <div className="flex items-center justify-between p-2 border-b border-border text-[13px]">
            <span className="text-muted-foreground">Сокращать ссылку</span>
            <Switch
              checked={property.urlCollapsed === true}
              onCheckedChange={() => onToggleCollapse()}
            />
          </div>
        )}

        {/* date: no extra block */}

        {/* ── e) Footer ───────────────────────────────────────────────── */}
        <div className="border-t border-border p-1.5">
          <button
            type="button"
            onClick={onDuplicate}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5
                       text-[13px] hover:bg-accent transition-colors"
          >
            <KB_PROPERTY_UI_ICONS.duplicate className="size-3.5 text-muted-foreground" />
            Дублировать свойство
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5
                       text-[13px] text-destructive hover:bg-destructive/10 transition-colors"
          >
            <KB_PROPERTY_UI_ICONS.delete className="size-3.5" />
            Удалить свойство
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** @deprecated Use PropertyEditorPopover instead. Kept for backwards compatibility. */
export { PropertyEditorPopover as OptionEditorPopover };

// ── Segmented control ──────────────────────────────────────────────────────
function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-1">
      {options.map((opt) => {
        const isCurrent = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              if (!isCurrent) onChange(opt.value);
            }}
            className={cn(
              "h-7 flex-1 rounded-md px-2.5 text-[13px] transition-colors",
              isCurrent
                ? "bg-secondary text-foreground font-medium"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ── OptionRow ──────────────────────────────────────────────────────────────
function OptionRow({
  option,
  color,
  onRename,
  onRemove,
  onSetColor,
}: {
  option: string;
  color?: KbPropertyColor;
  onRename: (to: string) => void;
  onRemove: () => void;
  onSetColor: (c: KbPropertyColor | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: option });
  const [name, setName] = useState(option);
  useEffect(() => setName(option), [option]);

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: DndCSS.Transform.toString(transform),
        transition,
      }}
      className="group/opt flex items-center gap-1.5 rounded-md px-1 py-1 hover:bg-accent/60"
    >
      <button
        type="button"
        aria-label="Перетащить опцию"
        className="size-5 inline-flex items-center justify-center text-muted-foreground/40
                   cursor-grab active:cursor-grabbing hover:text-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5" />
      </button>
      <OptionColorButton
        color={color}
        onSetColor={onSetColor}
        optionName={option}
        onRemove={onRemove}
      />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          onRename(name);
          setName(option);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setName(option);
            e.currentTarget.blur();
          }
        }}
        className="flex-1 min-w-0 bg-transparent text-[13px] outline-none"
        aria-label={`Опция ${option}`}
      />
      <button
        type="button"
        aria-label={`Удалить опцию «${option}»`}
        onClick={onRemove}
        className="size-5 inline-flex items-center justify-center rounded
                   text-muted-foreground/40 hover:text-destructive transition-colors"
      >
        <X className="size-3.5" />
      </button>
    </li>
  );
}

/** Цветовая точка опции → grid-поповер (sheerly.pen → mzhv4). */
function OptionColorButton({
  color,
  onSetColor,
  optionName,
  onRemove,
}: {
  color?: KbPropertyColor;
  onSetColor: (c: KbPropertyColor | null) => void;
  optionName: string;
  onRemove: () => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Цвет опции «${optionName}»`}
          className={cn(
            "size-3 shrink-0 rounded-full",
            paletteDot(color ?? "default"),
          )}
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[260px] p-3 rounded-[10px]"
      >
        <div className="flex items-center justify-between pb-2">
          <span className="inline-flex items-center gap-1.5 text-[13px] font-medium">
            <span
              className={cn(
                "size-2.5 rounded-full",
                paletteDot(color ?? "default"),
              )}
            />
            {optionName}
          </span>
          <button
            type="button"
            onClick={onRemove}
            className="text-[12px] font-medium text-destructive hover:underline"
          >
            Удалить опцию
          </button>
        </div>
        <div className="text-[12px] text-muted-foreground/70 pb-1.5">Цвет</div>
        <div className="grid grid-cols-5 gap-1.5">
          {PALETTE_GRID.map((c) => {
            const isCurrent = (color ?? "default") === c.name;
            return (
              <button
                key={c.name}
                type="button"
                onClick={() => onSetColor(c.name === "default" ? null : c.name)}
                className="flex flex-col items-center gap-1"
                aria-label={c.label}
              >
                <span
                  className={cn(
                    "relative size-9 rounded-lg inline-flex items-center justify-center",
                    c.name === "default"
                      ? "border border-border bg-background"
                      : paletteDot(c.name),
                  )}
                >
                  {isCurrent && (
                    <Check
                      className={cn(
                        "size-4",
                        c.name === "default"
                          ? "text-foreground"
                          : "text-white",
                      )}
                    />
                  )}
                </span>
                <span className="text-[10px] text-muted-foreground leading-none">
                  {c.label}
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
