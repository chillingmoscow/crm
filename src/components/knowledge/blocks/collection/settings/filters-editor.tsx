"use client";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createCollectionFilter,
  type KbCollectionField,
  type KbCollectionFilter,
  type KbCollectionFilterOperator,
} from "@/lib/knowledge/collection";
import {
  defaultFilterOperator,
  filterOperatorNeedsValue,
  filterOperatorsForField,
  normalizeFilterInputValue,
  normalizeFilterOperatorForField,
} from "@/lib/knowledge/collection-filter";

import { CollectionFieldSelect } from "./field-select";

export function CollectionFiltersEditor({
  fields,
  filters,
  onChange,
}: {
  fields: KbCollectionField[];
  filters: KbCollectionFilter[];
  onChange: (filters: KbCollectionFilter[]) => void;
}) {
  const validFilters = filters.filter((filter) =>
    fields.some((field) => field.id === filter.fieldId),
  );

  const updateFilter = (id: string, patch: Partial<KbCollectionFilter>) => {
    onChange(
      validFilters.map((filter) => {
        if (filter.id !== id) return filter;
        const next = { ...filter, ...patch };
        const field = fields.find((item) => item.id === next.fieldId);
        if (field && !filterOperatorNeedsValue(field, next.operator)) {
          delete next.value;
        }
        return next;
      }),
    );
  };

  const addFilter = (fieldId: string) => {
    if (!fieldId) return;
    const field = fields.find((item) => item.id === fieldId);
    if (!field) return;
    onChange([...validFilters, createCollectionFilter(field.id, defaultFilterOperator(field))]);
  };

  if (fields.length === 0) {
    return (
      <div className="kb-collection-settings-empty">
        Добавьте свойства, чтобы фильтровать записи.
      </div>
    );
  }

  return (
    <div className="kb-collection-filters-editor">
      {validFilters.length === 0 ? (
        <div className="kb-collection-settings-empty">
          Фильтры не заданы. Вид показывает все записи коллекции.
        </div>
      ) : (
        validFilters.map((filter) => {
          const field = fields.find((item) => item.id === filter.fieldId);
          if (!field) return null;
          const operators = filterOperatorsForField(field);
          const operator = normalizeFilterOperatorForField(field, filter.operator);
          const needsValue = filterOperatorNeedsValue(field, operator);

          return (
            <div key={filter.id} className="kb-collection-filter-row">
              <CollectionFieldSelect
                fields={fields}
                value={field.id}
                placeholder="Выбрать свойство"
                searchPlaceholder="Найти свойство..."
                onChange={(fieldId) => {
                  const nextField = fields.find((item) => item.id === fieldId);
                  if (!nextField) return;
                  updateFilter(filter.id, {
                    fieldId: nextField.id,
                    operator: defaultFilterOperator(nextField),
                    value: undefined,
                  });
                }}
              />
              <select
                className="kb-collection-filter-select"
                value={operator}
                aria-label="Оператор фильтра"
                onChange={(event) =>
                  updateFilter(filter.id, {
                    operator: event.currentTarget.value as KbCollectionFilterOperator,
                  })
                }
              >
                {operators.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              {needsValue ? (
                <Input
                  value={filter.value == null ? "" : String(filter.value)}
                  className="kb-collection-filter-input"
                  aria-label="Значение фильтра"
                  onChange={(event) =>
                    updateFilter(filter.id, {
                      value: normalizeFilterInputValue(
                        field,
                        event.currentTarget.value,
                      ),
                    })
                  }
                />
              ) : (
                <span className="kb-collection-filter-placeholder" />
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-destructive"
                onClick={() =>
                  onChange(validFilters.filter((item) => item.id !== filter.id))
                }
                aria-label="Удалить фильтр"
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
        placeholder="Добавить фильтр"
        searchPlaceholder="Найти свойство..."
        onChange={addFilter}
      />
    </div>
  );
}
