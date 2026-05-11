"use client";

import {
  KB_COLLECTION_CREATABLE_FIELD_TYPES,
  KB_COLLECTION_FIELD_LABELS,
} from "@/lib/knowledge/collection";
import type { KbPropertyType } from "@/types/knowledge";

import { FIELD_ICONS, stopBlockMenuAction } from "./shared";

export function CollectionAddFieldMenu({
  onAdd,
}: {
  onAdd: (type: KbPropertyType) => void;
}) {
  return (
    <div className="kb-collection-column-menu-panel">
      <div className="kb-collection-column-insert-subtitle">
        Добавить свойство
      </div>
      <div className="kb-collection-column-type-list">
        {KB_COLLECTION_CREATABLE_FIELD_TYPES.map((type) => {
          const Icon = FIELD_ICONS[type];
          return (
            <button
              key={type}
              type="button"
              className="kb-collection-column-type-option"
              onClick={(event) => {
                stopBlockMenuAction(event);
                onAdd(type);
              }}
            >
              <Icon className="size-4" />
              <span>{KB_COLLECTION_FIELD_LABELS[type]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
