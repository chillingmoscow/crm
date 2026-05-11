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
  Copy,
  Replace,
  GripVertical,
  Check,
  Minimize2,
  Maximize2,
  Ruler,
  ToggleRight,
  Database,
  Info,
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
import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { KB_PROPERTY_UI_ICONS } from "@/components/knowledge/property-ui-icons";
import type { Unit } from "@/lib/units";
import {
  saveKbPageProperties,
  saveKbTemplateProperties,
} from "@/lib/knowledge/properties";
import type {
  KbProperty,
  KbPropertyColor,
  KbPropertyType,
} from "@/types/knowledge";

import { TextValueControl } from "./page-properties/controls/text-control";
import { UrlValueControl } from "./page-properties/controls/url-control";
import { SelectControl } from "./page-properties/controls/select-control";
import { MultiSelectControl } from "./page-properties/controls/multi-select-control";
import { NumberValueControl } from "./page-properties/controls/number-control";
import { RatingValueControl } from "./page-properties/controls/rating-control";
import { UnitPickerItems } from "./page-properties/controls/unit-picker-items";
import { PropertyIconButton } from "./page-properties/controls/property-icon-button";
import {
  CREATABLE_PROPERTY_TYPES,
  SAVE_DEBOUNCE_MS,
  TYPE_ICONS,
  TYPE_LABELS,
  getCollectionScope,
  isPageProperty,
  makeProperty,
  propertyTypeOptions,
} from "./page-properties/helpers";

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
  // Latest payload scheduled for save but not yet flushed. Cleared by
  // `flushSave` on success. Read on unmount to flush in-flight edits
  // synchronously (before the debounce timer fires), otherwise a user
  // who edits a property and navigates within SAVE_DEBOUNCE_MS loses
  // the change.
  const pendingNextRef = useRef<KbProperty[] | null>(null);
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
    pendingNextRef.current = next;
    saveTimer.current = setTimeout(() => {
      void flushSave(next);
    }, SAVE_DEBOUNCE_MS);
  };

  const flushSave = async (next: KbProperty[]) => {
    const serialized = JSON.stringify(next);
    if (serialized === lastSavedRef.current) {
      pendingNextRef.current = null;
      return;
    }
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
    pendingNextRef.current = null;
  };

  useEffect(() => {
    return () => {
      // Cancel the debounce timer and fire any pending save synchronously
      // so edits aren't lost when the user navigates within
      // SAVE_DEBOUNCE_MS of their last keystroke. The Promise is allowed
      // to settle after unmount — the server action carries its own
      // request context.
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const pending = pendingNextRef.current;
      if (pending) void flushSave(pending);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount only; flushSave reads refs, no captured stale state
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
      const copy = {
        ...orig,
        id: nanoid(8),
        name: orig.name ? `${orig.name} (копия)` : "Копия",
      };
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
        if (p.type === "rating" && newType === "number") {
          return {
            id: p.id,
            name: p.name,
            type: "number",
            value: p.value,
            displayVariant: "rating",
            max: p.max ?? 5,
            ...(p.displayVariant === "slider"
              ? { ratingVariant: "slider" as const }
              : {}),
            ...(p.icon !== undefined ? { icon: p.icon } : {}),
            ...(p.iconColor !== undefined ? { iconColor: p.iconColor } : {}),
            ...(p.description !== undefined
              ? { description: p.description }
              : {}),
          } as KbProperty;
        }
        const fresh = makeProperty(newType, p.name);
        // Перенос icon override из старого property.
        const carriedIcon = {
          ...(p.icon !== undefined ? { icon: p.icon } : {}),
          ...(p.iconColor !== undefined ? { iconColor: p.iconColor } : {}),
          ...(p.description !== undefined ? { description: p.description } : {}),
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
        if (
          p.id !== id ||
          (p.type !== "rating" &&
            !(p.type === "number" && p.displayVariant === "rating"))
        ) {
          return p;
        }
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
        if (p.type !== "checkbox" && p.type !== "rating" && p.type !== "number") {
          return p;
        }
        const updated = { ...p } as KbProperty & { displayVariant?: string };
        if (p.type === "number") {
          if (variant === "rating") {
            updated.displayVariant = "rating";
            (updated as Extract<KbProperty, { type: "number" }>).max =
              (p as Extract<KbProperty, { type: "number" }>).max ?? 5;
            (updated as Extract<KbProperty, { type: "number" }>).ratingVariant =
              (p as Extract<KbProperty, { type: "number" }>).ratingVariant ??
              "stars";
            (updated as Extract<KbProperty, { type: "number" }>).ratingShowValue =
              (p as Extract<KbProperty, { type: "number" }>).ratingShowValue ??
              true;
            delete (updated as Extract<KbProperty, { type: "number" }>).unit;
          } else {
            delete updated.displayVariant;
            delete (updated as Extract<KbProperty, { type: "number" }>).max;
            delete (updated as Extract<KbProperty, { type: "number" }>).ratingVariant;
            delete (updated as Extract<KbProperty, { type: "number" }>).ratingShowValue;
          }
          return updated as KbProperty;
        }
        if (variant === undefined) delete updated.displayVariant;
        else updated.displayVariant = variant;
        return updated as KbProperty;
      });
      scheduleSave(next);
      return next;
    });
  };

  const changeNumberRatingVariant = (
    id: string,
    variant: "stars" | "slider",
  ) => {
    setProperties((prev) => {
      const next = prev.map((p) => {
        if (
          p.id !== id ||
          p.type !== "number" ||
          p.displayVariant !== "rating"
        ) {
          return p;
        }
        return {
          ...p,
          ratingVariant: variant,
        } as KbProperty;
      });
      scheduleSave(next);
      return next;
    });
  };

  const changeNumberRatingShowValue = (id: string, showValue: boolean) => {
    setProperties((prev) => {
      const next = prev.map((p) => {
        if (
          p.id !== id ||
          p.type !== "number" ||
          p.displayVariant !== "rating"
        ) {
          return p;
        }
        return {
          ...p,
          ratingShowValue: showValue,
        } as KbProperty;
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

  const changePropertyDescription = (id: string, description: string) => {
    const nextDescription = description.trim().slice(0, 280);
    updateProperty(id, { description: nextDescription || undefined } as Partial<KbProperty>);
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
                    onChangeDescription={(description) =>
                      changePropertyDescription(prop.id, description)
                    }
                    onToggleCollapse={() => togglePropertyCollapse(prop.id)}
                    onChangeUnit={(unit) => changePropertyUnit(prop.id, unit)}
                    onChangeRatingScale={(max) =>
                      changeRatingScale(prop.id, max)
                    }
                    onChangeDisplayVariant={(variant) =>
                      changeDisplayVariant(prop.id, variant)
                    }
                    onChangeNumberRatingVariant={(variant) =>
                      changeNumberRatingVariant(prop.id, variant)
                    }
                    onChangeNumberRatingShowValue={(showValue) =>
                      changeNumberRatingShowValue(prop.id, showValue)
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
                {CREATABLE_PROPERTY_TYPES.map((t) => {
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
  onChangeDescription: (description: string) => void;
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
  onChangeNumberRatingVariant: (variant: "stars" | "slider") => void;
  onChangeNumberRatingShowValue: (showValue: boolean) => void;
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
  onChangeDescription,
  onToggleCollapse,
  onChangeUnit,
  onChangeRatingScale,
  onChangeDisplayVariant,
  onChangeNumberRatingVariant,
  onChangeNumberRatingShowValue,
  onRemove,
  onDuplicate,
  onChangeType,
}: PropertyRowProps) {
  const [name, setName] = useState(property.name);
  const [descriptionDraft, setDescriptionDraft] = useState(
    property.description ?? "",
  );
  // Sync external rename (e.g., другой клиент) на случай контролируемой
  // mutation сверху.
  useEffect(() => setName(property.name), [property.name]);
  useEffect(() => {
    setDescriptionDraft(property.description ?? "");
  }, [property.description]);

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
              if (trimmed !== property.name) onRename(trimmed);
              setName(trimmed);
            }}
            className="w-[140px] shrink-0 bg-transparent text-[13px] text-muted-foreground outline-none focus:text-foreground"
            aria-label="Имя свойства"
          />
        ) : (
          <span className="w-[140px] shrink-0 text-[13px] text-muted-foreground">
            {property.name}
          </span>
        )}
        {canEdit && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "size-5 shrink-0 inline-flex items-center justify-center rounded text-muted-foreground/70 hover:bg-accent hover:text-foreground",
                  property.description && "text-foreground",
                )}
                aria-label="Описание свойства"
              >
                <Info className="size-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              sideOffset={6}
              className="w-[260px] p-2"
              onOpenAutoFocus={(event) => event.preventDefault()}
            >
              <Input
                value={descriptionDraft}
                placeholder="Описание свойства"
                className="h-8"
                aria-label="Описание свойства"
                onChange={(event) =>
                  setDescriptionDraft(event.currentTarget.value)
                }
                onBlur={() => onChangeDescription(descriptionDraft)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onChangeDescription(event.currentTarget.value);
                    event.currentTarget.blur();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setDescriptionDraft(property.description ?? "");
                    event.currentTarget.blur();
                  }
                }}
              />
            </PopoverContent>
          </Popover>
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
            {property.type === "number" && property.displayVariant !== "rating" && (
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
            {property.type === "number" && property.displayVariant === "rating" && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <KB_PROPERTY_UI_ICONS.scale className="size-3.5 text-muted-foreground" />
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
            {property.type === "number" && property.displayVariant === "rating" && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <KB_PROPERTY_UI_ICONS.rating className="size-3.5 text-muted-foreground" />
                  Рейтинг
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-[140px]">
                  {(
                    [
                      ["stars", "Звёзды"],
                      ["slider", "Слайдер"],
                    ] as const
                  ).map(([variant, label]) => {
                    const isCurrent =
                      (property.ratingVariant ?? "stars") === variant;
                    return (
                      <DropdownMenuItem
                        key={variant}
                        onSelect={() => onChangeNumberRatingVariant(variant)}
                      >
                        {label}
                        {isCurrent && <Check className="ml-auto size-3.5" />}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {property.type === "number" &&
              property.displayVariant === "rating" &&
              property.ratingVariant === "slider" && (
                <DropdownMenuItem
                  onSelect={() =>
                    onChangeNumberRatingShowValue(
                      property.ratingShowValue === false,
                    )
                  }
                >
                  <KB_PROPERTY_UI_ICONS.showValue className="size-3.5 text-muted-foreground" />
                  Показывать число
                  {(property.ratingShowValue ?? true) && (
                    <Check className="ml-auto size-3.5" />
                  )}
                </DropdownMenuItem>
              )}
            {/* Шкала — только для rating (Stage 5). 3 / 5 / 10. */}
            {property.type === "rating" && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <KB_PROPERTY_UI_ICONS.scale className="size-3.5 text-muted-foreground" />
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
            {property.type === "number" && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <ToggleRight className="size-3.5 text-muted-foreground" />
                  Внешний вид
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-[140px]">
                  {(
                    [
                      ["number", "Число"],
                      ["rating", "Рейтинг"],
                    ] as const
                  ).map(([variant, label]) => {
                    const isCurrent =
                      (property.displayVariant ?? "number") === variant;
                    return (
                      <DropdownMenuItem
                        key={variant}
                        onSelect={() =>
                          onChangeDisplayVariant(
                            variant === "number" ? undefined : variant,
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

export function PropertyValueControl({
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
        showValue={property.ratingShowValue ?? true}
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
