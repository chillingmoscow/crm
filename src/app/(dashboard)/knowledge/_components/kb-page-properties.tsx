"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { nanoid } from "nanoid";
import {
  Plus,
  Trash2,
  MoreHorizontal,
  Type as TypeIcon,
  Hash,
  Calendar as CalendarIcon,
  CheckSquare,
  ChevronDown,
  Copy,
  Replace,
  X,
  GripVertical,
  Palette,
  Check,
  ListChecks,
} from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  KB_ICONS,
  KB_ICON_COLORS,
  colorTextClass,
  type KbIconColor,
} from "@/lib/knowledge/icons";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import {
  saveKbPageProperties,
  saveKbTemplateProperties,
} from "@/lib/knowledge/properties";
import type {
  KbProperty,
  KbPropertyColor,
  KbPropertyType,
} from "@/types/knowledge";

interface KbPagePropertiesProps {
  /** Идентификатор страницы или шаблона. */
  targetId: string;
  /** Куда сохраняем — page (kb_pages) или template (kb_templates). */
  mode: "page" | "template";
  initialProperties: KbProperty[];
  canEdit: boolean;
}

const TYPE_ICONS: Record<KbPropertyType, React.ComponentType<{ className?: string }>> = {
  text: TypeIcon,
  number: Hash,
  date: CalendarIcon,
  checkbox: CheckSquare,
  select: ChevronDown,
  "multi-select": ListChecks,
};

const TYPE_LABELS: Record<KbPropertyType, string> = {
  text: "Текст",
  number: "Число",
  date: "Дата",
  checkbox: "Чекбокс",
  select: "Выбор",
  "multi-select": "Мультивыбор",
};

// Notion-style пастельная палитра. Хранятся имена в jsonb (см.
// `KbPropertyColor`); UI мап'ит имя → tailwind-class-pair. Tailwind JIT
// видит class'ы инлайн, не нужен safelist.
const OPTION_COLOR_CLASSES: Record<KbPropertyColor, string> = {
  stone:
    "bg-stone-100 text-stone-700 dark:bg-stone-800/60 dark:text-stone-200",
  amber:
    "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200",
  orange:
    "bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-200",
  yellow:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/50 dark:text-yellow-200",
  green:
    "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-200",
  teal: "bg-teal-100 text-teal-800 dark:bg-teal-950/50 dark:text-teal-200",
  sky: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200",
  indigo:
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200",
  purple:
    "bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-200",
  pink: "bg-pink-100 text-pink-800 dark:bg-pink-950/50 dark:text-pink-200",
};

const OPTION_COLOR_NAMES = Object.keys(
  OPTION_COLOR_CLASSES,
) as KbPropertyColor[];

const OPTION_COLOR_LABELS: Record<KbPropertyColor, string> = {
  stone: "Серый",
  amber: "Янтарный",
  orange: "Оранжевый",
  yellow: "Жёлтый",
  green: "Зелёный",
  teal: "Бирюзовый",
  sky: "Голубой",
  indigo: "Индиго",
  purple: "Фиолетовый",
  pink: "Розовый",
};

// Дефолтный цвет для опции — детерминированный hash-FNV. Стабилен
// между сессиями: «Высокий приоритет» всегда красится одинаково везде,
// где появляется (если юзер не override'ил вручную).
function colorNameForOption(value: string): KbPropertyColor {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return OPTION_COLOR_NAMES[Math.abs(h) % OPTION_COLOR_NAMES.length];
}

/** Resolve финального цвета: explicit override > hash-fallback. */
function resolveOptionColor(
  value: string,
  explicit?: KbPropertyColor,
): string {
  return OPTION_COLOR_CLASSES[explicit ?? colorNameForOption(value)];
}

/** Цветной chip для select-option. `explicit` — если юзер вручную
 *  выбрал цвет в палитре; иначе fallback на hash-FNV. */
function OptionChip({
  value,
  explicit,
  className,
}: {
  value: string;
  explicit?: KbPropertyColor;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[12.5px] font-medium leading-tight max-w-full",
        resolveOptionColor(value, explicit),
        className,
      )}
    >
      <span className="truncate">{value}</span>
    </span>
  );
}

const SAVE_DEBOUNCE_MS = 1500;

/** Создаёт пустое property указанного типа с дефолтным `name`.
 *  Default name = label типа («Текст» / «Число» / …) — без префикса
 *  «Свойство»; юзер сразу переименовывает в осмысленное. */
