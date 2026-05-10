import type { KbProperty } from "@/types/knowledge";

import {
  findPropertyForCollectionField,
  type KbCollectionField,
  type KbCollectionFilter,
  type KbCollectionFilterOperator,
} from "./collection.ts";

export type KbCollectionFilterableItem = {
  properties: KbProperty[];
};

export function filterCollectionItems<T extends KbCollectionFilterableItem>(
  items: T[],
  fields: KbCollectionField[],
  filters: KbCollectionFilter[],
  collectionId: string,
): T[] {
  const validFilters = filters.filter((filter) =>
    fields.some((field) => field.id === filter.fieldId),
  );
  if (validFilters.length === 0) return items;

  return items.filter((item) =>
    validFilters.every((filter) => {
      const field = fields.find((candidate) => candidate.id === filter.fieldId);
      if (!field) return true;
      const property = findPropertyForCollectionField(
        item.properties,
        field,
        collectionId,
      );
      return matchesCollectionFilter(property, field, filter);
    }),
  );
}

export function matchesCollectionFilter(
  property: KbProperty | null,
  field: KbCollectionField,
  filter: KbCollectionFilter,
): boolean {
  const value = property?.value ?? null;
  const empty = isFilterValueEmpty(value);
  const operator = normalizeFilterOperatorForField(field, filter.operator);
  switch (operator) {
    case "is_empty":
      return empty;
    case "is_not_empty":
      return !empty;
    case "is_checked":
      return value === true;
    case "is_unchecked":
      return value !== true;
    case "contains": {
      const needle = String(filter.value ?? "").trim().toLowerCase();
      if (!needle) return true;
      if (Array.isArray(value)) {
        return value.some((item) => String(item).toLowerCase().includes(needle));
      }
      return String(value ?? "").toLowerCase().includes(needle);
    }
    case "not_contains": {
      const needle = String(filter.value ?? "").trim().toLowerCase();
      if (!needle) return true;
      if (Array.isArray(value)) {
        return !value.some((item) => String(item).toLowerCase().includes(needle));
      }
      return !String(value ?? "").toLowerCase().includes(needle);
    }
    case "equals":
      if (field.type === "number" || field.type === "rating") {
        if (empty || isFilterValueEmpty(filter.value ?? null)) return false;
        return Number(value) === Number(filter.value);
      }
      return String(value ?? "").toLowerCase() ===
        String(filter.value ?? "").trim().toLowerCase();
    case "not_equals":
      if (field.type === "number" || field.type === "rating") {
        if (empty || isFilterValueEmpty(filter.value ?? null)) return false;
        return Number(value) !== Number(filter.value);
      }
      return String(value ?? "").toLowerCase() !==
        String(filter.value ?? "").trim().toLowerCase();
    case "greater_than":
      if (empty || isFilterValueEmpty(filter.value ?? null)) return false;
      return Number(value) > Number(filter.value);
    case "less_than":
      if (empty || isFilterValueEmpty(filter.value ?? null)) return false;
      return Number(value) < Number(filter.value);
  }
}

export function isFilterValueEmpty(
  value: KbProperty["value"] | null,
): boolean {
  return (
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

export function defaultFilterOperator(
  field: KbCollectionField,
): KbCollectionFilterOperator {
  if (field.type === "checkbox") return "is_checked";
  if (field.type === "text" || field.type === "url") return "contains";
  if (field.type === "multi-select") return "contains";
  return "equals";
}

export function filterOperatorsForField(field: KbCollectionField): {
  value: KbCollectionFilterOperator;
  label: string;
}[] {
  if (field.type === "checkbox") {
    return [
      { value: "is_checked", label: "включён" },
      { value: "is_unchecked", label: "выключен" },
    ];
  }
  const emptyOperators = [
    { value: "is_empty" as const, label: "пусто" },
    { value: "is_not_empty" as const, label: "не пусто" },
  ];
  if (field.type === "number" || field.type === "rating") {
    return [
      { value: "equals", label: "=" },
      { value: "not_equals", label: "!=" },
      { value: "greater_than", label: ">" },
      { value: "less_than", label: "<" },
      ...emptyOperators,
    ];
  }
  if (
    field.type === "text" ||
    field.type === "url" ||
    field.type === "multi-select"
  ) {
    return [
      { value: "contains", label: "содержит" },
      { value: "not_contains", label: "не содержит" },
      ...emptyOperators,
    ];
  }
  return [
    { value: "equals", label: "равно" },
    { value: "not_equals", label: "не равно" },
    ...emptyOperators,
  ];
}

export function normalizeFilterOperatorForField(
  field: KbCollectionField,
  operator: KbCollectionFilterOperator,
): KbCollectionFilterOperator {
  return filterOperatorsForField(field).some((item) => item.value === operator)
    ? operator
    : defaultFilterOperator(field);
}

export function filterOperatorNeedsValue(
  field: KbCollectionField,
  operator: KbCollectionFilterOperator,
): boolean {
  if (field.type === "checkbox") return false;
  return operator !== "is_empty" && operator !== "is_not_empty";
}

export function normalizeFilterInputValue(
  field: KbCollectionField,
  value: string,
): string | number {
  if (field.type !== "number" && field.type !== "rating") return value;
  if (value.trim() === "") return "";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}
