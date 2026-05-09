import { nanoid } from "nanoid";

import type {
  KbProperty,
  KbPropertyColor,
  KbPropertyType,
} from "@/types/knowledge";

export type KbCollectionView = "list" | "table";

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

export type KbCollectionPropertyContext = {
  collectionId: string;
  collectionTitle?: string;
  /**
   * v1 collections are page-scoped views over direct child pages. When true,
   * properties from older block-scoped collection ids are treated as stale
   * collection metadata for the same child rows and are adopted/removed during
   * schema sync instead of being kept as a second collection group.
   */
  exclusive?: boolean;
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

export function createCollectionId(): string {
  return `collection_${nanoid(10)}`;
}

export function getPageCollectionId(pageId: string): string {
  return `page_${pageId}`;
}

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
  context: KbCollectionPropertyContext,
): KbProperty {
  const base = {
    id: field.id,
    name: field.name,
    scope: collectionPropertyScope(field, context),
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
  context: KbCollectionPropertyContext,
): KbProperty[] {
  return schema.fields.map((field) => collectionFieldToProperty(field, context));
}

export function inferCollectionSchemaFromProperties(
  propertySets: KbProperty[][],
  preferredCollectionId?: string,
): KbCollectionSchema {
  const groups = new Map<
    string,
    {
      fields: KbCollectionField[];
      fieldIds: Set<string>;
      firstSeen: number;
      total: number;
    }
  >();
  let seen = 0;

  for (const properties of propertySets) {
    for (const property of properties) {
      const scope = property.scope?.type === "collection" ? property.scope : null;
      if (!scope) continue;
      const field = collectionFieldFromProperty(property);
      if (!field) continue;

      const group = groups.get(scope.collectionId) ?? {
        fields: [],
        fieldIds: new Set<string>(),
        firstSeen: seen,
        total: 0,
      };
      group.total += 1;
      if (!group.fieldIds.has(field.id)) {
        group.fieldIds.add(field.id);
        group.fields.push(field);
      }
      groups.set(scope.collectionId, group);
      seen += 1;
    }
  }

  const preferred = preferredCollectionId
    ? groups.get(preferredCollectionId)
    : undefined;
  const best =
    preferred && preferred.fields.length > 0
      ? preferred
      : Array.from(groups.values()).sort(
          (a, b) =>
            b.fields.length - a.fields.length ||
            b.total - a.total ||
            a.firstSeen - b.firstSeen,
        )[0];

  return { version: 1, fields: best?.fields ?? [] };
}

export function mergeCollectionSchemaProperties(
  existingProperties: KbProperty[],
  schema: KbCollectionSchema,
  context: KbCollectionPropertyContext,
): { properties: KbProperty[]; changed: boolean } {
  if (schema.fields.length === 0) {
    const properties = existingProperties.filter(
      (property) =>
        !isPropertyFromCollection(property, context.collectionId) &&
        !(context.exclusive && property.scope?.type === "collection"),
    );
    return {
      properties,
      changed: !sameJson(existingProperties, properties),
    };
  }

  const usedIndexes = new Set<number>();
  const collectionProperties: KbProperty[] = [];
  let changed = false;

  for (const field of schema.fields) {
    const fallback = collectionFieldToProperty(field, context);
    const byId = existingProperties.findIndex(
      (property, index) =>
        !usedIndexes.has(index) &&
        isCollectionPropertyForField(property, field, context.collectionId),
    );
    const legacyById =
      byId >= 0
        ? -1
        : existingProperties.findIndex(
            (property, index) =>
              !usedIndexes.has(index) &&
              property.scope === undefined &&
              property.id === field.id,
          );
    const orphanedCollectionByField =
      byId >= 0 || legacyById >= 0 || !context.exclusive
        ? -1
        : existingProperties.findIndex(
            (property, index) =>
              !usedIndexes.has(index) &&
              property.scope?.type === "collection" &&
              property.scope.fieldId === field.id,
          );
    const orphanedCollectionByName =
      byId >= 0 ||
      legacyById >= 0 ||
      orphanedCollectionByField >= 0 ||
      !context.exclusive
        ? -1
        : existingProperties.findIndex(
            (property, index) =>
              !usedIndexes.has(index) &&
              property.scope?.type === "collection" &&
              property.name === field.name &&
              property.type === field.type,
          );
    const matchedIndex =
      byId >= 0
        ? byId
        : legacyById >= 0
          ? legacyById
          : orphanedCollectionByField >= 0
            ? orphanedCollectionByField
            : orphanedCollectionByName;

    if (matchedIndex < 0) {
      collectionProperties.push(fallback);
      changed = true;
      continue;
    }

    usedIndexes.add(matchedIndex);
    const existing = existingProperties[matchedIndex]!;
    const adopted = {
      ...existing,
      scope: collectionPropertyScope(field, context),
    } as KbProperty;
    const merged = mergeCollectionProperty(adopted, field, fallback, context);
    collectionProperties.push(merged);
    if (!sameJson(existing, merged)) changed = true;
  }

  const manualProperties = existingProperties.filter(
    (property, index) =>
      !usedIndexes.has(index) &&
      !isPropertyFromCollection(property, context.collectionId) &&
      !(context.exclusive && property.scope?.type === "collection"),
  );
  const properties = [...collectionProperties, ...manualProperties];
  if (!sameJson(existingProperties, properties)) changed = true;
  return { properties, changed };
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
  collectionId: string,
): KbProperty | null {
  return (
    properties.find((property) =>
      isCollectionPropertyForField(property, field, collectionId),
    ) ??
    properties.find(
      (property) => property.scope === undefined && property.id === field.id,
    ) ??
    properties.find(
      (property) =>
        property.scope?.type === "collection" &&
        property.scope.fieldId === field.id,
    ) ??
    properties.find(
      (property) =>
        property.scope?.type === "collection" &&
        property.name === field.name &&
        property.type === field.type,
    ) ??
    null
  );
}

export function setCollectionFieldPropertyValue(
  properties: KbProperty[],
  field: KbCollectionField,
  context: KbCollectionPropertyContext,
  value: KbProperty["value"],
): KbProperty[] {
  const fallback = collectionFieldToProperty(field, context);
  const index = properties.findIndex(
    (property) =>
      isCollectionPropertyForField(property, field, context.collectionId) ||
      (property.scope === undefined && property.id === field.id) ||
      (property.scope?.type === "collection" &&
        (property.scope.fieldId === field.id ||
          (property.name === field.name && property.type === field.type))),
  );
  const current = index >= 0 ? properties[index]! : fallback;
  const normalized =
    current.type === field.type
      ? mergeCollectionProperty(
          {
            ...current,
            scope: collectionPropertyScope(field, context),
          } as KbProperty,
          field,
          fallback,
          context,
        )
      : fallback;
  const updated = {
    ...normalized,
    value,
  } as KbProperty;

  if (index < 0) return [updated, ...properties];
  return properties.map((property, propertyIndex) =>
    propertyIndex === index ? updated : property,
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

function collectionFieldFromProperty(property: KbProperty): KbCollectionField | null {
  const scope = property.scope?.type === "collection" ? property.scope : null;
  if (!scope) return null;

  const field: KbCollectionField = {
    id: scope.fieldId || property.id,
    name: property.name,
    type: property.type,
  };
  if (property.icon) field.icon = property.icon;
  if (property.iconColor) field.iconColor = property.iconColor;

  if (property.type === "select" || property.type === "multi-select") {
    field.options = property.options ?? [];
    if (property.optionColors) field.optionColors = property.optionColors;
  }
  if (property.type === "checkbox" && property.displayVariant === "switch") {
    field.displayVariant = "switch";
  }
  if (
    property.type === "rating" &&
    (property.max === 3 || property.max === 5 || property.max === 10)
  ) {
    field.max = property.max;
  }

  return normalizeCollectionField(field);
}

function fallbackFieldId(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return `field_${Math.abs(hash).toString(36)}`;
}

function mergeCollectionProperty(
  property: KbProperty,
  field: KbCollectionField,
  fallback: KbProperty,
  context: KbCollectionPropertyContext,
): KbProperty {
  if (property.type !== field.type) return fallback;

  switch (property.type) {
    case "text":
    case "number":
    case "date":
    case "url":
      return withCollectionBase(property, field, context);
    case "checkbox":
      return {
        ...withCollectionBase(property, field, context),
        ...(field.displayVariant === "switch"
          ? { displayVariant: "switch" as const }
          : {}),
      };
    case "select":
      return {
        ...withCollectionBase(property, field, context),
        options: field.options ?? property.options,
        ...(field.optionColors ? { optionColors: field.optionColors } : {}),
      };
    case "multi-select":
      return {
        ...withCollectionBase(property, field, context),
        options: field.options ?? property.options,
        ...(field.optionColors ? { optionColors: field.optionColors } : {}),
      };
    case "rating":
      return {
        ...withCollectionBase(property, field, context),
        ...(field.max ? { max: field.max } : {}),
      };
  }
}

function withCollectionBase<T extends KbProperty>(
  property: T,
  field: KbCollectionField,
  context: KbCollectionPropertyContext,
): T {
  const next = { ...property, id: field.id, name: field.name } as T & {
    icon?: string;
    iconColor?: string;
  };
  next.scope = collectionPropertyScope(field, context);
  if (field.icon) {
    next.icon = field.icon;
  } else {
    delete next.icon;
  }
  if (field.iconColor) {
    next.iconColor = field.iconColor;
  } else {
    delete next.iconColor;
  }
  return next;
}

function collectionPropertyScope(
  field: KbCollectionField,
  context: KbCollectionPropertyContext,
): Extract<NonNullable<KbProperty["scope"]>, { type: "collection" }> {
  return {
    type: "collection",
    collectionId: context.collectionId,
    ...(context.collectionTitle
      ? { collectionTitle: context.collectionTitle }
      : {}),
    fieldId: field.id,
  };
}

function isCollectionPropertyForField(
  property: KbProperty,
  field: KbCollectionField,
  collectionId: string,
): boolean {
  return (
    property.scope?.type === "collection" &&
    property.scope.collectionId === collectionId &&
    property.scope.fieldId === field.id
  );
}

function isPropertyFromCollection(
  property: KbProperty,
  collectionId: string,
): boolean {
  return (
    property.scope?.type === "collection" &&
    property.scope.collectionId === collectionId
  );
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
