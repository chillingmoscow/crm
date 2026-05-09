"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
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
  Link as LinkIcon,
  Minimize2,
  Maximize2,
  Ruler,
  Star,
  Pencil,
  ToggleRight,
  Database,
} from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
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
import { Switch } from "@/components/ui/switch";
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
  PALETTE_COLORS,
  paletteChip,
  paletteDot,
} from "@/lib/palette";
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { KbIconPickerBody } from "@/components/knowledge/kb-icon-picker";
import {
  formatWithUnit,
  unitSuffix,
  UNIT_CURRENCIES,
  MASS_UNITS,
  VOLUME_UNITS,
  PIECE_UNIT,
  type Unit,
} from "@/lib/units";
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
  /** В preview-режимах можно скрыть нижний CTA-блок полностью. */
  showAddButton?: boolean;
}

const TYPE_ICONS: Record<KbPropertyType, ComponentType<{ className?: string }>> = {
  text: TypeIcon,
  number: Hash,
  date: CalendarIcon,
  checkbox: CheckSquare,
  select: ChevronDown,
  "multi-select": ListChecks,
  url: LinkIcon,
  rating: Star,
};

const TYPE_LABELS: Record<KbPropertyType, string> = {
  text: "Текст",
  number: "Число",
  date: "Дата",
  checkbox: "Чекбокс",
  select: "Выбор",
  "multi-select": "Мультивыбор",
  url: "Ссылка",
  rating: "Рейтинг",
};

// Палитра option-chip'ов берётся из единого 10-цветного источника
// `@/lib/palette` (Notion-style). Раньше тут жил отдельный 10-цветный
// набор (stone/amber/sky/teal/indigo + …), не совпадающий ни с
// BlockNote'ом, ни с iconColor'ами; миграция 115 + normalizePaletteColor
// переводят легаси-значения в canonical на чтении.
//
// Tailwind JIT видит class'ы внутри `paletteChip` / `paletteDot` —
// safelist не нужен.
//
// Для select-options префиксуем `default` тем же neutral-chip'ом,
// что и paletteChip(null), чтобы юзерский «По умолчанию» выбор
// читался единообразно.

// Хеш-FNV, выбирает цвет из палитры (без `default`) детерминированно
// по value: «Высокий приоритет» всегда красится одинаково везде, где
// появляется. Если юзер override'ит через picker — берём его.
const HASH_PALETTE = PALETTE_COLORS.filter((c) => c.name !== "default").map(
  (c) => c.name,
) as Exclude<KbPropertyColor, "default">[];

function colorNameForOption(value: string): KbPropertyColor {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return HASH_PALETTE[Math.abs(h) % HASH_PALETTE.length];
}

/** Resolve финального цвета: explicit override > hash-fallback. */
function resolveOptionColor(
  value: string,
  explicit?: KbPropertyColor,
): string {
  // Если у explicit `default` — возвращаем нейтральный chip; для null/
  // undefined падаем в hash. paletteChip сам нормализует legacy-имена
  // (stone/amber/sky/teal/indigo) до миграции 115.
  return paletteChip(explicit ?? colorNameForOption(value));
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
    case "url":
      return { id, name: baseName, type: "url", value: "" };
    case "rating":
      return { id, name: baseName, type: "rating", value: null };
  }
}

function getCollectionScope(property: KbProperty) {
  return property.scope?.type === "collection" ? property.scope : null;
}

function isPageProperty(property: KbProperty): boolean {
  return property.scope?.type !== "collection";
}

