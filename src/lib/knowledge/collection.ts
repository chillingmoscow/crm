import { nanoid } from "nanoid";

import type {
  KbProperty,
  KbPropertyColor,
  KbPropertyType,
} from "@/types/knowledge";

export type KbCollectionView = "list";

export type KbCollectionField = {
  id: string;
  name: string;
  type: KbPropertyType;
  icon?: string;
  iconColor?: string;
  options?: string[];
  optionColors?: Partial<Record<string, KbPropertyColor>>;
  displayVariant?: string;
  max?: 3 | 5 | 10;
};

export type KbCollectionSchema = {
  version: 1;
  fields: KbCollectionField[];
};

export type KbCollectionVisibleFieldIds = string[] | null;

export const KB_COLLECTION_EMPTY_SCHEMA = JSON.stringify({
  version: 1,
  fields: [],
} satisfies KbCollectionSchema);

export const KB_COLLECTION_DEFAULT_VISIBLE_FIELDS = "";

export const KB_COLLECTION_FIELD_TYPES: KbPropertyType[] = [
  "text",
  "number",
  "date",
  "checkbox",
  "select",
  "multi-select",
  "url",
  "rating",
];

export const KB_COLLECTION_FIELD_LABELS: Record<KbPropertyType, string> = {
  text: "Текст",
  number: "Число",
  date: "Дата",
  checkbox: "Чекбокс",
  select: "Выбор",
  "multi-select": "Мультивыбор",
  url: "Ссылка",
  rating: "Рейтинг",
};

export function parseCollectionSchemaJson(value: unknown): KbCollectionSchema {
  if (typeof value !== "string" || value.trim() === "") {
    return { version: 1, fields: [] };
  }

  try {
    const raw = JSON.parse(value) as { fields?: unknown };
    if (!Array.isArray(raw.fields)) return { version: 1, fields: [] };
    return {
      version: 1,
      fields: raw.fields
        .map(normalizeCollectionField)
        .filter((field): field is KbCollectionField => field !== null),
    };
  } catch {
    return { version: 1, fields: [] };
  }
}

export function serializeCollectionSchema(
  schema: KbCollectionSchema,
): string {
  return JSON.stringify({
    version: 1,
    fields: schema.fields
      .map(normalizeCollectionField)
      .filter((field): field is KbCollectionField => field !== null),
  } satisfies KbCollectionSchema);
}

export function parseVisibleFieldIdsJson(
  value: unknown,
): KbCollectionVisibleFieldIds {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const raw = JSON.parse(value);
    if (!Array.isArray(raw)) return null;
    return raw.filter((item): item is string => typeof item === "string");
  } catch {
    return null;
  }
}

export function serializeVisibleFieldIds(ids: string[] | null): string {
  return ids === null ? KB_COLLECTION_DEFAULT_VISIBLE_FIELDS : JSON.stringify(ids);
}

export function createCollectionField(
  type: KbPropertyType,
  name = KB_COLLECTION_FIELD_LABELS[type],
): KbCollectionField {
  return {
    id: nanoid(8),
    name,
    type,
    ...(type === "select" || type === "multi-select" ? { options: [] } : {}),
    ...(type === "rating" ? { max: 5 as const } : {}),
  };
}

export function collectionFieldToProperty(
  field: KbCollectionField,
): KbProperty {
  const base = {
    id: field.id,
    name: field.name,
    ...(field.icon ? { icon: field.icon } : {}),
    ...(field.iconColor ? { iconColor: field.iconColor } : {}),
  };

  switch (field.type) {
    case "text":
      return { ...base, type: "text", value: "" };
    case "number":
      return { ...base, type: "number", value: null };
    case "date":
      return { ...base, type: "date", value: null };
    case "checkbox":
      return {
        ...base,
        type: "checkbox",
        value: false,
        ...(field.displayVariant === "switch"
          ? { displayVariant: "switch" as const }
          : {}),
      };
    case "select":
      return {
        ...base,
        type: "select",
        value: null,
        options: field.options ?? [],
        ...(field.optionColors ? { optionColors: field.optionColors } : {}),
      };
    case "multi-select":
      return {
        ...base,
        type: "multi-select",
        value: [],
        options: field.options ?? [],
        ...(field.optionColors ? { optionColors: field.optionColors } : {}),
      };
    case "url":
      return { ...base, type: "url", value: "" };
    case "rating":
      return {
        ...base,
        type: "rating",
        value: null,
        ...(field.max ? { max: field.max } : {}),
      };
  }
}

export function collectionSchemaToProperties(
  schema: KbCollectionSchema,
): KbProperty[] {
  return schema.fields.map(collectionFieldToProperty);
}

export function isCollectionFieldVisible(
  fieldId: string,
  visibleFieldIds: KbCollectionVisibleFieldIds,
): boolean {
  return visibleFieldIds === null || visibleFieldIds.includes(fieldId);
}

export function findPropertyForCollectionField(
  properties: KbProperty[],
  field: KbCollectionField,
): KbProperty | null {
  return (
    properties.find((property) => property.id === field.id) ??
    properties.find(
      (property) => property.name === field.name && property.type === field.type,
    ) ??
    null
  );
}

function normalizeCollectionField(value: unknown): KbCollectionField | null {
  const raw = value as Partial<KbCollectionField> | null;
  if (!raw || typeof raw.name !== "string") return null;
  const type = raw.type;
  if (!KB_COLLECTION_FIELD_TYPES.includes(type as KbPropertyType)) return null;

  const name = raw.name.trim();
  if (!name) return null;

  const normalized: KbCollectionField = {
    id:
      typeof raw.id === "string" && raw.id.trim()
        ? raw.id.trim()
        : fallbackFieldId(`${name}:${type}`),
    name,
    type: type as KbPropertyType,
  };

  if (typeof raw.icon === "string" && raw.icon.trim()) {
    normalized.icon = raw.icon.trim();
  }
  if (typeof raw.iconColor === "string" && raw.iconColor.trim()) {
    normalized.iconColor = raw.iconColor.trim();
  }
  if (Array.isArray(raw.options)) {
    normalized.options = raw.options
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (raw.optionColors && typeof raw.optionColors === "object") {
    normalized.optionColors = raw.optionColors;
  }
  if (raw.type === "checkbox" && raw.displayVariant === "switch") {
    normalized.displayVariant = "switch";
  }
  if (raw.type === "rating" && (raw.max === 3 || raw.max === 5 || raw.max === 10)) {
    normalized.max = raw.max;
  }

  return normalized;
}

function fallbackFieldId(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return `field_${Math.abs(hash).toString(36)}`;
}
