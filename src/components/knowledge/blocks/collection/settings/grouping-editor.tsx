"use client";

import { ArrowDownAZ, Trash2 } from "lucide-react";

import { KB_PROPERTY_UI_ICONS } from "@/components/knowledge/property-ui-icons";
import type { KbCollectionField } from "@/lib/knowledge/collection";
import { sortDirectionLabel } from "@/lib/knowledge/collection-format";
import {
  createCollectionGrouping,
  type KbCollectionGrouping,
} from "@/lib/knowledge/collection-group";
import type { KbCollectionSortDirection } from "@/lib/knowledge/collection-sort";

import { stopBlockInteraction, stopBlockMenuAction } from "../shared";
import { CollectionFieldSelect } from "./field-select";

export function CollectionGroupingEditor({
  fields,
  grouping,
  onChange,
}: {
  fields: KbCollectionField[];
  grouping: KbCollectionGrouping | null;
  onChange: (grouping: KbCollectionGrouping | null) => void;
}) {
  const currentField = fields.find((field) => field.id === grouping?.fieldId);
  const direction = grouping?.direction ?? "asc";

  if (fields.length === 0) {
    return (
      <div className="kb-collection-settings-empty">
        Добавьте свойства, чтобы группировать записи.
      </div>
    );
  }

  return (
    <div className="kb-collection-grouping-editor">
      <div className="kb-collection-grouping-row">
        <KB_PROPERTY_UI_ICONS.grouping className="size-4 text-muted-foreground" />
        <CollectionFieldSelect
          fields={fields}
          value={currentField?.id ?? ""}
          placeholder="Выбрать свойство"
          emptyLabel="Без группировки"
          searchPlaceholder="Найти свойство..."
          onChange={(fieldId) => {
            onChange(fieldId ? createCollectionGrouping(fieldId, direction) : null);
          }}
        />
      </div>
      {currentField ? (
        <>
          <div className="kb-collection-grouping-row">
            <ArrowDownAZ className="size-4 text-muted-foreground" />
            <select
              className="kb-collection-grouping-select"
              value={direction}
              aria-label="Направление группировки"
              onChange={(event) =>
                onChange(
                  createCollectionGrouping(
                    currentField.id,
                    event.currentTarget.value as KbCollectionSortDirection,
                  ),
                )
              }
            >
              <option value="asc">
                {sortDirectionLabel(currentField, "asc")}
              </option>
              <option value="desc">
                {sortDirectionLabel(currentField, "desc")}
              </option>
            </select>
          </div>
          <button
            type="button"
            className="kb-collection-settings-nav-row text-destructive"
            onPointerDown={stopBlockInteraction}
            onMouseDown={stopBlockInteraction}
            onClick={(event) => {
              stopBlockMenuAction(event);
              onChange(null);
            }}
          >
            <Trash2 className="size-4" />
            <span>Убрать группировку</span>
            <span />
            <span />
          </button>
        </>
      ) : (
        <div className="kb-collection-settings-empty">
          Вид показывает записи без группировки.
        </div>
      )}
    </div>
  );
}