export function KbPageProperties({
  targetId,
  mode,
  initialProperties,
  canEdit,
  showAddButton = true,
}: KbPagePropertiesProps) {
  const [properties, setProperties] = useState<KbProperty[]>(initialProperties);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>(JSON.stringify(initialProperties));
  const pageProperties = useMemo(
    () => properties.filter(isPageProperty),
    [properties],
  );
  const collectionGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        id: string;
        title: string;
        properties: KbProperty[];
      }
    >();
    for (const property of properties) {
      const scope = getCollectionScope(property);
      if (!scope) continue;
      const group = groups.get(scope.collectionId);
      if (group) {
        group.properties.push(property);
      } else {
        groups.set(scope.collectionId, {
          id: scope.collectionId,
          title: scope.collectionTitle ?? "Коллекция",
          properties: [property],
        });
      }
    }
    return Array.from(groups.values());
  }, [properties]);

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

  // Меняет единицу измерения number-property. `null` = убрать unit
  // (обратно к «без единицы»).
  const changePropertyUnit = (id: string, unit: Unit | null) => {
    setProperties((prev) => {
      const next = prev.map((p) => {
        if (p.id !== id || p.type !== "number") return p;
        const updated = { ...p } as Extract<KbProperty, { type: "number" }>;
        if (unit === null || unit.kind === "none") {
          delete updated.unit;
        } else {
          updated.unit = unit;
        }
        return updated as KbProperty;
      });
      scheduleSave(next);
      return next;
    });
  };

  // Toggle сжатого отображения. Для text меняет `collapsed` (single-line
  // truncate vs full multi-line). Для url меняет `urlCollapsed` (hide
  // `https://` префикс vs показать полностью).
  const togglePropertyCollapse = (id: string) => {
    setProperties((prev) => {
      const next = prev.map((p) => {
        if (p.id !== id) return p;
        if (p.type === "text") {
          const wasCollapsed = p.collapsed === true;
          return { ...p, collapsed: !wasCollapsed } as KbProperty;
        }
        if (p.type === "url") {
          const wasCollapsed = p.urlCollapsed === true;
          return { ...p, urlCollapsed: !wasCollapsed } as KbProperty;
        }
        return p;
      });
      scheduleSave(next);
      return next;
    });
  };

  // Меняет шкалу rating-property. По дефолту 5; допустимые 3 / 5 / 10.
  // При сужении шкалы (например 10 → 5) clamp'им value сверху.
  const changeRatingScale = (id: string, max: number) => {
    setProperties((prev) => {
      const next = prev.map((p) => {
        if (p.id !== id || p.type !== "rating") return p;
        const updated: typeof p = { ...p, max };
        if (updated.value !== null && updated.value > max) {
          updated.value = max;
        }
        return updated as KbProperty;
      });
      scheduleSave(next);
      return next;
    });
  };

  // Меняет displayVariant для checkbox / rating. Принимает variant
  // именем; при undefined — удаляем поле (= default-вариант).
  const changeDisplayVariant = (
    id: string,
    variant: string | undefined,
  ) => {
    setProperties((prev) => {
      const next = prev.map((p) => {
        if (p.id !== id) return p;
        if (p.type !== "checkbox" && p.type !== "rating") return p;
        const updated = { ...p } as KbProperty & { displayVariant?: string };
        if (variant === undefined) delete updated.displayVariant;
        else updated.displayVariant = variant;
        return updated as KbProperty;
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
  const sortableIds = useMemo(
    () => pageProperties.map((p) => p.id),
    [pageProperties],
  );
  // activeId — id property, который сейчас тащим. Используется для
  // рендеринга <DragOverlay> (см. ниже): drag-копия в портале с
  // фиксированной высотой / шириной избавляет от деформации соседей,
  // когда expanded text-property пролетает под/над ними.
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeProperty = useMemo(
    () => pageProperties.find((p) => p.id === activeId) ?? null,
    [activeId, pageProperties],
  );
  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };
  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setProperties((prev) => {
      const collectionProperties = prev.filter((p) => !isPageProperty(p));
      const localPageProperties = prev.filter(isPageProperty);
      const fromIdx = localPageProperties.findIndex((p) => p.id === active.id);
      const toIdx = localPageProperties.findIndex((p) => p.id === over.id);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = [
        ...collectionProperties,
        ...arrayMove(localPageProperties, fromIdx, toIdx),
      ];
      scheduleSave(next);
      return next;
    });
  };

  // Modifiers — inline (не подключаем `@dnd-kit/modifiers`, лишний dep
  // ради двух functions). Оба применяются вместе:
  //   - `RESTRICT_TO_VERTICAL_AXIS` — обнуляет горизонтальное смещение,
  //     юзер не может «увести» property вбок (визуальный шум).
  //   - `RESTRICT_TO_PARENT_ELEMENT` — clamp'ит вертикальное смещение
  //     по bounding-box'у `<ul>` (containerNodeRect). Без этого item
  //     при drag за пределы списка деформируется (flex-shrink под
  //     parent'а), а юзеру неприятно: «потерял» property вверх/вниз.
  const dndModifiers = useMemo<Modifier[]>(
    () => [
      ({ transform }) => ({ ...transform, x: 0 }),
      ({ transform, draggingNodeRect, containerNodeRect }) => {
        if (!draggingNodeRect || !containerNodeRect) return transform;
        const next = { ...transform };
        const top = draggingNodeRect.top + transform.y;
        const bottom = draggingNodeRect.bottom + transform.y;
        if (top < containerNodeRect.top) {
          next.y = containerNodeRect.top - draggingNodeRect.top;
        } else if (bottom > containerNodeRect.bottom) {
          next.y = containerNodeRect.bottom - draggingNodeRect.bottom;
        }
        return next;
      },
    ],
    [],
  );

  // Не рендерим пустую секцию для read-only страниц без свойств — иначе
  // на каждой странице висит пустой блок «Свойства».
  if (!canEdit && properties.length === 0) return null;

  return (
    <section
      aria-label="Свойства страницы"
      className="flex flex-col gap-2 px-2 -ml-2"
    >
      {collectionGroups.length > 0 && (
        <div className="flex flex-col gap-2 pb-1">
          {collectionGroups.map((group) => (
            <div key={group.id} className="flex flex-col gap-1">
              <PropertyGroupHeader
                icon={Database}
                label="Поля коллекции"
                meta={group.title}
                count={group.properties.length}
              />
              <ul className="flex flex-col gap-0.5">
                {group.properties.map((prop) => (
                  <CollectionScopedPropertyRow
                    key={prop.id}
                    property={prop}
                    canEdit={canEdit}
                    onChangeValue={(value) =>
                      updateProperty(prop.id, {
                        value,
                      } as Partial<KbProperty>)
                    }
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {pageProperties.length > 0 && (
        <>
          {collectionGroups.length > 0 && (
            <PropertyGroupHeader
              icon={TypeIcon}
              label="Свойства страницы"
              meta="локальные"
              count={pageProperties.length}
              className="pt-1"
            />
          )}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={dndModifiers}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveId(null)}
          >
            <SortableContext
              items={sortableIds}
              strategy={verticalListSortingStrategy}
            >
              <ul className="flex flex-col gap-0.5">
                {pageProperties.map((prop) => (
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
                    onToggleCollapse={() => togglePropertyCollapse(prop.id)}
                    onChangeUnit={(unit) => changePropertyUnit(prop.id, unit)}
                    onChangeRatingScale={(max) =>
                      changeRatingScale(prop.id, max)
                    }
                    onChangeDisplayVariant={(variant) =>
                      changeDisplayVariant(prop.id, variant)
                    }
                    onRemove={() => removeProperty(prop.id)}
                    onDuplicate={() => duplicateProperty(prop.id)}
                    onChangeType={(t) => changePropertyType(prop.id, t)}
                  />
                ))}
              </ul>
            </SortableContext>
            {/* DragOverlay рендерит копию dragged-row в портале с
             *  фиксированными габаритами. Это решает деформацию когда
             *  таскаешь tall expanded text-property через короткие — у
             *  соседей меняется их sortable-rect только по мере
             *  реального reorder'а, не из-за visual-смещения dragged-
             *  элемента. Оригинальный <li> в списке остаётся (faded)
             *  чтобы держать своё место в layout'е. */}
            <DragOverlay>
              {activeProperty ? (
                <PropertyRowDragPreview property={activeProperty} />
              ) : null}
            </DragOverlay>
          </DndContext>
        </>
      )}
      {showAddButton && (
        <div className="flex min-h-8 items-center gap-2 pt-1">
          {canEdit ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Plus className="size-3.5" />
                  {collectionGroups.length > 0
                    ? "Добавить свойство страницы"
                    : "Добавить свойство"}
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
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled
              aria-disabled="true"
              className="h-7 px-2 text-xs text-muted-foreground opacity-40"
            >
              <Plus className="size-3.5" />
              {collectionGroups.length > 0
                ? "Добавить свойство страницы"
                : "Добавить свойство"}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function PropertyGroupHeader({
  icon: Icon,
  label,
  meta,
  count,
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  meta?: string;
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-6 items-center gap-2 px-1.5 text-[12px] text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground/70" />
      <span className="font-medium leading-none">{label}</span>
      {meta && (
        <span className="min-w-0 truncate rounded-full bg-muted/55 px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground/75">
          {meta}
        </span>
      )}
      {typeof count === "number" && (
        <span className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-medium leading-none text-muted-foreground/70">
          {count}
        </span>
      )}
    </div>
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
  /** Toggle для text-property: collapsed (single-line truncate) ↔
   *  expanded (full multi-line). Применимо только к type === "text". */
  onToggleCollapse: () => void;
  /** Меняет unit на number-property (Stage 4). `null` = «без единицы». */
  onChangeUnit: (unit: Unit | null) => void;
  /** Меняет max-шкалу rating-property (Stage 5). 3 / 5 / 10. */
  onChangeRatingScale: (max: number) => void;
  /** Меняет displayVariant для checkbox ("checkbox" | "switch") и
   *  rating ("stars" | "slider"). undefined = вернуть default. */
  onChangeDisplayVariant: (variant: string | undefined) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onChangeType: (type: KbPropertyType) => void;
}

function CollectionScopedPropertyRow({
  property,
  canEdit,
  onChangeValue,
}: {
  property: KbProperty;
  canEdit: boolean;
  onChangeValue: (value: KbProperty["value"]) => void;
}) {
  const Icon = TYPE_ICONS[property.type];

  return (
    <li className="group/collection-row flex min-h-[30px] items-center gap-1.5 rounded-md py-0.5">
      <span
        className="size-5 -ml-1 inline-flex shrink-0 items-center justify-center"
        aria-hidden="true"
        title="Поле коллекции"
      >
        <span className="size-1.5 rounded-full bg-brand/70 ring-4 ring-brand/10" />
      </span>
      <div
        className="flex items-center gap-1.5 -mx-1.5 rounded-md px-1.5 py-0.5 transition-colors
                   hover:bg-foreground/[0.06] dark:hover:bg-foreground/10"
      >
        {property.icon ? (
          <KbPageIcon
            icon={property.icon}
            color={property.iconColor ?? null}
            size={14}
          />
        ) : (
          <Icon className="size-3.5 shrink-0 text-muted-foreground/70" />
        )}
        <span className="w-[140px] shrink-0 truncate text-[13px] text-muted-foreground">
          {property.name}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <PropertyValueControl
          property={property}
          canEdit={canEdit}
          canEditOptions={false}
          onChangeValue={onChangeValue}
          onChangeOptions={() => {}}
          onChangeOptionColors={() => {}}
        />
      </div>
    </li>
  );
}

function PropertyRow({
  property,
  canEdit,
  onRename,
  onChangeValue,
  onChangeOptions,
  onChangeOptionColors,
  onChangeIcon,
  onToggleCollapse,
  onChangeUnit,
  onChangeRatingScale,
  onChangeDisplayVariant,
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
    // Оригинальный <li> при active-drag полностью невидим (но место в
    // layout'е сохраняется через height/transform). Видна только
    // ghost-копия в DragOverlay'е — без «двойника».
    opacity: isDragging ? 0 : undefined,
  };

  return (
    <li
      ref={setNodeRef}
      style={dragStyle}
      className={cn(
        "group/row flex items-center gap-1.5 min-h-[28px] py-0.5 rounded-md",
        // Subtle background ТОЛЬКО на active-drag (визуальный feedback
        // reorder'а). Фоновая подсветка всего ряда специально НЕ
        // ставим — только label с именем (просьба юзера, см. ниже).
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
      {/* Label area: icon + name. Hover-bg ТОЛЬКО здесь (Notion-style —
       *  юзер хочет подсветку имени, не всего ряда). Заметная подсветка
       *  через `bg-foreground/10` — работает одинаково ярко на light /
       *  dark theme'ах, в отличие от `bg-accent` (которая в light тонет). */}
      <div
        className="flex items-center gap-1.5 px-1.5 py-0.5 -mx-1.5 rounded-md
                   hover:bg-foreground/[0.08] dark:hover:bg-foreground/10
                   transition-colors"
      >
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
      </div>
      <div className="flex-1 min-w-0">
        <PropertyValueControl
          property={property}
          canEdit={canEdit}
          onChangeValue={onChangeValue}
          onChangeOptions={onChangeOptions}
          onChangeOptionColors={onChangeOptionColors}
        />
      </div>
      <div className="size-6 shrink-0">
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
            {/* Свернуть / Развернуть для text-property:
             *  collapsed = single-line truncate. */}
            {property.type === "text" && (
              <DropdownMenuItem onSelect={onToggleCollapse}>
                {property.collapsed ? (
                  <Maximize2 className="size-3.5 text-muted-foreground" />
                ) : (
                  <Minimize2 className="size-3.5 text-muted-foreground" />
                )}
                {property.collapsed ? "Развернуть" : "Свернуть"}
              </DropdownMenuItem>
            )}
            {/* Показать полностью / сокращённо для url:
             *  urlCollapsed = убираем https:// из visible-текста. */}
            {property.type === "url" && (
              <DropdownMenuItem onSelect={onToggleCollapse}>
                {property.urlCollapsed ? (
                  <Maximize2 className="size-3.5 text-muted-foreground" />
                ) : (
                  <Minimize2 className="size-3.5 text-muted-foreground" />
                )}
                {property.urlCollapsed
                  ? "Показывать полностью"
                  : "Показывать сокращённо"}
              </DropdownMenuItem>
            )}
            {/* Единица измерения — только для number (Stage 4).
             *  Submenu с группами: Без единицы / Валюта (CURRENCIES) /
             *  Масса / Объём / Штук. */}
            {property.type === "number" && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Ruler className="size-3.5 text-muted-foreground" />
                  Единица измерения
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-[200px] max-h-[360px] overflow-y-auto">
                  <UnitPickerItems
                    current={property.unit}
                    onChange={onChangeUnit}
                  />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {/* Шкала — только для rating (Stage 5). 3 / 5 / 10. */}
            {property.type === "rating" && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Star className="size-3.5 text-muted-foreground" />
                  Шкала
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-[120px]">
                  {[3, 5, 10].map((max) => {
                    const isCurrent = (property.max ?? 5) === max;
                    return (
                      <DropdownMenuItem
                        key={max}
                        onSelect={() => onChangeRatingScale(max)}
                      >
                        <span className="text-[13px] tabular-nums w-6 shrink-0">
                          {max}
                        </span>
                        <span className="text-muted-foreground">
                          {max === 3 ? "звезды" : "звёзд"}
                        </span>
                        {isCurrent && (
                          <Check className="ml-auto size-3.5" />
                        )}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {/* Внешний вид — для checkbox (Чекбокс / Триггер) и rating
             *  (Звёзды / Слайдер). Семантика значения та же; меняется
             *  только рендер. */}
            {property.type === "checkbox" && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <ToggleRight className="size-3.5 text-muted-foreground" />
                  Внешний вид
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-[140px]">
                  {(
                    [
                      ["checkbox", "Чекбокс"],
                      ["switch", "Триггер"],
                    ] as const
                  ).map(([variant, label]) => {
                    const isCurrent =
                      (property.displayVariant ?? "checkbox") === variant;
                    return (
                      <DropdownMenuItem
                        key={variant}
                        onSelect={() =>
                          onChangeDisplayVariant(
                            variant === "checkbox" ? undefined : variant,
                          )
                        }
                      >
                        {label}
                        {isCurrent && <Check className="ml-auto size-3.5" />}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {property.type === "rating" && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <ToggleRight className="size-3.5 text-muted-foreground" />
                  Внешний вид
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-[140px]">
                  {(
                    [
                      ["stars", "Звёзды"],
                      ["slider", "Слайдер"],
                    ] as const
                  ).map(([variant, label]) => {
                    const isCurrent =
                      (property.displayVariant ?? "stars") === variant;
                    return (
                      <DropdownMenuItem
                        key={variant}
                        onSelect={() =>
                          onChangeDisplayVariant(
                            variant === "stars" ? undefined : variant,
                          )
                        }
                      >
                        {label}
                        {isCurrent && <Check className="ml-auto size-3.5" />}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onRemove}>
                <Trash2 className="size-3.5 text-destructive" />
                <span className="text-destructive">Удалить</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </li>
  );
}

/** Visual-копия PropertyRow для DragOverlay. Без useSortable, без
 *  edit-handler'ов (носер при drag не нужен) — только статичный
 *  layout, повторяющий PropertyRow. Использует те же icon/name/value
 *  компоненты для визуальной идентичности. */
function PropertyRowDragPreview({ property }: { property: KbProperty }) {
  const Icon = TYPE_ICONS[property.type];
  return (
    <li
      className={cn(
        "flex items-center gap-1.5 min-h-[28px] py-0.5 rounded-md",
        "bg-card shadow-md ring-1 ring-border/40",
        "px-2",
      )}
    >
      <span className="size-5 -ml-1 shrink-0 flex items-center justify-center text-muted-foreground/40">
        <GripVertical className="size-3.5" />
      </span>
      <div className="flex items-center gap-1.5 px-1 -mx-1">
        {property.icon ? (
          <KbPageIcon
            icon={property.icon}
            color={property.iconColor ?? null}
            size={14}
          />
        ) : (
          <Icon className="size-3.5 shrink-0 text-muted-foreground/70" />
        )}
        <span className="w-[140px] shrink-0 text-[13px] text-muted-foreground">
          {property.name}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <PropertyValueControl
          property={property}
          canEdit={false}
          onChangeValue={() => {}}
          onChangeOptions={() => {}}
          onChangeOptionColors={() => {}}
        />
      </div>
    </li>
  );
}

function PropertyValueControl({
  property,
  canEdit,
  canEditOptions = true,
  onChangeValue,
  onChangeOptions,
  onChangeOptionColors,
}: {
  property: KbProperty;
  canEdit: boolean;
  canEditOptions?: boolean;
  onChangeValue: (value: KbProperty["value"]) => void;
  onChangeOptions: (options: string[]) => void;
  onChangeOptionColors: (
    optionColors: Partial<Record<string, KbPropertyColor>> | undefined,
  ) => void;
}) {
  switch (property.type) {
    case "text": {
      const collapsed = property.collapsed === true;
      return canEdit ? (
        <TextValueControl
          value={property.value}
          collapsed={collapsed}
          onChange={onChangeValue}
        />
      ) : (
        <span
          className={cn(
            "text-[13px] break-words",
            collapsed ? "line-clamp-1" : "whitespace-pre-wrap",
          )}
        >
          {property.value || "—"}
        </span>
      );
    }
    case "number":
      return (
        <NumberValueControl
          property={property}
          canEdit={canEdit}
          onChangeValue={(v) => onChangeValue(v)}
        />
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
      // displayVariant = "switch" → toggle-триггер; иначе — классический
      // чекбокс. Семантика boolean идентична.
      return property.displayVariant === "switch" ? (
        <Switch
          checked={property.value}
          onCheckedChange={(v) => onChangeValue(v === true)}
          disabled={!canEdit}
          aria-label="Значение"
        />
      ) : (
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
        canEditOptions={canEditOptions}
        onChangeValue={onChangeValue}
        onChangeOptions={onChangeOptions}
        onChangeOptionColors={onChangeOptionColors}
      />;
    case "url":
      return <UrlValueControl
        value={property.value}
        collapsed={property.urlCollapsed === true}
        canEdit={canEdit}
        onChange={onChangeValue}
      />;
    case "rating":
      return <RatingValueControl
        value={property.value}
        max={property.max ?? 5}
        variant={property.displayVariant ?? "stars"}
        canEdit={canEdit}
        onChange={onChangeValue}
      />;
    case "multi-select":
      return <MultiSelectControl
        property={property}
        canEdit={canEdit}
        canEditOptions={canEditOptions}
        onChangeValue={onChangeValue}
        onChangeOptions={onChangeOptions}
        onChangeOptionColors={onChangeOptionColors}
      />;
  }
}

/** Текстовое значение property:
 *  - `collapsed = false` (default): textarea, растущая по содержимому
 *    (auto-grow на каждое изменение).
 *  - `collapsed = true`: single-line `<input>` с overflow-ellipsis.
 *    Toggle переключается через ⋯ menu (см. PropertyRow). */
function TextValueControl({
  value,
  collapsed,
  onChange,
}: {
  value: string;
  collapsed: boolean;
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
    if (!collapsed) resize();
  }, [value, collapsed]);

  if (collapsed) {
    // Single-line input — overflow auto-truncate'ится на input'е по
    // ширине его контейнера. На фокус scroll-x внутри input'а позволяет
    // редактировать длинный текст без визуального обрезания cursor'а.
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="—"
        className="w-full bg-transparent text-[13px] outline-none truncate
                   leading-snug placeholder:text-muted-foreground/50
                   border-0 p-0"
      />
    );
  }

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
                 border-0 p-0"
    />
  );
}

/** URL-property:
 *  - Read-only mode: `<a target="_blank">` с external-link иконкой.
 *  - Edit mode: `<input type="url">`. На blur — нормализуем (если не
 *    пусто и нет схемы — добавляем `https://`).
 *
 *  «Битая» ссылка (не https?://, mailto:, tel: префикса) не блокирует
 *  ввод — БД хранит как есть, рендер показывает amber-border как hint
 *  что juyer возможно опечатался. Жёсткой валидации нет (Notion-style:
 *  принимаем любую строку, помечаем подозрительные). */
const URL_VALID_PREFIX_RE = /^(https?:\/\/|mailto:|tel:)/i;

/** Убирает `https://` / `http://` префикс для display-режима когда
 *  `urlCollapsed === true`. Сама href остаётся полной. mailto: / tel:
 *  префиксы не трогаем — они смысловые. */
function shortenUrlForDisplay(url: string, collapsed: boolean): string {
  if (!collapsed) return url;
  return url.replace(/^https?:\/\//i, "");
}

function UrlValueControl({
  value,
  collapsed,
  canEdit,
  onChange,
}: {
  value: string;
  collapsed: boolean;
  canEdit: boolean;
  onChange: (value: string) => void;
}) {
  const trimmed = value.trim();
  const looksValid = trimmed.length === 0 || URL_VALID_PREFIX_RE.test(trimmed);
  const display = shortenUrlForDisplay(trimmed, collapsed);

  // Click-to-edit. Display-mode по дефолту — `<a>` остаётся
  // кликабельной (открывает ссылку). В edit-mode переходим через
  // отдельный pencil-toggle (или click по placeholder'у при empty
  // value). Так клик по самой ссылке не «угоняет» юзера в edit-режим.
  const [editing, setEditing] = useState(false);

  // Local draft — input controlled. См. PR #142 / Codex P1 #142:
  //   1. Collapsed-режим: input показывает scheme-stripped display, БД
  //      должна хранить полный URL.
  //   2. Focus + blur без правок не должен переписывать http://https://.
  const [draft, setDraft] = useState(display);
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setDraft(display);
  }, [display]);

  // Read-only пользователь — всегда display-mode (clickable link).
  if (!canEdit) {
    if (!trimmed) {
      return <span className="text-[13px] text-muted-foreground/50">—</span>;
    }
    if (!looksValid) {
      return <span className="text-[13px] truncate">{trimmed}</span>;
    }
    return (
      <a
        href={trimmed}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[13px] text-foreground underline decoration-muted-foreground/40
                   underline-offset-[3px] decoration-[1.5px]
                   hover:decoration-foreground hover:text-foreground transition-colors
                   truncate inline-block max-w-full"
      >
        {display}
      </a>
    );
  }

  const commit = (raw: string) => {
    const v = raw.trim();
    if (v === display) {
      setDraft(display);
      return;
    }
    if (URL_VALID_PREFIX_RE.test(v)) {
      onChange(v);
      return;
    }
    if (collapsed && trimmed.length > 0) {
      const origSchemeMatch = trimmed.match(/^(https?:\/\/)/i);
      const origScheme = origSchemeMatch ? origSchemeMatch[1] : "https://";
      onChange(`${origScheme}${v}`);
      return;
    }
    if (v.length > 0 && /\.[a-z]{2,}/i.test(v) && !/\s/.test(v)) {
      onChange(`https://${v}`);
      return;
    }
    onChange(v);
  };

  // Edit-mode: bare input без рамки, с auto-focus.
  if (editing) {
    return (
      <input
        autoFocus
        type="url"
        value={draft}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          focusedRef.current = false;
          commit(e.target.value);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") {
            e.currentTarget.blur();
          }
        }}
        placeholder={collapsed ? "example.com" : "https://…"}
        className={cn(
          "w-full bg-transparent text-[13px] outline-none truncate",
          "border-0 p-0",
          !looksValid && "text-amber-700 dark:text-amber-400",
        )}
        aria-invalid={!looksValid}
      />
    );
  }

  // Display-mode: clickable `<a>` или placeholder. Pencil-кнопка
  // справа (на hover) — entry в edit-mode. Если value пустое — клик
  // по placeholder'у сразу переходит в edit (некуда вести ссылкой).
  if (!trimmed) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-left text-[13px] text-muted-foreground/50 w-full truncate"
        aria-label="Ввести URL"
      >
        —
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 max-w-full group/url">
      {looksValid ? (
        <a
          href={trimmed}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[13px] text-foreground underline decoration-muted-foreground/40
                     underline-offset-[3px] decoration-[1.5px]
                     hover:decoration-foreground hover:text-foreground transition-colors
                     truncate inline-block max-w-full"
        >
          {display}
        </a>
      ) : (
        <span
          className="text-[13px] text-amber-700 dark:text-amber-400 truncate inline-block max-w-full"
          title="Неверный URL"
        >
          {trimmed}
        </span>
      )}
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label="Редактировать URL"
        className="size-5 shrink-0 inline-flex items-center justify-center rounded
                   text-muted-foreground/40 hover:text-foreground transition-colors
                   opacity-0 group-hover/url:opacity-100 focus-visible:opacity-100"
      >
        <Pencil className="size-3" />
      </button>
    </span>
  );
}

function SelectControl({
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

/** Inline icon-trigger перед именем property. По дефолту показывает
 *  TYPE_ICONS[type] (default behavior до Stage 2). Если у property
 *  есть `icon` override — рендерится оно (Lucide-name из KB_ICONS) с
 *  опциональным `iconColor` тинтом. Click открывает Popover с
 *  `KbIconPickerBody` — тот же компонент, что у KB-страничного picker'а:
 *  search + Random + color popover (10 цветов) + крестик «Отменить выбор».
 *
 *  Read-only режим (`!canEdit`): trigger некликабельный, выглядит как
 *  обычная иконка без интерактивности.
 *
 *  Триггер у property маленький (20px) и fallback другой (TYPE_ICONS[type],
 *  не File), поэтому не используем `<KbIconPicker>` целиком — только
 *  его popover-body. */
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
    return (
      <span className="size-5 shrink-0 inline-flex items-center justify-center">
        {renderIcon(14)}
      </span>
    );
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
        className="w-[380px] p-0 rounded-[10px]"
      >
        <KbIconPickerBody
          value={property.icon ?? null}
          color={property.iconColor ?? null}
          onChange={({ icon, color }) => onChangeIcon(icon, color)}
          onCommitClose={() => setOpen(false)}
        />
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

/** Number value-control с поддержкой опциональной единицы измерения
 *  (Stage 4). Click-to-edit pattern:
 *  - Default: read-mode (formatted string, suffix flush с числом).
 *  - On click → edit-mode (наг input + suffix inline, без рамки).
 *  - On blur → обратно в read-mode.
 *
 *  Управление единицей вынесено в ⋯ menu (UnitPickerItems). */
function NumberValueControl({
  property,
  canEdit,
  onChangeValue,
}: {
  property: Extract<KbProperty, { type: "number" }>;
  canEdit: boolean;
  onChangeValue: (value: number | null) => void;
}) {
  const unit: Unit = property.unit ?? { kind: "none" };
  const suffix = unitSuffix(unit);
  const [editing, setEditing] = useState(false);

  const display =
    property.value === null ? "—" : formatWithUnit(property.value, unit);

  if (!canEdit) {
    return <span className="text-[13px] tabular-nums">{display}</span>;
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={cn(
          "text-left text-[13px] tabular-nums w-full truncate",
          property.value === null && "text-muted-foreground/50",
        )}
        aria-label="Редактировать число"
      >
        {display}
      </button>
    );
  }

  // Edit-mode: <input> + inline suffix, без рамки. `size` атрибут
  // подгоняет ширину input'а под содержимое, чтобы suffix лип к числу
  // вплотную (а не висел справа в отрыве).
  const valueStr = property.value === null ? "" : String(property.value);
  const inputSize = Math.max(2, valueStr.length || 2);

  return (
    <span className="inline-flex items-baseline max-w-full">
      <input
        autoFocus
        type="number"
        inputMode="numeric"
        size={inputSize}
        value={property.value ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onChangeValue(v === "" ? null : Number(v));
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") {
            e.currentTarget.blur();
          }
        }}
        placeholder="—"
        className="text-[13px] tabular-nums outline-none bg-transparent
                   border-0 p-0 m-0
                   [appearance:textfield]
                   [&::-webkit-outer-spin-button]:appearance-none
                   [&::-webkit-inner-spin-button]:appearance-none"
      />
      {suffix && (
        <span
          className="text-[13px] text-muted-foreground/80 shrink-0 select-none"
          title="Единица измерения (изменить — через ⋯ меню)"
        >
          {suffix}
        </span>
      )}
    </span>
  );
}

/** Rating value-control. Два variant'а:
 *  - `stars` (default): ★★★☆☆ строка из звёзд. Click по N-й ставит
 *    value = N, click по уже-выбранной — null. Hover показывает preview.
 *  - `slider`: native `<input type="range">` от 0 до max + label с
 *    текущим значением. 0 = null (не задано). */
function RatingValueControl({
  value,
  max,
  variant,
  canEdit,
  onChange,
}: {
  value: number | null;
  max: number;
  variant: "stars" | "slider";
  canEdit: boolean;
  onChange: (value: number | null) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (variant === "slider") {
    const effective = value ?? 0;
    return (
      <div className="inline-flex items-center gap-2 max-w-full">
        <input
          type="range"
          min={0}
          max={max}
          step={1}
          value={effective}
          disabled={!canEdit}
          onChange={(e) => {
            const n = Number(e.target.value);
            // 0 = «не задано». Удобно: можно sweep'нуть слайдер влево
            // чтобы сбросить, без отдельной кнопки X.
            onChange(n === 0 ? null : n);
          }}
          aria-label={`Оценка от 0 до ${max}`}
          className={cn(
            "w-32 accent-amber-400",
            canEdit ? "cursor-pointer" : "cursor-default",
          )}
        />
        <span className="text-[13px] tabular-nums text-muted-foreground min-w-[40px]">
          {value === null ? "—" : `${value} / ${max}`}
        </span>
      </div>
    );
  }

  // variant === "stars"
  const effective = hover ?? value ?? 0;

  return (
    <div
      className="inline-flex items-center gap-0.5"
      onMouseLeave={canEdit ? () => setHover(null) : undefined}
      role="radiogroup"
      aria-label={`Оценка от 0 до ${max}`}
    >
      {Array.from({ length: max }).map((_, i) => {
        const star = i + 1;
        const filled = effective >= star;
        const isHoverPreview = hover !== null && hover >= star;
        return (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={value === star}
            aria-label={`${star} из ${max}`}
            disabled={!canEdit}
            onMouseEnter={canEdit ? () => setHover(star) : undefined}
            onClick={() => {
              // Click по уже-выбранной звезде = сбросить.
              onChange(value === star ? null : star);
            }}
            className={cn(
              "size-5 inline-flex items-center justify-center rounded transition-colors",
              canEdit
                ? "hover:bg-amber-100/60 dark:hover:bg-amber-900/20"
                : "cursor-default",
            )}
          >
            <Star
              className={cn(
                "size-3.5 transition-colors",
                filled
                  ? isHoverPreview && hover !== null && (value ?? 0) < star
                    ? "fill-amber-300 text-amber-400/80"
                    : "fill-amber-400 text-amber-400"
                  : "text-muted-foreground/30",
              )}
            />
          </button>
        );
      })}
      {value !== null && (
        <button
          type="button"
          aria-label="Сбросить оценку"
          disabled={!canEdit}
          onClick={() => onChange(null)}
          className={cn(
            "ml-1 size-5 inline-flex items-center justify-center rounded",
            "text-muted-foreground/40 transition-colors opacity-0",
            canEdit &&
              "hover:text-destructive group-hover/row:opacity-100",
          )}
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

/** Items для submenu «Единица измерения» в ⋯ меню. Группы: «Без
 *  единицы» / Валюта / Масса / Объём / Штук. Текущая единица помечена
 *  галочкой. Click → onChange(unit). Click «Без единицы» → onChange(null)
 *  (= delete unit поля из property). */
function UnitPickerItems({
  current,
  onChange,
}: {
  current: Unit | undefined;
  onChange: (unit: Unit | null) => void;
}) {
  const isNone = !current || current.kind === "none";
  const isCurrency = (code: string) =>
    current?.kind === "currency" && current.code === code;
  const isMass = (code: string) =>
    current?.kind === "mass" && current.code === code;
  const isVolume = (code: string) =>
    current?.kind === "volume" && current.code === code;
  const isPiece = current?.kind === "piece";

  return (
    <>
      <DropdownMenuItem
        onSelect={() => onChange(null)}
        className="text-muted-foreground"
      >
        <span className="size-3.5 shrink-0 rounded-full border border-dashed border-muted-foreground/40" />
        Без единицы
        {isNone && <Check className="ml-auto size-3.5" />}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
        Валюта
      </div>
      {UNIT_CURRENCIES.map((c) => (
        <DropdownMenuItem
          key={c.value}
          onSelect={() => onChange({ kind: "currency", code: c.value })}
        >
          <span className="text-[13px] w-6 shrink-0 text-muted-foreground">
            {c.label.split(" ")[0]}
          </span>
          <span className="flex-1 truncate">
            {c.label.replace(/^\S+\s+/, "")}
          </span>
          {isCurrency(c.value) && <Check className="ml-auto size-3.5" />}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
        Масса
      </div>
      {MASS_UNITS.map((m) => (
        <DropdownMenuItem
          key={m.code}
          onSelect={() => onChange({ kind: "mass", code: m.code })}
        >
          <span className="text-[13px] w-6 shrink-0 text-muted-foreground">
            {m.label}
          </span>
          <span className="flex-1 truncate">{m.longLabel}</span>
          {isMass(m.code) && <Check className="ml-auto size-3.5" />}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
        Объём
      </div>
      {VOLUME_UNITS.map((v) => (
        <DropdownMenuItem
          key={v.code}
          onSelect={() => onChange({ kind: "volume", code: v.code })}
        >
          <span className="text-[13px] w-6 shrink-0 text-muted-foreground">
            {v.label}
          </span>
          <span className="flex-1 truncate">{v.longLabel}</span>
          {isVolume(v.code) && <Check className="ml-auto size-3.5" />}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={() => onChange({ kind: "piece" })}
      >
        <span className="text-[13px] w-6 shrink-0 text-muted-foreground">
          {PIECE_UNIT.label}
        </span>
        <span className="flex-1 truncate">{PIECE_UNIT.longLabel}</span>
        {isPiece && <Check className="ml-auto size-3.5" />}
      </DropdownMenuItem>
    </>
  );
}
