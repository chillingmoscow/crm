import type { KbProperty, KbPropertyType } from "@/types/knowledge";

import {
  collectionFieldToProperty,
  normalizeCollectionViewType,
  KB_COLLECTION_CREATABLE_FIELD_TYPES,
  KB_COLLECTION_DEFAULT_VISIBLE_FIELDS,
  KB_COLLECTION_EMPTY_SCHEMA,
  type KbCollectionField,
  type KbCollectionLegacyBlock,
  type KbCollectionPropertyContext,
} from "./collection.ts";

export type FieldDropPlacement = "before" | "after";

export type CollectionDocumentBlock = {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  children?: CollectionDocumentBlock[];
};

export const MIN_TABLE_COLUMN_WIDTH = 96;

export function minTableColumnWidthForField(field: KbCollectionField): number {
  if (field.type === "number" && field.displayVariant === "rating") {
    if (field.ratingVariant === "slider") {
      return field.ratingShowValue === false ? 150 : 190;
    }
    const max = field.max ?? 5;
    return Math.max(112, max * 20 + Math.max(0, max - 1) * 2 + 20);
  }
  if (field.type === "rating") {
    if (field.ratingVariant === "slider") {
      return field.ratingShowValue === false ? 150 : 190;
    }
    const max = field.max ?? 5;
    return Math.max(112, max * 20 + Math.max(0, max - 1) * 2 + 20);
  }
  if (field.type === "checkbox") return 96;
  return MIN_TABLE_COLUMN_WIDTH;
}

export function collectionFieldTypeOptions(
  current?: KbPropertyType,
): KbPropertyType[] {
  if (current && !KB_COLLECTION_CREATABLE_FIELD_TYPES.includes(current)) {
    return [...KB_COLLECTION_CREATABLE_FIELD_TYPES, current];
  }
  return KB_COLLECTION_CREATABLE_FIELD_TYPES;
}

export function collectionFieldDisplayProperty(
  property: KbProperty | null,
  field: KbCollectionField,
  context: KbCollectionPropertyContext,
): KbProperty {
  const fallback = collectionFieldToProperty(field, context);
  if (!property || property.type !== field.type) return fallback;

  if (field.type === "number") {
    const next = {
      ...property,
      id: fallback.id,
      name: fallback.name,
      scope: fallback.scope,
      ...(fallback.description ? { description: fallback.description } : {}),
      ...(fallback.icon ? { icon: fallback.icon } : {}),
      ...(fallback.iconColor ? { iconColor: fallback.iconColor } : {}),
    } as Extract<KbProperty, { type: "number" }>;
    if (field.displayVariant === "rating") {
      next.displayVariant = "rating";
      next.max = field.max ?? 5;
      if (field.ratingVariant === "slider") next.ratingVariant = "slider";
      else delete next.ratingVariant;
      if (field.ratingShowValue === false) next.ratingShowValue = false;
      else delete next.ratingShowValue;
      delete next.unit;
    } else {
      delete next.displayVariant;
      delete next.max;
      delete next.ratingVariant;
      delete next.ratingShowValue;
    }
    return next;
  }

  if (field.type === "checkbox") {
    const checkboxProperty = property as Extract<KbProperty, { type: "checkbox" }>;
    const { displayVariant, ...rest } = checkboxProperty;
    void displayVariant;
    return {
      ...rest,
      id: fallback.id,
      name: fallback.name,
      scope: fallback.scope,
      ...(fallback.description ? { description: fallback.description } : {}),
      ...(fallback.icon ? { icon: fallback.icon } : {}),
      ...(fallback.iconColor ? { iconColor: fallback.iconColor } : {}),
      ...(field.displayVariant === "switch"
        ? { displayVariant: "switch" as const }
        : {}),
    };
  }

  if (field.type === "text") {
    const textProperty = property as Extract<KbProperty, { type: "text" }>;
    const { collapsed, ...rest } = textProperty;
    void collapsed;
    return {
      ...rest,
      id: fallback.id,
      name: fallback.name,
      scope: fallback.scope,
      ...(fallback.description ? { description: fallback.description } : {}),
      ...(fallback.icon ? { icon: fallback.icon } : {}),
      ...(fallback.iconColor ? { iconColor: fallback.iconColor } : {}),
      ...(field.collapsed ? { collapsed: true } : {}),
    };
  }

  if (field.type === "url") {
    const urlProperty = property as Extract<KbProperty, { type: "url" }>;
    const { urlCollapsed, ...rest } = urlProperty;
    void urlCollapsed;
    return {
      ...rest,
      id: fallback.id,
      name: fallback.name,
      scope: fallback.scope,
      ...(fallback.description ? { description: fallback.description } : {}),
      ...(fallback.icon ? { icon: fallback.icon } : {}),
      ...(fallback.iconColor ? { iconColor: fallback.iconColor } : {}),
      ...(field.urlCollapsed ? { urlCollapsed: true } : {}),
    };
  }

  if (field.type === "rating") {
    const ratingProperty = property as Extract<KbProperty, { type: "rating" }>;
    const { displayVariant, ...rest } = ratingProperty;
    void displayVariant;
    return {
      ...rest,
      id: fallback.id,
      name: fallback.name,
      scope: fallback.scope,
      ...(fallback.description ? { description: fallback.description } : {}),
      ...(fallback.icon ? { icon: fallback.icon } : {}),
      ...(fallback.iconColor ? { iconColor: fallback.iconColor } : {}),
      ...(field.max ? { max: field.max } : {}),
      ...(field.ratingVariant === "slider"
        ? { displayVariant: "slider" as const }
        : {}),
      ...(field.ratingShowValue === false ? { ratingShowValue: false } : {}),
    };
  }

  return {
    ...property,
    id: fallback.id,
    name: fallback.name,
    scope: fallback.scope,
  } as KbProperty;
}