function makeProperty(type: KbPropertyType, name?: string): KbProperty {
  const id = nanoid(8);
  const baseName = name ?? TYPE_LABELS[type];
  switch (type) {
    case "text":
      return { id, name: baseName, type: "text", value: "" };
    case "number":
      return { id, name: baseName, type: "number", value: null };
    case "date":
      return { id, name: baseName, type: "date", value: null };
    case "checkbox":
      return { id, name: baseName, type: "checkbox", value: false };
    case "select":
      return { id, name: baseName, type: "select", value: null, options: [] };
    case "multi-select":
      return {
        id,
        name: baseName,
        type: "multi-select",
        value: [],
        options: [],
      };
  }
}

export function KbPageProperties({
  targetId,
  mode,
  initialProperties,
  canEdit,
}: KbPagePropertiesProps) {
  const [properties, setProperties] = useState<KbProperty[]>(initialProperties);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>(JSON.stringify(initialProperties));

  // Debounced save: каждое изменение reset'ит таймер на 1.5s.
  const scheduleSave = (next: KbProperty[]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void flushSave(next);
    }, SAVE_DEBOUNCE_MS);
  };

  const flushSave = async (next: KbProperty[]) => {
    const serialized = JSON.stringify(next);
    if (serialized === lastSavedRef.current) return;
    const action =
      mode === "page" ? saveKbPageProperties : saveKbTemplateProperties;
    const payload =
      mode === "page"
        ? { pageId: targetId, properties: next }
        : { templateId: targetId, properties: next };
    const { error } = await action(payload as never);
    if (error) {
      toast.error(`Не удалось сохранить свойства: ${error}`);
      return;
    }
    lastSavedRef.current = serialized;
  };

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const updateProperty = (id: string, patch: Partial<KbProperty>) => {
    setProperties((prev) => {
      const next = prev.map((p) =>
        p.id === id ? ({ ...p, ...patch } as KbProperty) : p,
      );
      scheduleSave(next);
      return next;
    });
  };

  const addProperty = (type: KbPropertyType) => {
    setProperties((prev) => {
      const next = [...prev, makeProperty(type)];
      scheduleSave(next);
      return next;
    });
  };

  const removeProperty = (id: string) => {
    setProperties((prev) => {
      const next = prev.filter((p) => p.id !== id);
      scheduleSave(next);
      return next;
    });
  };

  // Дублирует property: новый id + " (копия)" к имени, value/options/colors
  // копируются 1-в-1. Inserted сразу после оригинала.
  const duplicateProperty = (id: string) => {
    setProperties((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      if (idx === -1) return prev;
      const orig = prev[idx];
      const copy = { ...orig, id: nanoid(8), name: `${orig.name} (копия)` };
      const next = [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
      scheduleSave(next);
      return next;
    });
  };

  // Меняет тип property: id и name сохраняются, value сбрасывается на
  // дефолт нового типа. Options/optionColors сохраняются при переходе
  // select ↔ multi-select (shape совместим). Icon override сохраняется
  // всегда — он визуальный, не привязан к типу.
  const changePropertyType = (id: string, newType: KbPropertyType) => {
    setProperties((prev) => {
      const next = prev.map((p) => {
        if (p.id !== id) return p;
        if (p.type === newType) return p;
        const fresh = makeProperty(newType, p.name);
        // Перенос icon override из старого property.
        const carriedIcon = {
          ...(p.icon !== undefined ? { icon: p.icon } : {}),
          ...(p.iconColor !== undefined ? { iconColor: p.iconColor } : {}),
        };
        // Перенос options/optionColors при select ↔ multi-select.
        const isCurrentOption =
          p.type === "select" || p.type === "multi-select";
        const isNewOption =
          newType === "select" || newType === "multi-select";
        if (isCurrentOption && isNewOption) {
          const optionProp = p as
            | Extract<KbProperty, { type: "select" }>
            | Extract<KbProperty, { type: "multi-select" }>;
          // Конвертируем value: select string|null ↔ multi-select string[].
          let nextValue: string | null | string[];
          if (newType === "multi-select") {
            // string|null → string[] (пустой если null).
            const cur = optionProp.value;
            nextValue = typeof cur === "string" && cur ? [cur] : [];
          } else {
            // string[] → string|null (берём первый элемент или null).
            const cur = optionProp.value as string[];
            nextValue = cur[0] ?? null;
          }
          return {
            ...fresh,
            id: p.id,
            ...carriedIcon,
            value: nextValue,
            options: optionProp.options,
            ...(optionProp.optionColors
              ? { optionColors: optionProp.optionColors }
              : {}),
          } as KbProperty;
        }
        return { ...fresh, id: p.id, ...carriedIcon } as KbProperty;
      });
      scheduleSave(next);
      return next;
    });
  };

  // Меняет icon override property. value=null/undefined для обоих
  // полей = «без override» (рендерим default TYPE_ICONS[type]).
  const changePropertyIcon = (
    id: string,
    icon: string | null,
    iconColor: string | null,
  ) => {
    setProperties((prev) => {
      const next = prev.map((p) => {
        if (p.id !== id) return p;
        const updated = { ...p } as KbProperty & {
          icon?: string;
          iconColor?: string;
        };
        if (icon === null) delete updated.icon;
        else updated.icon = icon;
        if (iconColor === null) delete updated.iconColor;
        else updated.iconColor = iconColor;
        return updated as KbProperty;
      });
      scheduleSave(next);
      return next;
    });
  };

  // DnD reorder: arrayMove + scheduleSave. distance=4 — чтобы scroll
  // на мобиле / случайный микро-drag не запускали реорганизацию.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const sortableIds = useMemo(() => properties.map((p) => p.id), [properties]);
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setProperties((prev) => {
      const fromIdx = prev.findIndex((p) => p.id === active.id);
      const toIdx = prev.findIndex((p) => p.id === over.id);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = arrayMove(prev, fromIdx, toIdx);
      scheduleSave(next);
      return next;
    });
  };

  // Не рендерим пустую секцию для read-only страниц без свойств — иначе
  // на каждой странице висит пустой блок «Свойства».
  if (!canEdit && properties.length === 0) return null;

  return (
    <section
      aria-label="Свойства страницы"
      className="flex flex-col gap-1.5 px-2 -ml-2"
    >
      {properties.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={sortableIds}
            strategy={verticalListSortingStrategy}
          >
            <ul className="flex flex-col gap-0.5">
              {properties.map((prop) => (
                <PropertyRow
                  key={prop.id}
                  property={prop}
                  canEdit={canEdit}
                  onRename={(name) => updateProperty(prop.id, { name })}
                  onChangeValue={(value) =>
                    updateProperty(prop.id, { value } as Partial<KbProperty>)
                  }
                  onChangeOptions={(options) => {
                    // При удалении опций select / multi-select — чистим
                    // соответствующие записи из optionColors (висячие
                    // колоры безвредны, но платят лишние байты при
                    // сохранении). Plus для multi-select убираем
                    // удалённые опции из value-массива.
                    const isOptionType =
                      prop.type === "select" ||
                      prop.type === "multi-select";
                    if (isOptionType) {
                      const currColors = (
                        prop as
                          | Extract<KbProperty, { type: "select" }>
                          | Extract<KbProperty, { type: "multi-select" }>
                      ).optionColors;
                      let nextColors:
                        | Partial<Record<string, KbPropertyColor>>
                        | undefined = currColors;
                      const allowed = new Set(options);
                      if (currColors) {
                        const filtered = Object.fromEntries(
                          Object.entries(currColors).filter(([k]) =>
                            allowed.has(k),
                          ),
                        );
                        nextColors =
                          Object.keys(filtered).length > 0
                            ? filtered
                            : undefined;
                      }
                      // Для multi-select также чистим value от удалённых.
                      const patch: Partial<KbProperty> = {
                        options,
                        optionColors: nextColors,
                      } as Partial<KbProperty>;
                      if (prop.type === "multi-select") {
                        const filteredValue = (prop.value as string[]).filter(
                          (v) => allowed.has(v),
                        );
                        (patch as { value?: string[] }).value = filteredValue;
                      }
                      updateProperty(prop.id, patch);
                    } else {
                      updateProperty(prop.id, { options } as Partial<KbProperty>);
                    }
                  }}
                  onChangeOptionColors={(optionColors) =>
                    updateProperty(prop.id, {
                      optionColors,
                    } as Partial<KbProperty>)
                  }
                  onChangeIcon={(icon, iconColor) =>
                    changePropertyIcon(prop.id, icon, iconColor)
                  }
                  onRemove={() => removeProperty(prop.id)}
                  onDuplicate={() => duplicateProperty(prop.id)}
                  onChangeType={(t) => changePropertyType(prop.id, t)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      {canEdit && (
        <div className="flex items-center gap-2 pt-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <Plus className="size-3.5" /> Добавить свойство
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[160px]">
              {(Object.keys(TYPE_LABELS) as KbPropertyType[]).map((t) => {
                const Icon = TYPE_ICONS[t];
                return (
                  <DropdownMenuItem key={t} onSelect={() => addProperty(t)}>
                    <Icon className="size-3.5 text-muted-foreground" />
                    {TYPE_LABELS[t]}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </section>
  );
}

interface PropertyRowProps {
  property: KbProperty;
  canEdit: boolean;
  onRename: (name: string) => void;
  onChangeValue: (value: KbProperty["value"]) => void;
  onChangeOptions: (options: string[]) => void;
  onChangeOptionColors: (
    optionColors: Partial<Record<string, KbPropertyColor>> | undefined,
  ) => void;
  onChangeIcon: (icon: string | null, iconColor: string | null) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onChangeType: (type: KbPropertyType) => void;
}

function PropertyRow({
  property,
  canEdit,
  onRename,
  onChangeValue,
  onChangeOptions,
  onChangeOptionColors,
  onChangeIcon,
  onRemove,
  onDuplicate,
  onChangeType,
}: PropertyRowProps) {
  const [name, setName] = useState(property.name);
  // Sync external rename (e.g., другой клиент) на случай контролируемой
  // mutation сверху.
  useEffect(() => setName(property.name), [property.name]);

  // Sortable: ref + transforms + drag-listeners. Listeners прицепляем
  // ТОЛЬКО к grip-handle (не к <li>) — иначе клик/select на name/value
  // триггерил бы drag и ломал inline-edit.
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: property.id, disabled: !canEdit });

  const dragStyle: CSSProperties = {
    transform: DndCSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  };

  return (
    <li
      ref={setNodeRef}
      style={dragStyle}
      className={cn(
        "group/row flex items-center gap-1.5 min-h-[28px] -mx-2 px-2 py-0.5 rounded-md",
        "hover:bg-muted/40 transition-colors",
        isDragging && "bg-muted/60 shadow-sm",
      )}
    >
      {canEdit ? (
        <button
          type="button"
          aria-label="Перетащить свойство"
          className="size-5 -ml-1 flex items-center justify-center text-muted-foreground/40
                     cursor-grab active:cursor-grabbing
                     opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100
                     hover:text-foreground transition-opacity"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5" />
        </button>
      ) : (
        // Read-only: тот же spacer что и у grip'а, чтобы layout не
        // съезжал при переключении canEdit.
        <span className="size-5 -ml-1 shrink-0" aria-hidden="true" />
      )}
      <PropertyIconButton
        property={property}
        canEdit={canEdit}
        onChangeIcon={onChangeIcon}
      />
      {canEdit ? (
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const trimmed = name.trim();
            if (trimmed && trimmed !== property.name) onRename(trimmed);
            else setName(property.name);
          }}
          className="w-[140px] shrink-0 bg-transparent text-[13px] text-muted-foreground outline-none focus:text-foreground"
          aria-label="Имя свойства"
        />
      ) : (
        <span className="w-[140px] shrink-0 text-[13px] text-muted-foreground">
          {property.name}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <PropertyValueControl
          property={property}
          canEdit={canEdit}
          onChangeValue={onChangeValue}
          onChangeOptions={onChangeOptions}
          onChangeOptionColors={onChangeOptionColors}
        />
      </div>
      {canEdit && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 opacity-0 group-hover/row:opacity-100 focus:opacity-100"
              aria-label="Действия со свойством"
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[180px]">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Replace className="size-3.5 text-muted-foreground" />
                Изменить тип
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-[160px]">
                {(Object.keys(TYPE_LABELS) as KbPropertyType[]).map((t) => {
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
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={onDuplicate}>
              <Copy className="size-3.5 text-muted-foreground" />
              Дублировать
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onRemove}>
              <Trash2 className="size-3.5 text-destructive" />
              <span className="text-destructive">Удалить</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

function PropertyValueControl({
  property,
  canEdit,
  onChangeValue,
  onChangeOptions,
  onChangeOptionColors,
}: {
  property: KbProperty;
  canEdit: boolean;
  onChangeValue: (value: KbProperty["value"]) => void;
  onChangeOptions: (options: string[]) => void;
  onChangeOptionColors: (
    optionColors: Partial<Record<string, KbPropertyColor>> | undefined,
  ) => void;
}) {
  switch (property.type) {
    case "text":
      return canEdit ? (
        <TextValueControl
          value={property.value}
          onChange={onChangeValue}
        />
      ) : (
        <span className="text-[13px] whitespace-pre-wrap break-words">
          {property.value || "—"}
        </span>
      );
    case "number":
      return canEdit ? (
        <Input
          type="number"
          inputMode="numeric"
          value={property.value ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onChangeValue(v === "" ? null : Number(v));
          }}
          placeholder="—"
          className="h-7 text-[13px] tabular-nums border-transparent bg-transparent px-0 hover:border-input focus:border-input"
        />
      ) : (
        <span className="text-[13px] tabular-nums">
          {property.value ?? "—"}
        </span>
      );
    case "date":
      return canEdit ? (
        <Input
          type="date"
          value={property.value ?? ""}
          onChange={(e) => onChangeValue(e.target.value || null)}
          className="h-7 text-[13px] tabular-nums border-transparent bg-transparent px-0 hover:border-input focus:border-input"
        />
      ) : (
        <span className="text-[13px] tabular-nums">
          {property.value ?? "—"}
        </span>
      );
    case "checkbox":
      return (
        <Checkbox
          checked={property.value}
          onCheckedChange={(v) => onChangeValue(v === true)}
          disabled={!canEdit}
          aria-label="Значение"
        />
      );
    case "select":
      return <SelectControl
        property={property}
        canEdit={canEdit}
        onChangeValue={onChangeValue}
        onChangeOptions={onChangeOptions}
        onChangeOptionColors={onChangeOptionColors}
      />;
    case "multi-select":
      return <MultiSelectControl
        property={property}
        canEdit={canEdit}
        onChangeValue={onChangeValue}
        onChangeOptions={onChangeOptions}
        onChangeOptionColors={onChangeOptionColors}
      />;
  }
}

/** Текстовое значение property: textarea, растущая по содержимому. */
function TextValueControl({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow: на каждом изменении сбрасываем height в auto и выставляем
  // в scrollHeight. Сброс нужен иначе scrollHeight «зависает» на
  // максимальной достигнутой высоте и не сжимается обратно при удалении.
  const resize = () => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  };

  useEffect(() => {
    resize();
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onInput={resize}
      placeholder="—"
      className="w-full bg-transparent text-[13px] outline-none resize-none overflow-hidden
                 leading-snug placeholder:text-muted-foreground/50
                 border border-transparent rounded px-1 -mx-1
                 hover:border-input focus:border-input transition-colors"
    />
  );
}

function SelectControl({
  property,
  canEdit,
  onChangeValue,
  onChangeOptions,
  onChangeOptionColors,
}: {
  property: Extract<KbProperty, { type: "select" }>;
  canEdit: boolean;
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
      {property.options.length > 0 && (
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
                    {OPTION_COLOR_NAMES.map((c) => {
                      const isCurrent = property.optionColors?.[o] === c;
                      return (
                        <DropdownMenuItem
                          key={c}
                          onSelect={() => setOptionColor(o, c)}
                        >
                          <span
                            className={cn(
                              "size-3.5 shrink-0 rounded-full",
                              OPTION_COLOR_CLASSES[c],
                            )}
                          />
                          {OPTION_COLOR_LABELS[c]}
                          {isCurrent && (
                            <Check className="ml-auto size-3.5" />
                          )}
                        </DropdownMenuItem>
                      );
                    })}
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
      {(adding || property.options.length === 0) && (
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

/** Inline icon-trigger перед именем property. По дефолту показывает
 *  TYPE_ICONS[type] (default behavior до Stage 2). Если у property
 *  есть `icon` override — рендерится оно (Lucide-name из KB_ICONS) с
 *  опциональным `iconColor` тинтом. Click открывает Popover-picker:
 *  10 цветов + grid KB_ICONS + «По умолчанию» (сбросить override).
 *
 *  Read-only режим (`!canEdit`): trigger некликабельный, выглядит как
 *  обычная иконка без интерактивности.
 *
 *  Намеренно НЕ переиспользуем `<KbIconPicker>` напрямую: его дефолтный
 *  fallback (FileText из KbPageIcon при `icon=null`) не подходит для
 *  property — мы хотим показать TYPE_ICONS[type] до override'а. */
function PropertyIconButton({
  property,
  canEdit,
  onChangeIcon,
}: {
  property: KbProperty;
  canEdit: boolean;
  onChangeIcon: (icon: string | null, iconColor: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pendingColor, setPendingColor] = useState<KbIconColor | null>(
    (property.iconColor as KbIconColor | null) ?? null,
  );

  // Sync pendingColor при открытии — на случай rename'а извне.
  useEffect(() => {
    if (open) {
      setPendingColor((property.iconColor as KbIconColor | null) ?? null);
    }
  }, [open, property.iconColor]);

  const TypeFallback = TYPE_ICONS[property.type];
  const hasOverride = Boolean(property.icon);

  // Render-helper: если override есть — KbPageIcon (рендерит из KB_ICONS
  // с тинтом). Иначе TYPE_ICONS[type] (Lucide дефолт).
  const renderIcon = (size: number) =>
    hasOverride ? (
      <KbPageIcon
        icon={property.icon ?? null}
        color={property.iconColor ?? null}
        size={size}
      />
    ) : (
      <TypeFallback className="size-3.5 text-muted-foreground/70" />
    );

  if (!canEdit) {
    return <span className="size-4 shrink-0 inline-flex items-center justify-center">{renderIcon(14)}</span>;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Изменить иконку свойства"
          title="Иконка"
          className="size-5 shrink-0 inline-flex items-center justify-center rounded
                     hover:bg-accent transition-colors"
        >
          {renderIcon(14)}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-[320px] p-0 rounded-[10px]"
      >
        <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2 border-b">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Цвет
          </span>
          <button
            type="button"
            onClick={() => {
              setPendingColor(null);
              onChangeIcon(null, null);
              setOpen(false);
            }}
            disabled={!hasOverride && !property.iconColor}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            <X className="size-3" />
            По умолчанию
          </button>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap px-3 py-2 border-b">
          {KB_ICON_COLORS.map((c) => {
            const isActive = pendingColor === c.name;
            return (
              <button
                key={c.name}
                type="button"
                onClick={() => {
                  setPendingColor(c.name);
                  // Если icon уже set — apply сразу (preview = commit).
                  if (property.icon) {
                    onChangeIcon(property.icon, c.name);
                  }
                }}
                title={c.label}
                className={cn(
                  "size-5 rounded-full border transition-all",
                  isActive
                    ? "border-foreground/60 ring-1 ring-foreground/20"
                    : "border-border hover:border-foreground/30",
                )}
              >
                <span
                  className={cn(
                    "block size-full rounded-full",
                    colorTextClass(c.name),
                  )}
                  aria-hidden="true"
                  style={{ backgroundColor: "currentColor" }}
                />
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-9 gap-0.5 px-2 py-2 max-h-[280px] overflow-y-auto">
          {KB_ICONS.map((entry) => {
            const isCurrent = property.icon === entry.name;
            const Icon = entry.icon;
            return (
              <button
                key={entry.name}
                type="button"
                onClick={() => {
                  onChangeIcon(entry.name, pendingColor ?? null);
                  setOpen(false);
                }}
                title={entry.label}
                className={cn(
                  "size-7 rounded inline-flex items-center justify-center transition-colors",
                  isCurrent
                    ? "bg-accent text-foreground"
                    : "hover:bg-accent",
                  pendingColor && colorTextClass(pendingColor),
                )}
              >
                <Icon className="size-4" />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Multi-select value-control: chips inline (выбранные значения) +
 *  trigger для открытия dropdown'а с checkbox-списком. Полностью
 *  параллелен SelectControl, но value — string[] вместо string|null.
 *  Cleanup options/optionColors происходит выше в onChangeOptions. */
function MultiSelectControl({
  property,
  canEdit,
  onChangeValue,
  onChangeOptions,
  onChangeOptionColors,
}: {
  property: Extract<KbProperty, { type: "multi-select" }>;
  canEdit: boolean;
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
      {property.options.length > 0 && (
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
                    {OPTION_COLOR_NAMES.map((c) => {
                      const isCurrent = property.optionColors?.[o] === c;
                      return (
                        <DropdownMenuItem
                          key={c}
                          onSelect={() => setOptionColor(o, c)}
                        >
                          <span
                            className={cn(
                              "size-3.5 shrink-0 rounded-full",
                              OPTION_COLOR_CLASSES[c],
                            )}
                          />
                          {OPTION_COLOR_LABELS[c]}
                          {isCurrent && (
                            <Check className="ml-auto size-3.5" />
                          )}
                        </DropdownMenuItem>
                      );
                    })}
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
      {(adding || property.options.length === 0) && (
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
