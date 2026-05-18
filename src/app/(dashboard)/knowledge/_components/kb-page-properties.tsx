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
  GripVertical,
  Database,
  Type as TypeIcon,
  Pencil,
  ChevronRight,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { PropertyIconButton } from "./page-properties/controls/property-icon-button";
import { DateValueControl } from "./page-properties/controls/date-control";
import {
  CREATABLE_PROPERTY_TYPES,
  SAVE_DEBOUNCE_MS,
  TYPE_ICONS,
  TYPE_LABELS,
  getCollectionScope,
  isPageProperty,
  makeProperty,
} from "./page-properties/helpers";
import { PropertyEditorPopover } from "./page-properties/option-editor-popover";

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
      // Only clear the pending pointer if it still refers to the value
      // we just no-op'd on. Otherwise a newer schedule (call sequence:
      // schedule A → fire A → schedule B → A resolves) has updated
      // pendingNextRef to B and we must not lose that reference.
      if (pendingNextRef.current === next) pendingNextRef.current = null;
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
    // Identity guard: don't clobber a newer scheduled payload. Codex
    // flagged the unconditional clear: stale save A finishing after a
    // fresh schedule B would null out pendingNextRef and the unmount
    // cleanup would drop B silently.
    if (pendingNextRef.current === next) pendingNextRef.current = null;
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
            ...(optionProp.optionDescriptions
              ? { optionDescriptions: optionProp.optionDescriptions }
              : {}),
            ...(optionProp.optionSort
              ? { optionSort: optionProp.optionSort }
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
            const nMax = (p as Extract<KbProperty, { type: "number" }>).max ?? 5;
            updated.displayVariant = "rating";
            (updated as Extract<KbProperty, { type: "number" }>).max = nMax;
            if (
              (updated as Extract<KbProperty, { type: "number" }>).value !==
                null &&
              ((updated as Extract<KbProperty, { type: "number" }>)
                .value as number) > nMax
            ) {
              (updated as Extract<KbProperty, { type: "number" }>).value = nMax;
            }
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
        if (p.type === "rating") {
          const rMax = (p as Extract<KbProperty, { type: "rating" }>).max ?? 5;
          const r = updated as Extract<KbProperty, { type: "rating" }>;
          if (r.value !== null && r.value > rMax) r.value = rMax;
        }
        return updated as KbProperty;
      });
      scheduleSave(next);
      return next;
    });
  };

  // Единый «Вид» для number: Число / Звёзды / Слайдер (заменяет
  // прежнее разделение «Внешний вид» + «Рейтинг» + «Показывать число»).
  const changeNumberView = (
    id: string,
    view: "number" | "stars" | "slider",
  ) => {
    setProperties((prev) => {
      const next = prev.map((p) => {
        if (p.id !== id || p.type !== "number") return p;
        if (view === "number") {
          const u = { ...p } as Extract<KbProperty, { type: "number" }>;
          delete u.displayVariant;
          delete u.max;
          delete u.ratingVariant;
          delete u.ratingShowValue;
          return u as KbProperty;
        }
        const max = p.max ?? 5;
        // Переход «число → звёзды/слайдер»: значение не может
        // превышать шкалу — иначе server-схема (rating ≤ max)
        // отвергает сохранение. Зажимаем до max.
        const clampedValue =
          p.value !== null && p.value > max ? max : p.value;
        return {
          ...p,
          value: clampedValue,
          displayVariant: "rating",
          max,
          ratingVariant: view,
          ratingShowValue: p.ratingShowValue ?? true,
        } as KbProperty;
      });
      scheduleSave(next);
      return next;
    });
  };

  // Округление number при отображении. undefined = «Авто».
  const changeNumberDecimals = (
    id: string,
    decimals: number | undefined,
  ) => {
    setProperties((prev) => {
      const next = prev.map((p) => {
        if (p.id !== id || p.type !== "number") return p;
        const u = { ...p } as Extract<KbProperty, { type: "number" }>;
        if (decimals === undefined) delete u.decimals;
        else u.decimals = decimals;
        return u as KbProperty;
      });
      scheduleSave(next);
      return next;
    });
  };

  // Цвет звёзд / слайдера. null = убрать (amber-default).
  const changeRatingColor = (id: string, color: KbPropertyColor | null) => {
    setProperties((prev) => {
      const next = prev.map((p) => {
        if (
          p.id !== id ||
          (p.type !== "rating" &&
            !(p.type === "number" && p.displayVariant === "rating"))
        ) {
          return p;
        }
        const updated = { ...p } as KbProperty & { ratingColor?: KbPropertyColor };
        if (color === null) delete updated.ratingColor;
        else updated.ratingColor = color;
        return updated as KbProperty;
      });
      scheduleSave(next);
      return next;
    });
  };

  // Показывать / скрывать числовой лейбл рядом со слайдером.
  const changeRatingShowValue = (id: string, show: boolean) => {
    setProperties((prev) => {
      const next = prev.map((p) => {
        if (
          p.id !== id ||
          (p.type !== "rating" &&
            !(p.type === "number" && p.displayVariant === "rating"))
        ) {
          return p;
        }
        return { ...p, ratingShowValue: show } as KbProperty;
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
    // Raw (без trim) — live-commit на каждый keystroke, иначе resync
    // draft'а из пропа съедал бы пробелы. Trim делает zod при сохранении.
    const nextDescription = description.slice(0, 280);
    updateProperty(id, {
      description: nextDescription === "" ? undefined : nextDescription,
    } as Partial<KbProperty>);
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
      className="flex flex-col gap-1 px-2 -ml-2"
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
                        const currDesc = (
                          prop as
                            | Extract<KbProperty, { type: "select" }>
                            | Extract<KbProperty, { type: "multi-select" }>
                        ).optionDescriptions;
                        let nextDesc:
                          | Partial<Record<string, string>>
                          | undefined = currDesc;
                        if (currDesc) {
                          const filtered = Object.fromEntries(
                            Object.entries(currDesc).filter(([k]) =>
                              allowed.has(k),
                            ),
                          );
                          nextDesc =
                            Object.keys(filtered).length > 0
                              ? filtered
                              : undefined;
                        }
                        // Для multi-select также чистим value от удалённых.
                        const patch: Partial<KbProperty> = {
                          options,
                          optionColors: nextColors,
                          optionDescriptions: nextDesc,
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
                    onRenameOption={(from, to) => {
                      if (
                        prop.type !== "select" &&
                        prop.type !== "multi-select"
                      ) {
                        return;
                      }
                      const p = prop as
                        | Extract<KbProperty, { type: "select" }>
                        | Extract<KbProperty, { type: "multi-select" }>;
                      const options = p.options.map((o) =>
                        o === from ? to : o,
                      );
                      let optionColors = p.optionColors;
                      if (optionColors && from in optionColors) {
                        const next = { ...optionColors };
                        const carried = next[from];
                        delete next[from];
                        if (carried !== undefined) next[to] = carried;
                        optionColors =
                          Object.keys(next).length > 0 ? next : undefined;
                      }
                      let optionDescriptions = p.optionDescriptions;
                      if (optionDescriptions && from in optionDescriptions) {
                        const next = { ...optionDescriptions };
                        const carried = next[from];
                        delete next[from];
                        if (carried !== undefined) next[to] = carried;
                        optionDescriptions =
                          Object.keys(next).length > 0 ? next : undefined;
                      }
                      const patch = {
                        options,
                        optionColors,
                        optionDescriptions,
                      } as Partial<KbProperty>;
                      if (p.type === "select") {
                        (patch as { value?: string | null }).value =
                          p.value === from ? to : p.value;
                      } else {
                        (patch as { value?: string[] }).value = p.value.map(
                          (v) => (v === from ? to : v),
                        );
                      }
                      updateProperty(prop.id, patch);
                    }}
                    onRemoveOption={(option) => {
                      if (
                        prop.type !== "select" &&
                        prop.type !== "multi-select"
                      ) {
                        return;
                      }
                      const p = prop as
                        | Extract<KbProperty, { type: "select" }>
                        | Extract<KbProperty, { type: "multi-select" }>;
                      const options = p.options.filter((o) => o !== option);
                      let optionColors = p.optionColors;
                      if (optionColors && option in optionColors) {
                        const next = { ...optionColors };
                        delete next[option];
                        optionColors =
                          Object.keys(next).length > 0 ? next : undefined;
                      }
                      let optionDescriptions = p.optionDescriptions;
                      if (
                        optionDescriptions &&
                        option in optionDescriptions
                      ) {
                        const next = { ...optionDescriptions };
                        delete next[option];
                        optionDescriptions =
                          Object.keys(next).length > 0 ? next : undefined;
                      }
                      const patch = {
                        options,
                        optionColors,
                        optionDescriptions,
                      } as Partial<KbProperty>;
                      if (p.type === "select") {
                        (patch as { value?: string | null }).value =
                          p.value === option ? null : p.value;
                      } else {
                        (patch as { value?: string[] }).value =
                          p.value.filter((v) => v !== option);
                      }
                      updateProperty(prop.id, patch);
                    }}
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
                    onChangeNumberView={(view) =>
                      changeNumberView(prop.id, view)
                    }
                    onChangeNumberDecimals={(decimals) =>
                      changeNumberDecimals(prop.id, decimals)
                    }
                    onChangeDateFormat={(fmt) =>
                      updateProperty(prop.id, {
                        dateFormat: fmt,
                      } as Partial<KbProperty>)
                    }
                    onRemove={() => removeProperty(prop.id)}
                    onDuplicate={() => duplicateProperty(prop.id)}
                    onChangeType={(t) => changePropertyType(prop.id, t)}
                    onChangeRatingColor={(c) => changeRatingColor(prop.id, c)}
                    onChangeRatingShowValue={(s) => changeRatingShowValue(prop.id, s)}
                    onChangeOptionSort={(sort) =>
                      updateProperty(prop.id, {
                        optionSort: sort,
                      } as Partial<KbProperty>)
                    }
                    onChangeOptionDescriptions={(d) =>
                      updateProperty(prop.id, {
                        optionDescriptions: d,
                      } as Partial<KbProperty>)
                    }
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
        <div className="flex min-h-8 items-center gap-2 pt-1.5">
          {canEdit ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-1.5 -ml-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Plus className="size-3.5" />
                  {collectionGroups.length > 0
                    ? "Добавить свойство страницы"
                    : "Добавить свойство"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[220px]">
                <div className="px-2 py-1.5 text-[12px] font-medium text-muted-foreground/70">
                  Добавить свойство
                </div>
                <DropdownMenuSeparator />
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
              className="h-7 px-1.5 -ml-1.5 text-xs text-muted-foreground opacity-40"
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
  /** Rename опции select/multi-select: атомарно мигрирует options +
   *  optionColors + текущее value. */
  onRenameOption: (from: string, to: string) => void;
  /** Delete опции select/multi-select: атомарно чистит options +
   *  optionColors + reconcile'ит value. */
  onRemoveOption: (option: string) => void;
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
  /** Единый «Вид» number: Число / Звёзды / Слайдер. */
  onChangeNumberView: (view: "number" | "stars" | "slider") => void;
  /** Округление number при отображении. undefined = «Авто». */
  onChangeNumberDecimals: (decimals: number | undefined) => void;
  /** Формат отображения даты: full / short / relative. */
  onChangeDateFormat: (fmt: "full" | "short" | "relative") => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onChangeType: (type: KbPropertyType) => void;
  /** Цвет звёзд / слайдера. null = amber-default. */
  onChangeRatingColor: (color: KbPropertyColor | null) => void;
  /** Показывать / скрывать числовой лейбл рядом со слайдером. */
  onChangeRatingShowValue: (show: boolean) => void;
  /** Порядок вариантов select/multi-select: manual / alpha / alpha-desc. */
  onChangeOptionSort: (sort: "manual" | "alpha" | "alpha-desc") => void;
  /** Per-option описания select/multi-select. */
  onChangeOptionDescriptions: (
    d: Partial<Record<string, string>> | undefined,
  ) => void;
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
    <li className="group/collection-row flex min-h-[36px] items-center gap-2 rounded-md py-1">
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
        <span className="w-[168px] shrink-0 truncate text-[13px] text-muted-foreground">
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
  onRenameOption,
  onRemoveOption,
  onChangeIcon,
  onChangeDescription,
  onToggleCollapse,
  onChangeUnit,
  onChangeRatingScale,
  onChangeDisplayVariant,
  onChangeNumberView,
  onChangeNumberDecimals,
  onChangeDateFormat,
  onRemove,
  onDuplicate,
  onChangeType,
  onChangeRatingColor,
  onChangeRatingShowValue,
  onChangeOptionSort,
  onChangeOptionDescriptions,
}: PropertyRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);

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
        "group/row relative flex items-start gap-2 min-h-[36px] py-1 rounded-md",
        // Subtle background ТОЛЬКО на active-drag (визуальный feedback
        // reorder'а). Фоновая подсветка всего ряда специально НЕ
        // ставим — только label с именем (просьба юзера, см. ниже).
        isDragging && "bg-muted/60 shadow-sm",
      )}
    >
      {/* Grip живёт в левом «жёлобе» (absolute, вне flow) — иконка
       *  свойства встаёт ровно под левым краем заголовка страницы,
       *  без сдвига от ручки перетаскивания. */}
      {canEdit && (
        <button
          type="button"
          aria-label="Перетащить свойство"
          className="absolute right-full top-2 mr-1 size-5
                     flex items-center justify-center text-muted-foreground/40
                     cursor-grab active:cursor-grabbing
                     opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100
                     hover:text-foreground transition-opacity"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5" />
        </button>
      )}
      {/* Label area: icon + name. Hover-bg ТОЛЬКО здесь (Notion-style —
       *  юзер хочет подсветку имени, не всего ряда). Заметная подсветка
       *  через `bg-foreground/10` — работает одинаково ярко на light /
       *  dark theme'ах, в отличие от `bg-accent` (которая в light тонет). */}
      {/* Label = trigger меню настроек свойства (клик по имени).
       *  Иконка — отдельная кнопка (свой пикер), не вложена в trigger. */}
      <PropertyLabelTrigger
        property={property}
        canEdit={canEdit}
        onChangeIcon={onChangeIcon}
        onOpenMenu={() => setMenuOpen(true)}
      />
      <div className="flex-1 min-w-0">
        <PropertyValueControl
          property={property}
          canEdit={canEdit}
          onChangeValue={onChangeValue}
          onChangeOptions={onChangeOptions}
          onChangeOptionColors={onChangeOptionColors}
          onChangeOptionDescriptions={onChangeOptionDescriptions}
          onRenameOption={onRenameOption}
          onRemoveOption={onRemoveOption}
        />
      </div>
      {canEdit && (
        <>
          {/* Primary context menu: Редактировать / Дублировать / Удалить */}
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <span className="pointer-events-none absolute left-0 top-1/2 size-px" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[180px]">
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setMenuOpen(false);
                  setEditorOpen(true);
                }}
              >
                <Pencil className="size-3.5 text-muted-foreground" />
                Редактировать
                <ChevronRight className="ml-auto size-3.5 text-muted-foreground/60" />
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onDuplicate}>
                <KB_PROPERTY_UI_ICONS.duplicate className="size-3.5 text-muted-foreground" />
                Дублировать
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={onRemove}
              >
                <KB_PROPERTY_UI_ICONS.delete className="size-3.5" />
                Удалить
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Editor popover — открывается из «Редактировать» */}
          <PropertyEditorPopover
            open={editorOpen}
            onOpenChange={setEditorOpen}
            property={property}
            canEdit={canEdit}
            onRename={onRename}
            onChangeIcon={onChangeIcon}
            onChangeDescription={onChangeDescription}
            onChangeType={onChangeType}
            onChangeUnit={onChangeUnit}
            onChangeRatingScale={onChangeRatingScale}
            onChangeDisplayVariant={onChangeDisplayVariant}
            onChangeNumberView={onChangeNumberView}
            onChangeNumberDecimals={onChangeNumberDecimals}
            onChangeDateFormat={onChangeDateFormat}
            onToggleCollapse={onToggleCollapse}
            onChangeOptions={onChangeOptions}
            onChangeOptionColors={onChangeOptionColors}
            onRenameOption={onRenameOption}
            onRemoveOption={onRemoveOption}
            onChangeRatingColor={onChangeRatingColor}
            onChangeRatingShowValue={onChangeRatingShowValue}
            onChangeOptionSort={onChangeOptionSort}
            onChangeOptionDescriptions={onChangeOptionDescriptions}
          />
        </>
      )}
    </li>
  );
}