export function orderCollectionFields(
  fields: KbCollectionField[],
  fieldOrderIds: string[] | null,
): KbCollectionField[] {
  if (!fieldOrderIds || fieldOrderIds.length === 0) return fields;

  const byId = new Map(fields.map((field) => [field.id, field]));
  const ordered: KbCollectionField[] = [];
  const usedIds = new Set<string>();

  for (const fieldId of fieldOrderIds) {
    const field = byId.get(fieldId);
    if (!field || usedIds.has(fieldId)) continue;
    ordered.push(field);
    usedIds.add(fieldId);
  }

  for (const field of fields) {
    if (!usedIds.has(field.id)) ordered.push(field);
  }

  return ordered;
}

export function reorderCollectionFieldIds(
  fields: KbCollectionField[],
  fieldOrderIds: string[] | null,
  activeId: string,
  targetId: string,
  placement: FieldDropPlacement,
): string[] | null {
  const ids = orderCollectionFields(fields, fieldOrderIds).map(
    (field) => field.id,
  );
  const fromIndex = ids.indexOf(activeId);
  const targetIndex = ids.indexOf(targetId);
  if (fromIndex < 0 || targetIndex < 0) return null;

  const nextIds = [...ids];
  const [movedId] = nextIds.splice(fromIndex, 1);
  const nextTargetIndex = nextIds.indexOf(targetId);
  if (nextTargetIndex < 0) return null;

  const insertIndex =
    placement === "after" ? nextTargetIndex + 1 : nextTargetIndex;
  if (nextIds[insertIndex] === movedId) return null;
  nextIds.splice(insertIndex, 0, movedId);
  return nextIds;
}

export function insertCollectionFieldId(
  fields: KbCollectionField[],
  fieldOrderIds: string[] | null,
  newFieldId: string,
  targetId: string,
  placement: FieldDropPlacement,
): string[] {
  const ids = orderCollectionFields(fields, fieldOrderIds)
    .map((field) => field.id)
    .filter((fieldId) => fieldId !== newFieldId);
  const targetIndex = ids.indexOf(targetId);
  const insertIndex =
    targetIndex < 0
      ? ids.length
      : placement === "after"
        ? targetIndex + 1
        : targetIndex;
  ids.splice(insertIndex, 0, newFieldId);
  return ids;
}

export function getDocumentCollectionBlocks(
  editor: unknown,
): CollectionDocumentBlock[] {
  const documentBlocks = (editor as { document?: unknown }).document;
  if (!Array.isArray(documentBlocks)) return [];

  const collectionBlocks: CollectionDocumentBlock[] = [];
  walkDocumentBlocks(
    documentBlocks as CollectionDocumentBlock[],
    (documentBlock) => {
      if (documentBlock.type === "collection") {
        collectionBlocks.push(documentBlock);
      }
    },
  );
  return collectionBlocks;
}

export function buildLegacyCollectionBlocks(
  editor: unknown,
): KbCollectionLegacyBlock[] {
  return getDocumentCollectionBlocks(editor).map((documentBlock) => {
    const props = documentBlock.props ?? {};
    return {
      blockId: documentBlock.id,
      title: typeof props.title === "string" ? props.title : undefined,
      view: normalizeCollectionViewType(props.view),
      viewTitle:
        typeof props.viewTitle === "string" ? props.viewTitle : undefined,
      schemaJson:
        typeof props.schemaJson === "string"
          ? props.schemaJson
          : KB_COLLECTION_EMPTY_SCHEMA,
      visibleFieldIdsJson:
        typeof props.visibleFieldIdsJson === "string"
          ? props.visibleFieldIdsJson
          : KB_COLLECTION_DEFAULT_VISIBLE_FIELDS,
      fieldOrderIdsJson:
        typeof props.fieldOrderIdsJson === "string"
          ? props.fieldOrderIdsJson
          : KB_COLLECTION_DEFAULT_VISIBLE_FIELDS,
    };
  });
}

export function walkDocumentBlocks(
  blocks: CollectionDocumentBlock[],
  visit: (block: CollectionDocumentBlock) => void,
) {
  for (const block of blocks) {
    visit(block);
    if (Array.isArray(block.children) && block.children.length > 0) {
      walkDocumentBlocks(block.children, visit);
    }
  }
}
