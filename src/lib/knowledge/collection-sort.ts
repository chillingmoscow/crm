import { nanoid } from "nanoid";

import type { KbProperty, KbPropertyType } from "../../types/knowledge";

export type KbCollectionSortDirection = "asc" | "desc";

export type KbCollectionSort = {
  id: string;
  fieldId: string;
  direction: KbCollectionSortDirection;
};

export type KbCollectionSortField = {
  id: string;
  name: string;
  type: KbPropertyType;
};

export type KbCollectionSortableItem = {
  id: string;
  title: string;
  position: number;
  updated_at: string | null;
  properties: KbProperty[];
};

export function parseCollectionSortsJson(value: unknown): KbCollectionSort[] {
  const raw = parseJsonArray(value);
  return raw
    .map(normalizeCollectionSort)
    .filter((sort): sort is KbCollectionSort => sort !== null);
}

export function serializeCollectionSorts(sorts: KbCollectionSort[]): string {
  return JSON.stringify(
    sorts
      .map(normalizeCollectionSort)
      .filter((sort): sort is KbCollectionSort => sort !== null),
  );
}

export function collectionSortsToJsonValue(
  sorts: KbCollectionSort[],
): unknown[] {
  return JSON.parse(serializeCollectionSorts(sorts)) as unknown[];
}

export function createCollectionSort(
  fieldId: string,
  direction: KbCollectionSortDirection = "asc",
): KbCollectionSort {
  return {
    id: nanoid(8),
    fieldId,
    direction,
  };
}

export function sortCollectionItems<T extends KbCollectionSortableItem>(
  items: T[],
  fields: KbCollectionSortField[],
  sorts: KbCollectionSort[],
  collectionId = "collection",
): T[] {
  const validSorts = sorts.filter((sort) =>
    fields.some((field) => field.id === sort.fieldId),
  );
  if (validSorts.length === 0) return items;

  return [...items].sort((left, right) => {
    for (const sort of validSorts) {
      const field = fields.find((candidate) => candidate.id === sort.fieldId);
      if (!field) continue;
      const result = compareSortValues(
        getCollectionPropertyValue(left, field.id, collectionId),
        getCollectionPropertyValue(right, field.id, collectionId),
        field.type,
      );
      if (result !== 0) {
        return sort.direction === "asc" ? result : -result;
      }
    }

    return compareFallback(left, right);
  });
}

function getCollectionPropertyValue(
  item: KbCollectionSortableItem,
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

function compareSortValues(
  left: KbProperty["value"] | null,
  right: KbProperty["value"] | null,
  type: KbPropertyType,
): number {
  const leftEmpty = isEmptySortValue(left);
  const rightEmpty = isEmptySortValue(right);
  if (leftEmpty && rightEmpty) return 0;
  if (leftEmpty) return 1;
  if (rightEmpty) return -1;

  if (type === "number" || type === "rating") {
    return compareNumbers(Number(left), Number(right));
  }
  if (type === "checkbox") {
    return Number(Boolean(left)) - Number(Boolean(right));
  }
  if (type === "date") {
    return compareNumbers(Date.parse(String(left)), Date.parse(String(right)));
  }

  return String(left).localeCompare(String(right), "ru", {
    sensitivity: "base",
    numeric: true,
  });
}

function compareNumbers(left: number, right: number): number {
  const leftInvalid = !Number.isFinite(left);
  const rightInvalid = !Number.isFinite(right);
  if (leftInvalid && rightInvalid) return 0;
  if (leftInvalid) return 1;
  if (rightInvalid) return -1;
  return left - right;
}

function compareFallback(
  left: KbCollectionSortableItem,
  right: KbCollectionSortableItem,
): number {
  if (left.position !== right.position) return left.position - right.position;
  return left.title.localeCompare(right.title, "ru", {
    sensitivity: "base",
    numeric: true,
  });
}

function isEmptySortValue(value: KbProperty["value"] | null): boolean {
  return (
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function normalizeCollectionSort(value: unknown): KbCollectionSort | null {
  const raw = value as Partial<KbCollectionSort> | null;
  if (!raw || typeof raw.fieldId !== "string" || !raw.fieldId.trim()) {
    return null;
  }
  if (raw.direction !== "asc" && raw.direction !== "desc") return null;

  return {
    id:
      typeof raw.id === "string" && raw.id.trim()
        ? raw.id.trim()
        : nanoid(8),
    fieldId: raw.fieldId.trim(),
    direction: raw.direction,
  };
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
