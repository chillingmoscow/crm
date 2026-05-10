import type { KbProperty } from "@/types/knowledge";

import type { KbCollectionField } from "./collection";
import type { KbCollectionSortDirection } from "./collection-sort";

export function formatPropertyValue(property: KbProperty): string {
  switch (property.type) {
    case "text":
    case "url":
      return property.value.trim();
    case "number":
      if (property.displayVariant === "rating") {
        if (property.value === null) return "";
        return `${property.value}/${property.max ?? 5}`;
      }
      return property.value === null ? "" : String(property.value);
    case "date":
      return property.value ?? "";
    case "checkbox":
      return property.value ? "Да" : "Нет";
    case "select":
      return property.value ?? "";
    case "multi-select":
      return property.value.join(", ");
    case "rating": {
      if (property.value === null) return "";
      const max = property.max ?? 5;
      return `${property.value}/${max}`;
    }
  }
}

export function sortDirectionLabel(
  field: KbCollectionField,
  direction: KbCollectionSortDirection,
): string {
  if (field.type === "number" || field.type === "rating") {
    return direction === "asc" ? "по возрастанию" : "по убыванию";
  }
  if (field.type === "date") {
    return direction === "asc" ? "сначала ранние" : "сначала поздние";
  }
  if (field.type === "checkbox") {
    return direction === "asc" ? "выключенные выше" : "включённые выше";
  }
  return direction === "asc" ? "А → Я" : "Я → А";
}
