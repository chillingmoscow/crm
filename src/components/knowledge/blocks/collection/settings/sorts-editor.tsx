"use client";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { KbCollectionField } from "@/lib/knowledge/collection";
import { sortDirectionLabel } from "@/lib/knowledge/collection-format";
import {
  createCollectionSort,
  type KbCollectionSort,
  type KbCollectionSortDirection,
} from "@/lib/knowledge/collection-sort";

import { CollectionFieldSelect } from "./field-select";

export function CollectionSortsEditor({
  fields,
  sorts,
  onChange,
}: {
  fields: KbCollectionField[];
  sorts: KbCollectionSort[];
  onChange: (sorts: KbCollectionSort[]) => void;
}) {
  const validSorts = sorts.filter((sort) =>
    fields.some((field) => field.id === sort.fieldId),
  );

  const updateSort = (id: string, patch: Partial<KbCollectionSort>) => {
    onChange(
      validSorts.map((sort) =>
        sort.id === id ? { ...sort, ...patch } : sort,
      ),
    );
  };

  const addSort = (fieldId: string) => {
    if (!fieldId) return;
    const field = fields.find((item) => item.id === fieldId);
    if (!field) return;
    onChange([...validSorts, createCollectionSort(field.id, "asc")]);
  };

  if (fields.length === 0) {
    return (
      <div className="kb-collection-settings-empty">
        Добавьте свойства, чтобы сортировать записи.
      </div>
    );
  }

  return (
    <div className="kb-collection-sorts-editor">
      {validSorts.length === 0 ? (
        <div className="kb-collection-settings-empty">
          Сортировки не заданы. Вид использует порядок страниц.
        </div>
      ) : (
        validSorts.map((sort) => {
          const field = fields.find((item) => item.id === sort.fieldId);
          if (!field) return null;

          return (
            <div key={sort.id} className="kb-collection-sort-row">
              <CollectionFieldSelect
                fields={fields}
                value={field.id}
                placeholder="Выбрать свойство"
                searchPlaceholder="Найти свойство..."
                onChange={(fieldId) =>
                  updateSort(sort.id, { fieldId })
                }
              />
              <select
                className="kb-collection-sort-select"
                value={sort.direction}
                aria-label="Направление сортировки"
                onChange={(event) =>
                  updateSort(sort.id, {
                    direction: event.currentTarget
                      .value as KbCollectionSortDirection,
                  })
                }
              >
                <option value="asc">{sortDirectionLabel(field, "asc")}</option>
                <option value="desc">{sortDirectionLabel(field, "desc")}</option>
              </select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-destructive"
                onClick={() =>
                  onChange(validSorts.filter((item) => item.id !== sort.id))
                }
                aria-label="Удалить сортировку"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          );
        })
      )}
      <CollectionFieldSelect
        fields={fields}
        value=""
        placeholder="Добавить сортировку"
        searchPlaceholder="Найти свойство..."
        onChange={addSort}
      />
    </div>
  );
}
