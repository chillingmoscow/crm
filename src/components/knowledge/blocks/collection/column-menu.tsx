"use client";

import { useEffect, useState } from "react";

import {
  ArrowDownAZ,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Pin,
  Type,
  WrapText,
} from "lucide-react";

import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { KbIconPickerBody } from "@/components/knowledge/kb-icon-picker";
import { KB_PROPERTY_UI_ICONS } from "@/components/knowledge/property-ui-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  KB_COLLECTION_CREATABLE_FIELD_TYPES,
  KB_COLLECTION_FIELD_LABELS,
  type KbCollectionField,
} from "@/lib/knowledge/collection";
import {
  collectionFieldTypeOptions,
  type FieldDropPlacement,
} from "@/lib/knowledge/collection-fields";
import type { KbCollectionSortDirection } from "@/lib/knowledge/collection-sort";
import type { KbPropertyType } from "@/types/knowledge";

import {
  FIELD_ICONS,
  stopBlockInteraction,
  stopBlockMenuAction,
} from "./shared";

export function CollectionTitleColumnMenu({
  name,
  pinned,
  wrap,
  onRename,
  onPinnedChange,
  onWrapChange,
  onInsertRight,
}: {
  name: string;
  pinned: boolean;
  wrap: boolean;
  onRename: (name: string) => void;
  onPinnedChange: (pinned: boolean) => void;
  onWrapChange: (wrap: boolean) => void;
  onInsertRight: (type: KbPropertyType, name: string) => void;
}) {
  const [panel, setPanel] = useState<"root" | "after">("root");
  const [nameDraft, setNameDraft] = useState(name);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<KbPropertyType>("text");

  useEffect(() => {
    setNameDraft(name);
  }, [name]);

  const commitName = () => {
    const nextName = nameDraft.trim() || "Страница";
    setNameDraft(nextName);
    onRename(nextName);
  };

  if (panel === "after") {
    return (
      <CollectionColumnInsertPanel
        placement="after"
        name={newFieldName}
        type={newFieldType}
        onBack={() => setPanel("root")}
        onNameChange={setNewFieldName}
        onTypeChange={setNewFieldType}
        onCreate={() => onInsertRight(newFieldType, newFieldName)}
      />
    );
  }

  return (
    <div className="kb-collection-column-menu-panel">
      <div className="kb-collection-column-menu-name">
        <Type className="size-4" />
        <Input
          value={nameDraft}
          onChange={(event) => setNameDraft(event.currentTarget.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitName();
              event.currentTarget.blur();
            }
          }}
          className="h-9 min-w-0 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
          aria-label="Название колонки страницы"
        />
      </div>
      <button
        type="button"
        className="kb-collection-column-menu-row"
        onClick={(event) => {
          stopBlockMenuAction(event);
          onPinnedChange(!pinned);
        }}
      >
        <Pin className="size-4" />
        <span>{pinned ? "Открепить" : "Закрепить"}</span>
        {pinned && <Check className="size-4" />}
      </button>
      <button
        type="button"
        className="kb-collection-column-menu-row"
        onClick={(event) => {
          stopBlockMenuAction(event);
          onWrapChange(!wrap);
        }}
      >
        <WrapText className="size-4" />
        <span>Сворачивать текст</span>
        {wrap && <Check className="size-4" />}
      </button>
      <div className="kb-collection-column-menu-separator" />
      <button
        type="button"
        className="kb-collection-column-menu-row"
        onClick={(event) => {
          stopBlockMenuAction(event);
          setPanel("after");
        }}
      >
        <ArrowRight className="size-4" />
        <span>Вставить справа</span>
        <span />
      </button>
    </div>
  );
}

