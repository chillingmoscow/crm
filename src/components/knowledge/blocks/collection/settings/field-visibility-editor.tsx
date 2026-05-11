"use client";

import { useState } from "react";

import { GripVertical } from "lucide-react";

import { KbPageIcon } from "@/components/knowledge/kb-page-icon";
import { KB_PROPERTY_UI_ICONS } from "@/components/knowledge/property-ui-icons";
import { Input } from "@/components/ui/input";
import {
  isCollectionFieldVisible,
  type KbCollectionField,
  type KbCollectionVisibleFieldIds,
} from "@/lib/knowledge/collection";
import type { FieldDropPlacement } from "@/lib/knowledge/collection-fields";

import {
  FIELD_ICONS,
  collectionFieldMenuLabel,
  stopBlockInteraction,
  stopBlockMenuAction,
} from "../shared";

export function CollectionFieldVisibilityEditor({
  fields,
  visibleFieldIds,
  onReorder,
  onVisibleChange,
}: {
  fields: KbCollectionField[];
  visibleFieldIds: KbCollectionVisibleFieldIds;
  onReorder: (
    activeId: string,
    targetId: string,
    placement?: FieldDropPlacement,
  ) => void;
  onVisibleChange: (id: string, visible: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleFields = fields.filter((field) =>
    isCollectionFieldVisible(field.id, visibleFieldIds),
  );
  const hiddenFields = fields.filter(
    (field) => !isCollectionFieldVisible(field.id, visibleFieldIds),
  );
  const matchesQuery = (field: KbCollectionField) => {
    if (!normalizedQuery) return true;
    return collectionFieldMenuLabel(field).toLowerCase().includes(normalizedQuery);
  };

  const renderRow = (field: KbCollectionField, visible: boolean) => {
    const Icon = FIELD_ICONS[field.type];
    return (
      <div
        key={field.id}
        className="kb-collection-property-visibility-row"
        draggable
        onDragStart={(event) => {
          event.stopPropagation();
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", field.id);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const activeId = event.dataTransfer.getData("text/plain");
          if (activeId && activeId !== field.id) onReorder(activeId, field.id, "before");
        }}
      >
        <GripVertical className="kb-collection-property-visibility-drag size-4" />
        {field.icon ? (
          <KbPageIcon
            icon={field.icon}
            color={field.iconColor ?? null}
            className="size-4 text-muted-foreground"
          />
        ) : (
          <Icon className="size-4 text-muted-foreground" />
        )}
        <span className="kb-collection-property-visibility-name">
          {collectionFieldMenuLabel(field)}
        </span>
        <button
          type="button"
          className="kb-collection-property-visibility-toggle"
          aria-label={visible ? "Скрыть свойство" : "Показать свойство"}
          onPointerDown={stopBlockInteraction}
          onMouseDown={stopBlockInteraction}
          onClick={(event) => {
            stopBlockMenuAction(event);
            onVisibleChange(field.id, !visible);
          }}
        >
          {visible ? (
            <KB_PROPERTY_UI_ICONS.visibility className="size-4" />
          ) : (
            <KB_PROPERTY_UI_ICONS.hidden className="size-4" />
          )}
        </button>
      </div>
    );
  };

  const shownRows = visibleFields.filter(matchesQuery);
  const hiddenRows = hiddenFields.filter(matchesQuery);

  if (fields.length === 0) {
    return (
      <div className="kb-collection-settings-empty">
        Добавьте свойства в таблице, чтобы управлять их отображением в виде.
      </div>
    );
  }

  return (
    <div className="kb-collection-property-visibility-editor">
      <Input
        value={query}
        placeholder="Найти свойство..."
        className="kb-collection-property-visibility-search"
        aria-label="Найти свойство"
        onPointerDown={stopBlockInteraction}
        onMouseDown={stopBlockInteraction}
        onClick={stopBlockInteraction}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <div className="kb-collection-property-visibility-section">
        <div className="kb-collection-property-visibility-heading">
          <span>Показаны</span>
          {visibleFields.length > 0 && (
            <button
              type="button"
              onPointerDown={stopBlockInteraction}
              onMouseDown={stopBlockInteraction}
              onClick={(event) => {
                stopBlockMenuAction(event);
                visibleFields.forEach((field) => onVisibleChange(field.id, false));
              }}
            >
              Скрыть все
            </button>
          )}
        </div>
        {shownRows.length === 0 ? (
          <div className="kb-collection-property-visibility-empty">
            Нет показанных свойств
          </div>
        ) : (
          shownRows.map((field) => renderRow(field, true))
        )}
      </div>
      <div className="kb-collection-property-visibility-section">
        <div className="kb-collection-property-visibility-heading">
          <span>Скрыты</span>
          {hiddenFields.length > 0 && (
            <button
              type="button"
              onPointerDown={stopBlockInteraction}
              onMouseDown={stopBlockInteraction}
              onClick={(event) => {
                stopBlockMenuAction(event);
                hiddenFields.forEach((field) => onVisibleChange(field.id, true));
              }}
            >
              Показать все
            </button>
          )}
        </div>
        {hiddenRows.length === 0 ? (
          <div className="kb-collection-property-visibility-empty">
            Нет скрытых свойств
          </div>
        ) : (
          hiddenRows.map((field) => renderRow(field, false))
        )}
      </div>
    </div>
  );
}
