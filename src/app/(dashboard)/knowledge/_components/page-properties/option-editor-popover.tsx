"use client";

import { useEffect, useState } from "react";
import { Check, Copy, GripVertical, Plus, Trash2, X } from "lucide-react";
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
import { PALETTE_GRID, paletteDot } from "@/lib/palette";
import type { KbPropertyColor } from "@/types/knowledge";

interface OptionEditorProps {
  /** Опциональный триггер. Если не задан — поповер контролируется
   *  через `open`/`onOpenChange` и якорится скрытым span'ом слева
   *  строки (клик по имени свойства открывает меню). */
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Имя свойства + переименование (поле сверху поповера). */
  propertyName?: string;
  onRename?: (name: string) => void;
  typeLabel: string;
  typeIcon: React.ComponentType<{ className?: string }>;
  options: string[];
  optionColors: Partial<Record<string, KbPropertyColor>> | undefined;
  /** Reorder + add only — НЕ для rename/delete (там нужна
   *  reconciliation выбранного значения, см. onRenameOption/onRemoveOption). */
  onChangeOptions: (options: string[]) => void;
  onChangeOptionColors: (
    next: Partial<Record<string, KbPropertyColor>> | undefined,
  ) => void;
  /** Переименование опции: родитель атомарно мигрирует options +
   *  optionColors + текущее value (select/multi-select). */
  onRenameOption: (from: string, to: string) => void;
  /** Удаление опции: родитель атомарно чистит options + optionColors +
   *  сбрасывает/фильтрует текущее value. */
  onRemoveOption: (option: string) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

export function OptionEditorPopover({
  trigger,
  open,
  onOpenChange,
  propertyName,
  onRename,
  typeLabel,
  typeIcon: TypeIcon,
  options,
  optionColors,
  onChangeOptions,
  onChangeOptionColors,
  onRenameOption,
  onRemoveOption,
  onDuplicate,
  onRemove,
}: OptionEditorProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [nameDraft, setNameDraft] = useState(propertyName ?? "");
  useEffect(() => setNameDraft(propertyName ?? ""), [propertyName]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const setColor = (option: string, color: KbPropertyColor | null) => {
    const next: Partial<Record<string, KbPropertyColor>> = {
      ...(optionColors ?? {}),
    };
    if (color === null) delete next[option];
    else next[option] = color;
    onChangeOptionColors(Object.keys(next).length > 0 ? next : undefined);
  };

  const removeOption = (option: string) => {
    // Атомарная reconciliation (options + optionColors + value) — в
    // родителе. Здесь не трогаем onChangeOptions, иначе выбранное
    // значение «протекает» (Codex P1).
    onRemoveOption(option);
  };

  const renameOption = (from: string, to: string) => {
    const v = to.trim();
    if (!v || v === from) return;
    if (options.includes(v)) {
      toast.warning("Такая опция уже есть");
      return;
    }
    // Родитель мигрирует options + optionColors + текущее value за один
    // patch (rename = explicit intent, не выводится из diff'а options).
    onRenameOption(from, v);
  };

  const commitAdd = () => {
    const v = draft.trim();
    if (!v) {
      setAdding(false);
      setDraft("");
      return;
    }
    if (options.includes(v)) {
      toast.warning("Такая опция уже есть");
      return;
    }
    onChangeOptions([...options, v]);
    setDraft("");
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
        className="w-[320px] p-0 rounded-[10px]"
      >
        {onRename !== undefined && (
          <div className="border-b border-border p-2">
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => {
                const t = nameDraft.trim();
                if (t && t !== propertyName) onRename(t);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const t = e.currentTarget.value.trim();
                  if (t && t !== propertyName) onRename(t);
                  e.currentTarget.blur();
                }
                if (e.key === "Escape") {
                  setNameDraft(propertyName ?? "");
                  e.currentTarget.blur();
                }
              }}
              placeholder="Имя свойства"
              aria-label="Имя свойства"
              className="h-8 w-full rounded-md border border-input bg-transparent
                         px-2 text-[13px] font-medium outline-none
                         focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </div>
        )}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
          <TypeIcon className="size-4 text-muted-foreground" />
          <span className="text-[13px] font-semibold">{typeLabel}</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <span className="text-[12px] text-muted-foreground">Тип:</span>
          <span className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-[12px] text-muted-foreground">
            {typeLabel}
          </span>
        </div>
        <div className="px-2 py-2">
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
        <div className="border-t border-border p-1.5">
          <button
            type="button"
            onClick={onDuplicate}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5
                       text-[13px] hover:bg-accent transition-colors"
          >
            <Copy className="size-3.5 text-muted-foreground" />
            Дублировать свойство
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5
                       text-[13px] text-destructive hover:bg-destructive/10 transition-colors"
          >
            <Trash2 className="size-3.5" />
            Удалить свойство
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

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
      <OptionColorButton color={color} onSetColor={onSetColor} optionName={option} onRemove={onRemove} />
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
                onClick={() =>
                  onSetColor(c.name === "default" ? null : c.name)
                }
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