export function CollectionColumnMenu({
  field,
  visible,
  onUpdate,
  onRemove,
  onDuplicate,
  onSort,
  onInsert,
  onVisibleChange,
}: {
  field: KbCollectionField;
  visible: boolean;
  onUpdate: (patch: Partial<KbCollectionField>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onSort: (direction: KbCollectionSortDirection) => void;
  onInsert: (
    type: KbPropertyType,
    name: string,
    placement: FieldDropPlacement,
  ) => void;
  onVisibleChange: (visible: boolean) => void;
}) {
  const [panel, setPanel] = useState<
    "root" | FieldDropPlacement | "sort" | "icon"
  >("root");
  const [name, setName] = useState(field.name);
  const [descriptionDraft, setDescriptionDraft] = useState(
    field.description ?? "",
  );
  const [descriptionOpen, setDescriptionOpen] = useState(
    Boolean(field.description),
  );
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<KbPropertyType>("text");

  useEffect(() => {
    setName(field.name);
  }, [field.id, field.name]);
  useEffect(() => {
    setDescriptionDraft(field.description ?? "");
  }, [field.id, field.description]);
  // Sync `descriptionOpen` ONLY when switching to a different field, not
  // when the user edits the current field's description. Including
  // `field.description` here would slam the input closed on every
  // keystroke (or reopen it as soon as it gets a non-empty value).
  useEffect(() => {
    setDescriptionOpen(Boolean(field.description));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: re-sync only on field id change
  }, [field.id]);

  const commitName = () => {
    const nextName = name.trim();
    setName(nextName);
    if (nextName !== field.name) onUpdate({ name: nextName });
  };
  const commitDescription = (value = descriptionDraft) => {
    const nextDescription = value.trim().slice(0, 280);
    setDescriptionDraft(nextDescription);
    onUpdate({ description: nextDescription || undefined });
  };

  if (panel !== "root") {
    if (panel === "icon") {
      return (
        <div className="kb-collection-column-menu-panel">
          <div className="kb-collection-column-insert-head">
            <button
              type="button"
              className="kb-collection-settings-back"
              aria-label="Назад"
              onClick={(event) => {
                stopBlockMenuAction(event);
                setPanel("root");
              }}
            >
              <ArrowLeft className="size-4" />
            </button>
            <div className="kb-collection-column-insert-subtitle">
              Иконка свойства
            </div>
          </div>
          <div className="kb-collection-inline-icon-picker">
            <KbIconPickerBody
              value={field.icon ?? null}
              color={field.iconColor ?? null}
              onChange={(next) =>
                onUpdate({
                  icon: next.icon ?? undefined,
                  iconColor: next.color ?? undefined,
                })
              }
              onCommitClose={() => setPanel("root")}
            />
          </div>
        </div>
      );
    }

    if (panel === "sort") {
      return (
        <div className="kb-collection-column-menu-panel">
          <div className="kb-collection-column-insert-head">
            <button
              type="button"
              className="kb-collection-settings-back"
              aria-label="Назад"
              onClick={(event) => {
                stopBlockMenuAction(event);
                setPanel("root");
              }}
            >
              <ArrowLeft className="size-4" />
            </button>
            <div className="kb-collection-column-insert-subtitle">
              Сортировать
            </div>
          </div>
          <button
            type="button"
            className="kb-collection-column-menu-row"
            onClick={(event) => {
              stopBlockMenuAction(event);
              onSort("asc");
            }}
          >
            <ArrowDownAZ className="size-4" />
            <span>По возрастанию</span>
            <span />
          </button>
          <button
            type="button"
            className="kb-collection-column-menu-row"
            onClick={(event) => {
              stopBlockMenuAction(event);
              onSort("desc");
            }}
          >
            <ArrowDownAZ className="size-4 rotate-180" />
            <span>По убыванию</span>
            <span />
          </button>
        </div>
      );
    }

    return (
      <CollectionColumnInsertPanel
        placement={panel}
        name={newFieldName}
        type={newFieldType}
        onBack={() => setPanel("root")}
        onNameChange={setNewFieldName}
        onTypeChange={setNewFieldType}
        onCreate={() => onInsert(newFieldType, newFieldName, panel)}
      />
    );
  }

  return (
    <div className="kb-collection-column-menu-panel">
      <div className="kb-collection-column-menu-name">
        <button
          type="button"
          className="kb-collection-view-icon-picker"
          aria-label="Изменить иконку свойства"
          onPointerDown={stopBlockInteraction}
          onMouseDown={stopBlockInteraction}
          onClick={(event) => {
            stopBlockMenuAction(event);
            setPanel("icon");
          }}
        >
          {field.icon ? (
            <KbPageIcon
              icon={field.icon}
              color={field.iconColor ?? null}
              size={18}
            />
          ) : (
            (() => {
              const Icon = FIELD_ICONS[field.type];
              return <Icon className="size-4 text-muted-foreground" />;
            })()
          )}
        </button>
        <Input
          value={name}
          placeholder="Свойство"
          onChange={(event) => setName(event.currentTarget.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          className="h-9 min-w-0 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
          aria-label="Название свойства"
        />
        <button
          type="button"
          className={cn(
            "kb-collection-view-description-trigger",
            field.description && "text-foreground",
          )}
          aria-label="Описание свойства"
          onPointerDown={stopBlockInteraction}
          onMouseDown={stopBlockInteraction}
          onClick={(event) => {
            stopBlockMenuAction(event);
            setDescriptionOpen((current) => !current);
          }}
        >
          <KB_PROPERTY_UI_ICONS.description className="size-4" />
        </button>
      </div>
      {descriptionOpen && (
        <Input
          value={descriptionDraft}
          placeholder="Добавить описание..."
          className="kb-collection-column-description-input"
          aria-label="Описание свойства"
          onPointerDown={stopBlockInteraction}
          onMouseDown={stopBlockInteraction}
          onClick={stopBlockInteraction}
          onChange={(event) => setDescriptionDraft(event.currentTarget.value)}
          onBlur={(event) => commitDescription(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitDescription(event.currentTarget.value);
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setDescriptionDraft(field.description ?? "");
              event.currentTarget.blur();
            }
          }}
        />
      )}
      <label className="kb-collection-column-menu-row">
        <KB_PROPERTY_UI_ICONS.type className="size-4" />
        <span>Тип</span>
        <select
          className="kb-collection-column-menu-select"
          value={field.type}
          aria-label="Тип свойства"
          onChange={(event) =>
            onUpdate({ type: event.currentTarget.value as KbPropertyType })
          }
        >
          {collectionFieldTypeOptions(field.type).map((type) => (
            <option key={type} value={type}>
              {KB_COLLECTION_FIELD_LABELS[type]}
            </option>
          ))}
        </select>
      </label>
      {field.type === "number" && (
        <>
          <label className="kb-collection-column-menu-row">
            <KB_PROPERTY_UI_ICONS.display className="size-4" />
            <span>Вид</span>
            <select
              className="kb-collection-column-menu-select"
              value={field.displayVariant === "rating" ? "rating" : "number"}
              aria-label="Вид числа"
              onChange={(event) =>
                onUpdate({
                  displayVariant:
                    event.currentTarget.value === "rating"
                      ? "rating"
                      : undefined,
                  ratingVariant:
                    event.currentTarget.value === "rating"
                      ? field.ratingVariant ?? "stars"
                      : undefined,
                  ratingShowValue:
                    event.currentTarget.value === "rating"
                      ? field.ratingShowValue ?? true
                      : undefined,
                  max:
                    event.currentTarget.value === "rating"
                      ? field.max ?? 5
                      : undefined,
                })
              }
            >
              <option value="number">Число</option>
              <option value="rating">Рейтинг</option>
            </select>
          </label>
          {field.displayVariant === "rating" && (
            <>
              <label className="kb-collection-column-menu-row">
                <KB_PROPERTY_UI_ICONS.scale className="size-4" />
                <span>Максимум</span>
                <select
                  className="kb-collection-column-menu-select"
                  value={field.max ?? 5}
                  aria-label="Максимум рейтинга"
                  onChange={(event) =>
                    onUpdate({
                      max: Number(event.currentTarget.value) as 3 | 5 | 10,
                    })
                  }
                >
                  {[3, 5, 10].map((max) => (
                    <option key={max} value={max}>
                      {max}
                    </option>
                  ))}
                </select>
              </label>
              <label className="kb-collection-column-menu-row">
                <KB_PROPERTY_UI_ICONS.rating className="size-4" />
                <span>Рейтинг</span>
                <select
                  className="kb-collection-column-menu-select"
                  value={field.ratingVariant ?? "stars"}
                  aria-label="Вид рейтинга"
                  onChange={(event) =>
                    onUpdate({
                      ratingVariant: event.currentTarget.value as "stars" | "slider",
                    })
                  }
                >
                  <option value="stars">Звёзды</option>
                  <option value="slider">Слайдер</option>
                </select>
              </label>
              {field.ratingVariant === "slider" && (
                <button
                  type="button"
                  className="kb-collection-column-menu-row"
                  onClick={(event) => {
                    stopBlockMenuAction(event);
                    onUpdate({
                      ratingShowValue: field.ratingShowValue === false,
                    });
                  }}
                >
                  <KB_PROPERTY_UI_ICONS.showValue className="size-4" />
                  <span>Показывать число</span>
                  {(field.ratingShowValue ?? true) && (
                    <Check className="size-4" />
                  )}
                </button>
              )}
            </>
          )}
        </>
      )}
      {field.type === "checkbox" && (
        <label className="kb-collection-column-menu-row">
          <KB_PROPERTY_UI_ICONS.display className="size-4" />
          <span>Вид</span>
          <select
            className="kb-collection-column-menu-select"
            value={field.displayVariant === "switch" ? "switch" : "checkbox"}
            aria-label="Вид чекбокса"
            onChange={(event) =>
              onUpdate({
                displayVariant:
                  event.currentTarget.value === "switch"
                    ? "switch"
                    : undefined,
              })
            }
          >
            <option value="checkbox">Чекбокс</option>
            <option value="switch">Триггер</option>
          </select>
        </label>
      )}
      {field.type === "text" && (
        <button
          type="button"
          className="kb-collection-column-menu-row"
          onClick={(event) => {
            stopBlockMenuAction(event);
            onUpdate({ collapsed: !field.collapsed });
          }}
        >
          <WrapText className="size-4" />
          <span>Сворачивать текст</span>
          {field.collapsed && <Check className="size-4" />}
        </button>
      )}
      {field.type === "url" && (
        <button
          type="button"
          className="kb-collection-column-menu-row"
          onClick={(event) => {
            stopBlockMenuAction(event);
            onUpdate({ urlCollapsed: !field.urlCollapsed });
          }}
        >
          <WrapText className="size-4" />
          <span>Сокращать ссылку</span>
          {field.urlCollapsed && <Check className="size-4" />}
        </button>
      )}
      <button
        type="button"
        className="kb-collection-column-menu-row"
        onClick={(event) => {
          stopBlockMenuAction(event);
          onVisibleChange(!visible);
        }}
      >
        {visible ? (
          <KB_PROPERTY_UI_ICONS.hidden className="size-4" />
        ) : (
          <KB_PROPERTY_UI_ICONS.visibility className="size-4" />
        )}
        <span>{visible ? "Скрыть" : "Показать"}</span>
      </button>
      <div className="kb-collection-column-menu-separator" />
      <button
        type="button"
        className="kb-collection-column-menu-row"
        onClick={(event) => {
          stopBlockMenuAction(event);
          onDuplicate();
        }}
      >
        <KB_PROPERTY_UI_ICONS.duplicate className="size-4" />
        <span>Дублировать</span>
        <span />
      </button>
      <button
        type="button"
        className="kb-collection-column-menu-row"
        onClick={(event) => {
          stopBlockMenuAction(event);
          setPanel("sort");
        }}
      >
        <KB_PROPERTY_UI_ICONS.sort className="size-4" />
        <span>Сортировать</span>
        <ChevronRight className="size-4" />
      </button>
      <button
        type="button"
        className="kb-collection-column-menu-row"
        onClick={(event) => {
          stopBlockMenuAction(event);
          setPanel("before");
        }}
      >
        <ArrowLeft className="size-4" />
        <span>Вставить слева</span>
      </button>
      <button
        type="button"
        className="kb-collection-column-menu-row"
        onClick={(event) => {
          stopBlockMenuAction(event);
          setPanel("after");
        }}
      >
        <ArrowRight className="size-4" />
        <span>Вставить справа</span>
      </button>
      <button
        type="button"
        className="kb-collection-column-menu-row text-destructive"
        onClick={(event) => {
          stopBlockMenuAction(event);
          onRemove();
        }}
      >
        <KB_PROPERTY_UI_ICONS.delete className="size-4" />
        <span>Удалить свойство</span>
      </button>
    </div>
  );
}

function CollectionColumnInsertPanel({
  placement,
  name,
  type,
  onBack,
  onNameChange,
  onTypeChange,
  onCreate,
}: {
  placement: FieldDropPlacement;
  name: string;
  type: KbPropertyType;
  onBack: () => void;
  onNameChange: (name: string) => void;
  onTypeChange: (type: KbPropertyType) => void;
  onCreate: () => void;
}) {
  const ActiveIcon = FIELD_ICONS[type];
  // На тач-устройствах не автофокусим поле имени — иначе при открытии панели
  // вставки колонки сразу всплывает экранная клавиатура. На desktop фокус
  // удобен (можно сразу печатать). ВАЖНО: значение нужно знать СИНХРОННО на
  // первом рендере — `autoFocus` применяется только при mount'е. Хук
  // useIsMobile() инициализируется как false и обновляется лишь в effect'е,
  // т.е. на первом рендере дал бы autoFocus=true и клавиатуру всё равно (Codex
  // P1 #443). Поэтому читаем pointer-режим из matchMedia в lazy-инициализаторе
  // useState — он отрабатывает синхронно на mount'е. Заодно гейт по input-mode
  // корректнее ширины экрана (тач-планшет > 768px тоже тач).
  const [coarsePointer] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(hover: none), (pointer: coarse)").matches,
  );

  return (
    <div className="kb-collection-column-insert-panel">
      <div className="kb-collection-column-insert-head">
        <button
          type="button"
          className="kb-collection-settings-back"
          aria-label="Назад"
          onClick={(event) => {
            stopBlockMenuAction(event);
            onBack();
          }}
        >
          <ArrowLeft className="size-4" />
        </button>
        <div className="kb-collection-settings-panel-title">
          {placement === "before" ? "Колонка слева" : "Колонка справа"}
        </div>
      </div>
      <div className="kb-collection-column-menu-name">
        <ActiveIcon className="size-4" />
        <Input
          value={name}
          autoFocus={!coarsePointer}
          onChange={(event) => onNameChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onCreate();
            }
          }}
          className="h-9 min-w-0 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
          placeholder="Название свойства"
          aria-label="Название нового свойства"
        />
      </div>
      <div className="kb-collection-column-insert-subtitle">
        Выберите тип
      </div>
      <div className="kb-collection-column-type-grid">
        {KB_COLLECTION_CREATABLE_FIELD_TYPES.map((fieldType) => {
          const Icon = FIELD_ICONS[fieldType];
          const active = type === fieldType;
          return (
            <button
              key={fieldType}
              type="button"
              className="kb-collection-column-type-option"
              data-active={active || undefined}
              onClick={(event) => {
                stopBlockMenuAction(event);
                onTypeChange(fieldType);
              }}
            >
              <Icon className="size-4" />
              <span>{KB_COLLECTION_FIELD_LABELS[fieldType]}</span>
              {active && <Check className="ml-auto size-4" />}
            </button>
          );
        })}
      </div>
      <Button
        type="button"
        size="sm"
        className="kb-collection-column-create-btn"
        onClick={(event) => {
          stopBlockMenuAction(event);
          onCreate();
        }}
      >
        Создать свойство
      </Button>
    </div>
  );
}
