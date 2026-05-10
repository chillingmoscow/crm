import type { KbProperty, KbPropertyType } from "../../types/knowledge";
import type { KbCollectionSortDirection } from "./collection-sort";

export type KbCollectionGrouping = {
  fieldId: string;
  direction: KbCollectionSortDirection;
};

export type KbCollectionGroupField = {
  id: string;
  name: string;
  type: KbPropertyType;
};

export type KbCollectionGroupableItem = {
  id: string;
  title: string;
  position: number;
  updated_at: string | null;
  properties: KbProperty[];
};

export type KbCollectionItemGroup<T extends KbCollectionGroupableItem> = {
  key: string;
  label: string;
  items: T[];
  empty: boolean;
};

export function parseCollectionGroupingJson(
  value: unknown,
): KbCollectionGrouping | null {
  const raw = parseJsonObject(value);
  return normalizeCollectionGrouping(raw);
}

export function serializeCollectionGrouping(
  grouping: KbCollectionGrouping | null,
): string {
  return JSON.stringify(normalizeCollectionGrouping(grouping) ?? {});
}

export function collectionGroupingToJsonValue(
  grouping: KbCollectionGrouping | null,
): Record<string, unknown> {
  return JSON.parse(serializeCollectionGrouping(grouping)) as Record<
    string,
    unknown
  >;
}

export function createCollectionGrouping(
  fieldId: string,
  direction: KbCollectionSortDirection = "asc",
): KbCollectionGrouping {
  return { fieldId, direction };
}

export function groupCollectionItems<T extends KbCollectionGroupableItem>(
  items: T[],
  fields: KbCollectionGroupField[],
  grouping: KbCollectionGrouping | null,
  collectionId = "collection",
): KbCollectionItemGroup<T>[] {
  if (!grouping) return [];
  const field = fields.find((candidate) => candidate.id === grouping.fieldId);
  if (!field) return [];

  const groups = new Map<string, KbCollectionItemGroup<T>>();
  for (const item of items) {
    const values = getGroupValues(
      getCollectionPropertyValue(item, field.id, collectionId),
      field.type,
    );
    for (const value of values) {
      const current = groups.get(value.key);
      if (current) {
        current.items.push(item);
      } else {
        groups.set(value.key, {
          key: value.key,
          label: value.label,
          items: [item],
          empty: value.empty,
        });
      }
    }
  }

  return Array.from(groups.values()).sort((left, right) => {
    if (left.empty && right.empty) return 0;
    if (left.empty) return 1;
    if (right.empty) return -1;
    if (field.type === "checkbox") {
      const result = checkboxGroupRank(left.key) - checkboxGroupRank(right.key);
      return grouping.direction === "asc" ? result : -result;
    }
    const result = left.label.localeCompare(right.label, "ru", {
      sensitivity: "base",
      numeric: true,
    });
    return grouping.direction === "asc" ? result : -result;
  });
}

function checkboxGroupRank(key: string): number {
  return key === "checked" ? 1 : 0;
}

function getCollectionPropertyValue(
  item: KbCollectionGroupableItem,
  fieldId: string,
  collectionId: string,
): KbProperty["value"] | null {
  return (
    item.properties.find((property) => {
      const scope = property.scope;
      return (
        scope?.type === "collection" &&
        scope.collectionId === collectionId &&
        scope.fieldId === fieldId
      );
    })?.value ?? null
  );
}

function getGroupValues(
  value: KbProperty["value"] | null,
  type: KbPropertyType,
): Array<{ key: string; label: string; empty: boolean }> {
  if (type === "checkbox") {
    return [
      value === true
        ? { key: "checked", label: "Включено", empty: false }
        : { key: "unchecked", label: "Выключено", empty: false },
    ];
  }

  if (type === "multi-select") {
    if (!Array.isArray(value) || value.length === 0) return [emptyGroupValue()];
    const unique = Array.from(
      new Set(value.map((item) => String(item).trim()).filter(Boolean)),
    );
    return unique.length > 0
      ? unique.map((item) => ({ key: item, label: item, empty: false }))
      : [emptyGroupValue()];
  }

  if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
    return [emptyGroupValue()];
  }

  const label = String(value).trim();
  return label ? [{ key: label, label, empty: false }] : [emptyGroupValue()];
}

function emptyGroupValue(): { key: string; label: string; empty: boolean } {
  return { key: "__empty__", label: "Без значения", empty: true };
}

function normalizeCollectionGrouping(
  value: unknown,
): KbCollectionGrouping | null {
  const raw = value as Partial<KbCollectionGrouping> | null;
  if (!raw || typeof raw.fieldId !== "string" || !raw.fieldId.trim()) {
    return null;
  }
  if (raw.direction !== "asc" && raw.direction !== "desc") return null;
  return {
    fieldId: raw.fieldId.trim(),
    direction: raw.direction,
  };
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || value.trim() === "") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