/** Pill «иконка + имя». Имя — кнопка, открывающая меню настроек
 *  свойства (Notion-style: клик по свойству, без ⋯ справа). Иконка —
 *  отдельная кнопка (свой пикер), не вложена в кнопку имени. Без
 *  отрицательного сдвига контента — иконка встаёт ровно под левым
 *  краем заголовка страницы. */
function PropertyLabelTrigger({
  property,
  canEdit,
  onChangeIcon,
  onOpenMenu,
}: {
  property: KbProperty;
  canEdit: boolean;
  onChangeIcon: (icon: string | null, iconColor: string | null) => void;
  onOpenMenu: () => void;
}) {
  const desc = property.description?.trim();
  const nameEl = canEdit ? (
    <button
      type="button"
      onClick={onOpenMenu}
      className="w-[168px] shrink-0 truncate text-left text-[13px]
                 text-muted-foreground outline-none transition-colors
                 hover:text-foreground"
      aria-label="Настройки свойства"
    >
      {property.name}
    </button>
  ) : (
    <span className="w-[168px] shrink-0 truncate text-[13px] text-muted-foreground">
      {property.name}
    </span>
  );

  const row = (
    <div
      className="flex items-center gap-2 -ml-1.5 rounded-md px-1.5 py-1
                 transition-colors hover:bg-foreground/[0.06] dark:hover:bg-foreground/10"
    >
      <PropertyIconButton
        property={property}
        canEdit={canEdit}
        onChangeIcon={onChangeIcon}
      />
      {nameEl}
    </div>
  );

  if (!desc) return row;

  // Триггер тултипа — весь label-блок (иконка + имя), поэтому подсказка
  // встаёт слева от иконки и не перекрывает её / меню (Notion-style).
  return (
    <Tooltip>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent
        side="left"
        align="center"
        sideOffset={24}
        collisionPadding={8}
        className="max-w-[300px]"
      >
        <div className="grid gap-0.5">
          <strong className="font-semibold leading-tight">
            {property.name}
          </strong>
          <span className="font-normal leading-snug text-neutral-200">
            {desc}
          </span>
        </div>
      </TooltipContent>
    </Tooltip>
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
        "flex items-start gap-2 min-h-[36px] py-1 rounded-md",
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
        <span className="w-[168px] shrink-0 text-[13px] text-muted-foreground">
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
  onChangeOptionDescriptions,
  onRenameOption,
  onRemoveOption,
}: {
  property: KbProperty;
  canEdit: boolean;
  canEditOptions?: boolean;
  onChangeValue: (value: KbProperty["value"]) => void;
  onChangeOptions: (options: string[]) => void;
  onChangeOptionColors: (
    optionColors: Partial<Record<string, KbPropertyColor>> | undefined,
  ) => void;
  onChangeOptionDescriptions?: (
    d: Partial<Record<string, string>> | undefined,
  ) => void;
  onRenameOption?: (from: string, to: string) => void;
  onRemoveOption?: (option: string) => void;
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
      return (
        <DateValueControl
          value={property.value}
          canEdit={canEdit}
          format={property.dateFormat ?? "full"}
          onChange={onChangeValue}
        />
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
        onChangeOptionDescriptions={onChangeOptionDescriptions}
        onRenameOption={onRenameOption}
        onRemoveOption={onRemoveOption}
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
        color={property.ratingColor}
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
        onChangeOptionDescriptions={onChangeOptionDescriptions}
        onRenameOption={onRenameOption}
        onRemoveOption={onRemoveOption}
      />;
  }
}

/** Текстовое значение property:
 *  - `collapsed = false` (default): textarea, растущая по содержимому
 *    (auto-grow на каждое изменение).
 *  - `collapsed = true`: single-line `<input>` с overflow-ellipsis.
 *    Toggle переключается через ⋯ menu (см. PropertyRow). */
